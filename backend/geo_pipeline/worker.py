"""Machine-readable CLI contract for refreshable provider cache artifacts."""

from __future__ import annotations

import argparse
import json
import signal
import shutil
import sys
import threading
import uuid
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, wait
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from shapely.geometry import shape

from geo_pipeline.adapters import AdapterError, resolve_adapter
from geo_pipeline.aoi_runtime import RuntimeRequestError, context_outcomes, profile_outcomes, resolve_runtime_request
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import CACHE_DIR, RUNTIME_CACHE_DIR
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain
from geo_pipeline.source_availability import build_runtime_source_availability

EXIT_INVALID_REQUEST = 2
EXIT_WORKER_FAILURE = 3
MAX_CONCURRENT_LIVE_DOMAINS = 3
MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS = 120
EXTRA_TIMEOUT_PER_AOI_PART_SECONDS = 15
MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS = 240


class DomainAcquisitionTimeout(BaseException):
    """Interrupt one isolated live-domain process without ending its job."""


def run_worker(*, aoi: str, domain: str, input_mode: str, cache_root: Path) -> dict[str, Any]:
    try:
        adapter = resolve_adapter(aoi, domain)
    except AdapterError as error:
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_target", str(error)) from error

    target = cache_paths(adapter.aoi_alias, adapter.domain, root=cache_root)
    if input_mode == "cache":
        cache = read_cached_layer(target)
        return _success(adapter, input_mode, cache, refreshed=False)
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_input", f"Unsupported input mode: {input_mode}")

    if input_mode == "live":
        adapter.run_live()

    staging_root = cache_root.parent / f".{cache_root.name}-worker-{uuid.uuid4().hex}"
    try:
        staged_cache = adapter.build_fixture(staging_root)
        adapter.build_domain_pack(staging_root)
        _replace_cache(target.root, cache_paths(adapter.aoi_alias, adapter.domain, root=staging_root).root)
        return _success(adapter, input_mode, staged_cache, refreshed=True)
    except WorkerError:
        raise
    except Exception as error:
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


RuntimeProgressCallback = Callable[[dict[str, Any]], None]


def run_runtime_worker(
    *,
    request: dict[str, Any],
    input_mode: str,
    cache_root: Path,
    runtime_root: Path | None = None,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor] | type[ThreadPoolExecutor] = ProcessPoolExecutor,
) -> dict[str, Any]:
    """Resolve a v2 request and publish selected qualified OSM runtime packs."""
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_input", f"Unsupported input mode: {input_mode}")
    try:
        resolved = resolve_runtime_request(request)
    except RuntimeRequestError as error:
        raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", str(error)) from error
    state_root = (runtime_root or RUNTIME_CACHE_DIR) / "provider-runtime-v1"
    state_path = state_root / f"{resolved['cache_key']}.json"
    cached = _read_fresh_runtime_state(state_path)
    if cached is not None:
        try:
            _validate_ready_runtime_artifacts(cached["outcomes"], cache_root)
        except Exception:
            # A fresh state record is not enough: missing or corrupt artifacts
            # are a cache miss and must follow the normal refresh/failure path.
            cached = None
        if cached is not None and not _has_retryable_failures(cached["outcomes"]):
            _emit_runtime_progress(progress, event="cache_hit", outcomes=cached["outcomes"])
            return {**cached, "request_result": "cache"}
    try:
        outcomes = profile_outcomes(request, fixture_mode=input_mode == "fixture")
        _emit_runtime_progress(progress, event="started", outcomes=[], total_domains=len(outcomes))
        if input_mode == "live":
            if cached is not None:
                previous_by_domain = {outcome["domain"]: outcome for outcome in cached["outcomes"]}
                retry_domains = {domain for domain, outcome in previous_by_domain.items() if outcome.get("status") == "failed"}
                retry_outcomes = [outcome for outcome in outcomes if outcome["domain"] in retry_domains]
                refreshed = _refresh_live_runtime_outcomes(resolved, retry_outcomes, cache_root, progress=progress, executor_type=executor_type)
                refreshed_by_domain = {outcome["domain"]: outcome for outcome in refreshed}
                outcomes = [refreshed_by_domain.get(outcome["domain"], previous_by_domain.get(outcome["domain"], outcome)) for outcome in outcomes]
            else:
                outcomes = _refresh_live_runtime_outcomes(resolved, outcomes, cache_root, progress=progress, executor_type=executor_type)
        else:
            outcomes = _report_existing_runtime_outcomes(outcomes, progress=progress)
        _validate_ready_runtime_artifacts(outcomes, cache_root)
        aoi_id = resolved["aoi"]["aoi_id"]
        source_avail_root = cache_root.parents[0] / "source-availability"
        build_runtime_source_availability(aoi_id, out_path=source_avail_root / f"{aoi_id}.json")
        build_runtime_source_availability(aoi_id, out_path=cache_root / aoi_id / "source_availability.json")
        response = {"status": "ok", **resolved, "outcomes": outcomes, "contexts": context_outcomes(request), "job_state": "ready", "request_result": "refresh", "cached_at": _utc_timestamp()}
        _write_runtime_state(state_path, response)
        return response
    except WorkerError:
        raise
    except Exception as error:
        # State is written only after every ready artifact validates, so a
        # failed attempt cannot replace a previous valid cached response.
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error


def _validate_ready_runtime_artifacts(outcomes: list[dict[str, Any]], cache_root: Path) -> None:
    """Validate every ready runtime result against its own published pack."""
    for outcome in outcomes:
        if outcome["status"] != "ready":
            continue
        artifact_aoi_id = outcome.get("artifact_aoi_id")
        if not isinstance(artifact_aoi_id, str):
            raise WorkerError(
                EXIT_WORKER_FAILURE,
                "invalid_runtime_artifact",
                f"Ready {outcome['domain']} outcome has no validated artifact AOI identity.",
            )
        read_domain_pack(artifact_aoi_id, outcome["domain"], root=cache_root)


def _refresh_live_runtime_outcomes(
    resolved: dict[str, Any], outcomes: list[dict[str, Any]], cache_root: Path, *, progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor] | type[ThreadPoolExecutor] = ProcessPoolExecutor,
) -> list[dict[str, Any]]:
    """Refresh domains independently, with bounded parallelism and retryable failures.

    OSMnx stores its endpoint settings process-globally, so production work uses
    separate processes.  Individual domains write to separate cache paths and
    therefore can safely publish while other domains are still running.
    """
    if not outcomes:
        return []
    completed: list[dict[str, Any]] = []
    by_domain: dict[str, dict[str, Any]] = {}
    workers = min(MAX_CONCURRENT_LIVE_DOMAINS, len(outcomes))
    with executor_type(max_workers=workers) as executor:
        futures = {}
        for outcome in outcomes:
            _emit_runtime_progress(progress, event="domain_started", outcomes=completed, total_domains=len(outcomes), active_domain=outcome["domain"])
            if outcome["artifact_aoi_id"] is not None:
                by_domain[outcome["domain"]] = outcome
                completed.append(outcome)
                remaining_domains = [f_outcome["domain"] for f_outcome in futures.values()]
                active_domain = remaining_domains[0] if remaining_domains else None
                _emit_runtime_progress(progress, event="domain_completed", outcomes=completed, total_domains=len(outcomes), active_domain=active_domain)
                continue
            future = executor.submit(_refresh_runtime_domain, resolved["aoi"], outcome["domain"], str(cache_root))
            futures[future] = outcome
        while futures:
            done, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in done:
                outcome = futures.pop(future)
                try:
                    result = future.result()
                    next_outcome = {**outcome, **result, "failure_reason": None}
                except BaseException as error:
                    next_outcome = _failed_runtime_outcome(outcome, error)
                by_domain[outcome["domain"]] = next_outcome
                completed.append(next_outcome)
                remaining_domains = [f_outcome["domain"] for f_outcome in futures.values()]
                active_domain = remaining_domains[0] if remaining_domains else None
                _emit_runtime_progress(progress, event="domain_completed", outcomes=completed, total_domains=len(outcomes), active_domain=active_domain)
    return [by_domain[outcome["domain"]] for outcome in outcomes]


def _refresh_runtime_domain(aoi: dict[str, Any], domain: str, cache_root: str) -> dict[str, Any]:
    """Run live acquisition for one domain with isolated settings and timeouts.

    Timeout Protection Hierarchy:
    1. Layer 1 (POSIX per-domain signal): SIGALRM in the isolated process main
       thread, scaled dynamically by the number of polygonal parts (120-240s).
    2. Layer 2 (Network socket timeout): OSMnx/requests requests_timeout (180s).
    3. Layer 3 (Host orchestrator safety ceiling): Node runtime coordinator
       terminates worker subprocess after 8 minutes (RUNTIME_WORKER_TIMEOUT_MS).
    """
    if not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
        return refresh_runtime_osm_domain(aoi=aoi, domain=domain, root=Path(cache_root))

    timeout_seconds = _domain_acquisition_timeout(aoi)

    def timed_out(_signal: int, _frame: Any) -> None:
        raise DomainAcquisitionTimeout(f"Timed out after {timeout_seconds} seconds while acquiring '{domain}'.")

    previous = signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        return refresh_runtime_osm_domain(aoi=aoi, domain=domain, root=Path(cache_root))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _failed_runtime_outcome(outcome: dict[str, Any], error: BaseException) -> dict[str, Any]:
    if isinstance(error, DomainAcquisitionTimeout):
        detail = str(error)
        reason = "timeout"
    else:
        detail = f"Live acquisition failed: {error}"
        reason = "acquisition_error"
    return {
        **outcome,
        "status": "failed",
        "detail": f"{detail} The domain remains queued for a later retry.",
        "failure_reason": reason,
        "cache_status": "missing",
        "artifact_aoi_id": None,
        "queried_feature_count": None,
        "accepted_feature_count": None,
        "derived_feature_count": None,
    }


def _has_retryable_failures(outcomes: list[dict[str, Any]]) -> bool:
    return any(outcome.get("status") == "failed" for outcome in outcomes)


def _domain_acquisition_timeout(aoi: dict[str, Any]) -> int:
    """Allow more time for an official AOI that has several disconnected parts.

    OSMnx must query each polygonal part individually.  The cap keeps one slow
    public endpoint from holding a retry forever while avoiding a fixed limit
    that is unrealistically small for a genuine multi-gmina selection.
    """
    geometry = shape(aoi["geometry"])
    parts = len(geometry.geoms) if geometry.geom_type == "MultiPolygon" else 1
    return min(MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS, MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS + max(parts - 1, 0) * EXTRA_TIMEOUT_PER_AOI_PART_SECONDS)


def _report_existing_runtime_outcomes(outcomes: list[dict[str, Any]], *, progress: RuntimeProgressCallback | None = None) -> list[dict[str, Any]]:
    """Report deterministic fixture/domain-pack work with the same progress contract."""
    reported: list[dict[str, Any]] = []
    for outcome in outcomes:
        _emit_runtime_progress(progress, event="domain_started", outcomes=reported, total_domains=len(outcomes), active_domain=outcome["domain"])
        reported.append(outcome)
        _emit_runtime_progress(progress, event="domain_completed", outcomes=reported, total_domains=len(outcomes))
    return reported


def _emit_runtime_progress(progress: RuntimeProgressCallback | None, *, event: str, outcomes: list[dict[str, Any]], total_domains: int | None = None, active_domain: str | None = None) -> None:
    """Emit only observable preparation progress; Overpass has no reliable total beforehand."""
    if progress is None:
        return
    progress({
        "event": event,
        "total_domains": total_domains if total_domains is not None else len(outcomes),
        "completed_domains": len(outcomes),
        "active_domain": active_domain,
        "queried_feature_count": sum(item.get("queried_feature_count") or 0 for item in outcomes),
        "accepted_feature_count": sum(item.get("accepted_feature_count") or 0 for item in outcomes),
        "derived_feature_count": sum(item.get("derived_feature_count") or 0 for item in outcomes),
    })


def _read_fresh_runtime_state(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(payload["cached_at"])
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return None
    if cached_at.tzinfo is None or cached_at < datetime.now(UTC) - timedelta(hours=24):
        return None
    if not _is_complete_runtime_state(payload):
        return None
    payload["cached_at"] = _utc_timestamp(cached_at)
    return payload


def _is_complete_runtime_state(payload: dict[str, Any]) -> bool:
    """Reject stale/corrupt local cache records before Node validates them."""
    if payload.get("status") != "ok" or not isinstance(payload.get("cache_key"), str):
        return False
    if not isinstance(payload.get("contexts"), list) or not isinstance(payload.get("outcomes"), list):
        return False
    return all(
        isinstance(outcome, dict)
        and "artifact_aoi_id" in outcome
        and (isinstance(outcome["artifact_aoi_id"], str) or outcome["artifact_aoi_id"] is None)
        and outcome.get("cache_status") in {"fresh", "missing"}
        and all(
            field in outcome and (isinstance(outcome[field], int) and outcome[field] >= 0 or outcome[field] is None)
            for field in ("queried_feature_count", "accepted_feature_count", "derived_feature_count")
        )
        for outcome in payload["outcomes"]
    )


def _write_runtime_state(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        staged.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        staged.replace(path)
    finally:
        if staged.exists():
            staged.unlink()


def _utc_timestamp(value: datetime | None = None) -> str:
    return (value or datetime.now(UTC)).astimezone(UTC).isoformat().replace("+00:00", "Z")


def _replace_cache(target: Path, staged: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = target.parent / f".{target.name}-backup-{uuid.uuid4().hex}"
    moved_existing = False
    try:
        if target.exists():
            target.replace(backup)
            moved_existing = True
        staged.replace(target)
    except Exception:
        if moved_existing and backup.exists() and not target.exists():
            backup.replace(target)
        raise
    finally:
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)


def _success(adapter: Any, input_mode: str, cache: dict[str, Any], *, refreshed: bool) -> dict[str, Any]:
    return {
        "status": "ok",
        "aoi_id": adapter.aoi_alias,
        "domain": adapter.domain,
        "input": input_mode,
        "refreshed": refreshed,
        "source_registry_id": adapter.query.source_registry_id,
        "query_version": adapter.query.query_version,
        "feature_count": cache["metadata"]["feature_count"],
        "readiness": cache["readiness"]["readiness"],
    }


class WorkerError(Exception):
    def __init__(self, exit_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.code = code


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh or validate provider cache artifacts.")
    parser.add_argument("--aoi")
    parser.add_argument("--domain")
    parser.add_argument("--input", choices=["fixture", "cache", "live"], default="fixture")
    parser.add_argument("--cache-root", type=Path, default=CACHE_DIR)
    parser.add_argument("--runtime-request", help="JSON provider_aoi_request/v2 payload")
    parser.add_argument("--progress-jsonl", action="store_true", help="Write runtime preparation progress as prefixed JSON lines to stderr.")
    args = parser.parse_args()
    try:
        if args.runtime_request:
            if args.aoi or args.domain:
                raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", "Runtime request cannot be combined with --aoi or --domain.")
            try:
                request = json.loads(args.runtime_request)
            except json.JSONDecodeError as error:
                raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", "Runtime request must be valid JSON.") from error
            def report_progress(event: dict[str, Any]) -> None:
                if args.progress_jsonl:
                    print(f"MDQ_PROGRESS:{json.dumps(event)}", file=sys.stderr, flush=True)

            print(json.dumps(run_runtime_worker(request=request, input_mode=args.input, cache_root=args.cache_root, progress=report_progress)))
            return 0
        if not args.aoi or not args.domain:
            raise WorkerError(EXIT_INVALID_REQUEST, "invalid_request", "--aoi and --domain are required without --runtime-request.")
        print(json.dumps(run_worker(aoi=args.aoi, domain=args.domain, input_mode=args.input, cache_root=args.cache_root)))
        return 0
    except WorkerError as error:
        print(json.dumps({"status": "error", "code": error.code, "message": str(error)}), file=sys.stderr)
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
