"""Machine-readable CLI contract for refreshable provider cache artifacts."""

from __future__ import annotations

import argparse
import json
import shutil
import signal
import sys
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import (
    FIRST_COMPLETED,
    ProcessPoolExecutor,
    ThreadPoolExecutor,
    wait,
)
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from shapely.geometry import shape

from geo_pipeline.adapters import AdapterError, resolve_adapter
from geo_pipeline.aoi_runtime import (
    RuntimeRequestError,
    context_outcomes,
    profile_outcomes,
    resolve_runtime_request,
)
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import CACHE_DIR, RUNTIME_CACHE_DIR
from geo_pipeline.domain_pack import build_map_presentation, domain_pack_root, read_domain_pack
from geo_pipeline.prepared_snapshot import publish_runtime_snapshot
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain
from geo_pipeline.source_availability import build_runtime_source_availability
from geo_pipeline.vector_tiles import read_map_presentation

EXIT_INVALID_REQUEST = 2
EXIT_WORKER_FAILURE = 3
MAX_CONCURRENT_LIVE_DOMAINS = 2
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
        raise WorkerError(
            EXIT_INVALID_REQUEST,
            "unsupported_input",
            f"Unsupported input mode: {input_mode}",
        )

    if input_mode == "live":
        adapter.run_live()

    staging_root = cache_root.parent / f".{cache_root.name}-worker-{uuid.uuid4().hex}"
    try:
        staged_cache = adapter.build_fixture(staging_root)
        adapter.build_domain_pack(staging_root)
        _replace_cache(
            target.root,
            cache_paths(adapter.aoi_alias, adapter.domain, root=staging_root).root,
        )
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
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
) -> dict[str, Any]:
    """Resolve a v2 request and publish selected qualified OSM runtime packs."""
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(
            EXIT_INVALID_REQUEST,
            "unsupported_input",
            f"Unsupported input mode: {input_mode}",
        )
    try:
        resolved = resolve_runtime_request(request)
    except RuntimeRequestError as error:
        raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", str(error)) from error
    state_root = (runtime_root or RUNTIME_CACHE_DIR) / "provider-runtime-v1"
    # Acquisition-only packs cannot satisfy a subsequent map-producing request.
    mode_key = ("vectors" if skip_pmtiles else "map") + f"-{input_mode}"
    state_path = state_root / f"{resolved['cache_key']}-{mode_key}.json"
    checkpoint_root = state_root / "domains" / resolved["aoi"]["cache_key"] / mode_key
    cached = _read_fresh_runtime_state(state_path)
    if cached is not None:
        try:
            if input_mode == "live":
                validated = []
                for item in cached["outcomes"]:
                    if item["status"] in {"ready", "needs_source"}:
                        checkpoint = _read_domain_checkpoint(
                            checkpoint_root / f"{item['domain']}.json",
                            resolved,
                            cache_root,
                            not skip_pmtiles,
                        )
                        if checkpoint is None:
                            raise ValueError("A cached domain is expired, missing or corrupt")
                        validated.append(checkpoint)
                    else:
                        validated.append(item)
                cached = {**cached, "outcomes": validated}
            else:
                _validate_ready_runtime_artifacts(
                    cached["outcomes"], cache_root, require_pmtiles=not skip_pmtiles
                )
        except Exception:
            cached = None
        if cached is not None and not _has_retryable_failures(cached["outcomes"]):
            _emit_runtime_progress(progress, event="cache_hit", outcomes=cached["outcomes"])
            return {**cached, "request_result": "cache"}
    try:
        outcomes = profile_outcomes(request, fixture_mode=input_mode == "fixture")
        _emit_runtime_progress(progress, event="started", outcomes=[], total_domains=len(outcomes))
        if input_mode == "live":
            checkpointed: set[str] = set()
            for index, outcome in enumerate(outcomes):
                checkpoint = _read_domain_checkpoint(
                    checkpoint_root / f"{outcome['domain']}.json",
                    resolved,
                    cache_root,
                    not skip_pmtiles,
                )
                if checkpoint is not None:
                    outcomes[index] = checkpoint
                    checkpointed.add(outcome["domain"])
            initial_by_domain = {item["domain"]: item for item in outcomes}

            def publish_completed(completed: list[dict[str, Any]]) -> dict[str, Any] | None:
                by_domain = {item["domain"]: item for item in completed}
                partial = [
                    by_domain.get(
                        item["domain"],
                        {
                            **initial_by_domain[item["domain"]],
                            "status": "pending_qualification",
                            "artifact_aoi_id": None,
                            "detail": "This domain is still being prepared; it is not yet published.",
                            "cache_status": "missing",
                            "failure_reason": None,
                        },
                    )
                    for item in outcomes
                ]
                for item in completed:
                    if (
                        item["status"] in {"ready", "needs_source"}
                        and item["domain"] not in checkpointed
                    ):
                        _write_runtime_state(
                            checkpoint_root / f"{item['domain']}.json",
                            {
                                "cached_at": _utc_timestamp(),
                                "pipeline_version": resolved["pipeline_version"],
                                "outcome": item,
                            },
                        )
                        checkpointed.add(item["domain"])
                if not any(item["status"] == "ready" for item in partial):
                    return
                partial_response = _runtime_response(resolved, partial, request)
                _publish_runtime_response(partial_response, cache_root)
                _write_runtime_state(state_path, partial_response)
                return partial_response

            outcomes = _refresh_live_runtime_outcomes(
                resolved,
                outcomes,
                cache_root,
                progress=progress,
                executor_type=executor_type,
                skip_pmtiles=skip_pmtiles,
                on_completed=publish_completed,
            )
        else:
            outcomes = _report_existing_runtime_outcomes(outcomes, progress=progress)
        _validate_ready_runtime_artifacts(outcomes, cache_root)
        aoi_id = resolved["aoi"]["aoi_id"]
        source_avail_root = cache_root.parents[0] / "source-availability"
        build_runtime_source_availability(aoi_id, out_path=source_avail_root / f"{aoi_id}.json")
        build_runtime_source_availability(
            aoi_id, out_path=cache_root / aoi_id / "source_availability.json"
        )
        response = _runtime_response(resolved, outcomes, request)
        if input_mode == "live":
            _publish_runtime_response(response, cache_root)
        _write_runtime_state(state_path, response)
        return response
    except WorkerError:
        raise
    except Exception as error:
        # State is written only after every ready artifact validates, so a
        # failed attempt cannot replace a previous valid cached response.
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error


def _runtime_response(
    resolved: dict[str, Any], outcomes: list[dict[str, Any]], request: dict[str, Any]
) -> dict[str, Any]:
    return {
        "status": "ok",
        **resolved,
        "outcomes": outcomes,
        "contexts": context_outcomes(request),
        "job_state": "ready",
        "request_result": "refresh",
        "cached_at": _utc_timestamp(),
    }


def _publish_runtime_response(response: dict[str, Any], cache_root: Path) -> None:
    aoi_id = response["aoi"]["aoi_id"]
    build_runtime_source_availability(
        aoi_id, out_path=cache_root / aoi_id / "source_availability.json"
    )
    publish_runtime_snapshot(
        cache_root=cache_root,
        resolved=response,
        outcomes=response["outcomes"],
        pipeline_version=response["pipeline_version"],
    )


def _read_domain_checkpoint(
    path: Path, resolved: dict[str, Any], cache_root: Path, require_pmtiles: bool
) -> dict[str, Any] | None:
    try:
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
        if checkpoint["pipeline_version"] != resolved["pipeline_version"]:
            return None
        cached_at = datetime.fromisoformat(checkpoint["cached_at"])
        if cached_at.tzinfo is None or cached_at < datetime.now(UTC) - timedelta(hours=24):
            return None
        outcome = checkpoint["outcome"]
        if not _is_complete_runtime_state(
            {"status": "ok", "cache_key": "checkpoint", "contexts": [], "outcomes": [outcome]}
        ):
            return None
        if outcome["domain"] != path.stem or outcome["status"] not in {"ready", "needs_source"}:
            return None
        if outcome["status"] == "ready" and outcome["artifact_aoi_id"] != resolved["aoi"]["aoi_id"]:
            return None
        _validate_ready_runtime_artifacts([outcome], cache_root, require_pmtiles=require_pmtiles)
        return {**outcome, "cache_status": "fresh" if outcome["status"] == "ready" else "missing"}
    except OSError, ValueError, KeyError, TypeError:
        return None


def _validate_ready_runtime_artifacts(
    outcomes: list[dict[str, Any]], cache_root: Path, *, require_pmtiles: bool = False
) -> None:
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
        pack = read_domain_pack(artifact_aoi_id, outcome["domain"], root=cache_root)
        if require_pmtiles:
            read_map_presentation(
                pack_root=domain_pack_root(artifact_aoi_id, outcome["domain"], root=cache_root),
                manifest=pack,
            )


def _refresh_live_runtime_outcomes(
    resolved: dict[str, Any],
    outcomes: list[dict[str, Any]],
    cache_root: Path,
    *,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
    on_completed: Callable[[list[dict[str, Any]]], dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    """Two acquisition processes feed one PMTiles builder through staged disk packs."""
    if not outcomes:
        return []
    completed: list[dict[str, Any]] = []
    by_domain: dict[str, dict[str, Any]] = {}
    staging_root = cache_root.parent / f".runtime-stage-{uuid.uuid4().hex}"

    def finish(outcome: dict[str, Any]) -> None:
        by_domain[outcome["domain"]] = outcome
        completed.append(outcome)
        partial_result = on_completed(list(completed)) if on_completed else None
        _emit_runtime_progress(
            progress,
            event="domain_completed",
            outcomes=completed,
            total_domains=len(outcomes),
            partial_result=partial_result,
            active_domain=next((item[1]["domain"] for item in futures.values()), None),
        )

    try:
        with (
            executor_type(
                max_workers=min(MAX_CONCURRENT_LIVE_DOMAINS, len(outcomes))
            ) as acquisition,
            executor_type(max_workers=1) as builder,
        ):
            futures = {}
            pending_outcomes = []
            for outcome in outcomes:
                if outcome.get("cache_status") == "fresh" or (
                    outcome.get("status") == "needs_source"
                    and outcome.get("queried_feature_count") is not None
                ):
                    finish(outcome)
                else:
                    pending_outcomes.append(outcome)
            pending = iter(pending_outcomes)

            def submit_next() -> None:
                outcome = next(pending, None)
                if outcome is None:
                    return
                _emit_runtime_progress(
                    progress,
                    event="domain_started",
                    outcomes=completed,
                    total_domains=len(outcomes),
                    active_domain=outcome["domain"],
                )
                future = acquisition.submit(
                    _refresh_runtime_domain,
                    resolved["aoi"],
                    outcome["domain"],
                    str(staging_root),
                    True,
                )
                futures[future] = ("acquisition", outcome)

            for _ in range(min(MAX_CONCURRENT_LIVE_DOMAINS, len(pending_outcomes))):
                submit_next()
            while futures:
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in done:
                    stage, outcome = futures.pop(future)
                    if stage == "acquisition":
                        submit_next()
                    try:
                        result = future.result()
                        next_outcome = {**outcome, **result, "failure_reason": None}
                        if stage == "acquisition" and result["status"] == "ready":
                            _emit_runtime_progress(
                                progress,
                                event="domain_building",
                                outcomes=completed,
                                total_domains=len(outcomes),
                                active_domain=outcome["domain"],
                            )
                            build = builder.submit(
                                _finish_runtime_domain,
                                resolved["aoi"],
                                next_outcome,
                                str(staging_root),
                                str(cache_root),
                                skip_pmtiles,
                            )
                            futures[build] = ("presentation", next_outcome)
                            continue
                    except BaseException as error:
                        next_outcome = _failed_runtime_outcome(outcome, error)
                    finish(next_outcome)
        return [by_domain[outcome["domain"]] for outcome in outcomes]
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def _finish_runtime_domain(
    aoi: dict[str, Any],
    outcome: dict[str, Any],
    staging_root: str,
    cache_root: str,
    skip_pmtiles: bool,
) -> dict[str, Any]:
    """Only this single-process stage builds memory-heavy map artifacts."""
    domain = outcome["domain"]
    started = time.monotonic()

    def timed_out(_signal: int, _frame: Any) -> None:
        raise DomainAcquisitionTimeout(f"Timed out while building '{domain}' map presentation.")

    use_alarm = hasattr(signal, "SIGALRM") and threading.current_thread() is threading.main_thread()
    previous = signal.signal(signal.SIGALRM, timed_out) if use_alarm else None
    if use_alarm:
        signal.setitimer(signal.ITIMER_REAL, MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS)
    try:
        root = Path(staging_root)
        pack = read_domain_pack(aoi["aoi_id"], domain, root=root)
        if not skip_pmtiles:
            build_map_presentation(
                pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack
            )
            read_map_presentation(
                pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack
            )
        duration = int((time.monotonic() - started) * 1000)
        # Do not interrupt the tiny backup/replace transaction with SIGALRM.
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
        _replace_cache(Path(cache_root) / aoi["aoi_id"] / domain, root / aoi["aoi_id"] / domain)
        return {
            **outcome,
            "preparation_duration_ms": (outcome.get("preparation_duration_ms") or 0) + duration,
            "stage_durations_ms": {
                **outcome.get("stage_durations_ms", {}),
                "pmtiles": duration if not skip_pmtiles else 0,
            },
        }
    finally:
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)


def _refresh_runtime_domain(
    aoi: dict[str, Any], domain: str, cache_root: str, skip_pmtiles: bool = False
) -> dict[str, Any]:
    """Run live acquisition for one domain with isolated settings and timeouts.

    Acquisition has a POSIX deadline of 120-240s in the isolated main thread.
    Direct Overpass requests also have socket timeouts. The host orchestrator
    enforces an eight-minute deadline on the complete job and its process group.
    The separate, serialized presentation stage has its own 240s deadline.
    """
    started = time.monotonic()
    if not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
        if skip_pmtiles:
            result = refresh_runtime_osm_domain(
                aoi=aoi, domain=domain, root=Path(cache_root), build_pmtiles=False
            )
        else:
            result = refresh_runtime_osm_domain(aoi=aoi, domain=domain, root=Path(cache_root))
        return {**result, "preparation_duration_ms": int((time.monotonic() - started) * 1000)}

    timeout_seconds = _domain_acquisition_timeout(aoi)

    def timed_out(_signal: int, _frame: Any) -> None:
        raise DomainAcquisitionTimeout(
            f"Timed out after {timeout_seconds} seconds while acquiring '{domain}'."
        )

    previous = signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        if skip_pmtiles:
            result = refresh_runtime_osm_domain(
                aoi=aoi, domain=domain, root=Path(cache_root), build_pmtiles=False
            )
        else:
            result = refresh_runtime_osm_domain(aoi=aoi, domain=domain, root=Path(cache_root))
        return {**result, "preparation_duration_ms": int((time.monotonic() - started) * 1000)}
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
        "preparation_duration_ms": None,
        "overpass_endpoint": None,
    }


def _has_retryable_failures(outcomes: list[dict[str, Any]]) -> bool:
    return any(outcome.get("status") in {"failed", "pending_qualification"} for outcome in outcomes)


def _domain_acquisition_timeout(aoi: dict[str, Any]) -> int:
    """Allow more time for an official AOI that has several disconnected parts.

    OSMnx must query each polygonal part individually.  The cap keeps one slow
    public endpoint from holding a retry forever while avoiding a fixed limit
    that is unrealistically small for a genuine multi-gmina selection.
    """
    geometry = shape(aoi["geometry"])
    parts = len(geometry.geoms) if geometry.geom_type == "MultiPolygon" else 1
    return min(
        MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS,
        MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS
        + max(parts - 1, 0) * EXTRA_TIMEOUT_PER_AOI_PART_SECONDS,
    )


def _report_existing_runtime_outcomes(
    outcomes: list[dict[str, Any]], *, progress: RuntimeProgressCallback | None = None
) -> list[dict[str, Any]]:
    """Report deterministic fixture/domain-pack work with the same progress contract."""
    reported: list[dict[str, Any]] = []
    for outcome in outcomes:
        _emit_runtime_progress(
            progress,
            event="domain_started",
            outcomes=reported,
            total_domains=len(outcomes),
            active_domain=outcome["domain"],
        )
        reported.append(outcome)
        _emit_runtime_progress(
            progress,
            event="domain_completed",
            outcomes=reported,
            total_domains=len(outcomes),
        )
    return reported


def _emit_runtime_progress(
    progress: RuntimeProgressCallback | None,
    *,
    event: str,
    outcomes: list[dict[str, Any]],
    total_domains: int | None = None,
    active_domain: str | None = None,
    partial_result: dict[str, Any] | None = None,
) -> None:
    """Emit only observable preparation progress; Overpass has no reliable total beforehand."""
    if progress is None:
        return
    progress(
        {
            **({"partial_result": partial_result} if partial_result is not None else {}),
            "event": event,
            "total_domains": total_domains if total_domains is not None else len(outcomes),
            "completed_domains": len(outcomes),
            "active_domain": active_domain,
            "queried_feature_count": sum(
                item.get("queried_feature_count") or 0 for item in outcomes
            ),
            "accepted_feature_count": sum(
                item.get("accepted_feature_count") or 0 for item in outcomes
            ),
            "derived_feature_count": sum(
                item.get("derived_feature_count") or 0 for item in outcomes
            ),
        }
    )


def _read_fresh_runtime_state(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(payload["cached_at"])
    except OSError, ValueError, KeyError, json.JSONDecodeError:
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
    if not isinstance(payload.get("contexts"), list) or not isinstance(
        payload.get("outcomes"), list
    ):
        return False
    return all(
        isinstance(outcome, dict)
        and "artifact_aoi_id" in outcome
        and (isinstance(outcome["artifact_aoi_id"], str) or outcome["artifact_aoi_id"] is None)
        and outcome.get("cache_status") in {"fresh", "missing"}
        and all(
            field in outcome
            and (isinstance(outcome[field], int) and outcome[field] >= 0 or outcome[field] is None)
            for field in (
                "queried_feature_count",
                "accepted_feature_count",
                "derived_feature_count",
            )
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


def _success(
    adapter: Any, input_mode: str, cache: dict[str, Any], *, refreshed: bool
) -> dict[str, Any]:
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
    parser.add_argument(
        "--progress-jsonl",
        action="store_true",
        help="Write runtime preparation progress as prefixed JSON lines to stderr.",
    )
    parser.add_argument(
        "--skip-pmtiles",
        action="store_true",
        help="Do not build a PMTiles presentation (public demo mode).",
    )
    args = parser.parse_args()
    try:
        if args.runtime_request:
            if args.aoi or args.domain:
                raise WorkerError(
                    EXIT_INVALID_REQUEST,
                    "invalid_aoi_request",
                    "Runtime request cannot be combined with --aoi or --domain.",
                )
            try:
                request = json.loads(args.runtime_request)
            except json.JSONDecodeError as error:
                raise WorkerError(
                    EXIT_INVALID_REQUEST,
                    "invalid_aoi_request",
                    "Runtime request must be valid JSON.",
                ) from error

            def report_progress(event: dict[str, Any]) -> None:
                if args.progress_jsonl:
                    print(f"MDQ_PROGRESS:{json.dumps(event)}", file=sys.stderr, flush=True)

            print(
                json.dumps(
                    run_runtime_worker(
                        request=request,
                        input_mode=args.input,
                        cache_root=args.cache_root,
                        progress=report_progress,
                        skip_pmtiles=args.skip_pmtiles,
                    )
                )
            )
            return 0
        if not args.aoi or not args.domain:
            raise WorkerError(
                EXIT_INVALID_REQUEST,
                "invalid_request",
                "--aoi and --domain are required without --runtime-request.",
            )
        print(
            json.dumps(
                run_worker(
                    aoi=args.aoi,
                    domain=args.domain,
                    input_mode=args.input,
                    cache_root=args.cache_root,
                )
            )
        )
        return 0
    except WorkerError as error:
        print(
            json.dumps({"status": "error", "code": error.code, "message": str(error)}),
            file=sys.stderr,
        )
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
