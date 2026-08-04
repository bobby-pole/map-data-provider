"""Machine-readable CLI contract for refreshable provider cache artifacts."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from geo_pipeline.adapters import AdapterError, resolve_adapter
from geo_pipeline.aoi_runtime import RuntimeRequestError, context_outcomes, profile_outcomes, resolve_runtime_request
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import CACHE_DIR, RUNTIME_CACHE_DIR
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain

EXIT_INVALID_REQUEST = 2
EXIT_WORKER_FAILURE = 3


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


def run_runtime_worker(*, request: dict[str, Any], input_mode: str, cache_root: Path, runtime_root: Path | None = None) -> dict[str, Any]:
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
        return {**cached, "request_result": "cache"}
    try:
        outcomes = profile_outcomes(request, fixture_mode=input_mode == "fixture")
        if input_mode == "live":
            outcomes = _refresh_live_runtime_outcomes(resolved, outcomes, cache_root)
        # A ready fixture outcome is only valid when its existing domain-pack
        # still passes the same manifest validation as normal read routes.
        for outcome in outcomes:
            if outcome["status"] == "ready":
                read_domain_pack("rybnik_60km", outcome["domain"], root=cache_root)
        response = {"status": "ok", **resolved, "outcomes": outcomes, "contexts": context_outcomes(request), "job_state": "ready", "request_result": "refresh", "cached_at": _utc_timestamp()}
        _write_runtime_state(state_path, response)
        return response
    except WorkerError:
        raise
    except Exception as error:
        # State is written only after every ready artifact validates, so a
        # failed attempt cannot replace a previous valid cached response.
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error


def _refresh_live_runtime_outcomes(resolved: dict[str, Any], outcomes: list[dict[str, Any]], cache_root: Path) -> list[dict[str, Any]]:
    refreshed = []
    for outcome in outcomes:
        # The committed Rybnik demo remains a deterministic fixture fallback.
        # Every other requested qualified OSM AOI uses a bounded refresh.
        if outcome["domain"] in {"power", "emergency", "public", "transport", "bridges"} and outcome["artifact_aoi_id"] is None:
            refreshed.append({**outcome, **refresh_runtime_osm_domain(aoi=resolved["aoi"], domain=outcome["domain"], root=cache_root)})
        else:
            refreshed.append(outcome)
    return refreshed


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
    args = parser.parse_args()
    try:
        if args.runtime_request:
            if args.aoi or args.domain:
                raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", "Runtime request cannot be combined with --aoi or --domain.")
            try:
                request = json.loads(args.runtime_request)
            except json.JSONDecodeError as error:
                raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", "Runtime request must be valid JSON.") from error
            print(json.dumps(run_runtime_worker(request=request, input_mode=args.input, cache_root=args.cache_root)))
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
