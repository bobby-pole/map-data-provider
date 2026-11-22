"""Checkpoint, readiness validation, progress emission, and atomic cache state helpers."""

from __future__ import annotations

import json
import shutil
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from geo_pipeline.aoi_runtime import context_outcomes
from geo_pipeline.domain_pack import domain_pack_root, read_domain_pack
from geo_pipeline.prepared_snapshot import publish_runtime_snapshot
from geo_pipeline.source_availability import build_runtime_source_availability
from geo_pipeline.vector_tiles import read_map_presentation

EXIT_INVALID_REQUEST = 2
EXIT_WORKER_FAILURE = 3

RuntimeProgressCallback = Callable[[dict[str, Any]], None]


class DomainAcquisitionTimeout(BaseException):
    """Interrupt one isolated live-domain process without ending its job."""


class WorkerError(Exception):
    """Typed worker failure translated to a structured JSON error payload and exit code."""

    def __init__(self, exit_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.code = code


def utc_timestamp(value: datetime | None = None) -> str:
    """Format a UTC timestamp in ISO-8601 Z notation."""
    return (value or datetime.now(UTC)).astimezone(UTC).isoformat().replace("+00:00", "Z")


def is_complete_runtime_state(payload: dict[str, Any]) -> bool:
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


def read_fresh_runtime_state(path: Path) -> dict[str, Any] | None:
    """Read cached runtime worker state if valid and younger than 24 hours."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(payload["cached_at"])
    except OSError, ValueError, KeyError, json.JSONDecodeError:
        return None
    if cached_at.tzinfo is None or cached_at < datetime.now(UTC) - timedelta(hours=24):
        return None
    if not is_complete_runtime_state(payload):
        return None
    payload["cached_at"] = utc_timestamp(cached_at)
    return payload


def write_runtime_state(path: Path, payload: dict[str, Any]) -> None:
    """Atomically persist runtime worker or checkpoint JSON state."""
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        staged.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        staged.replace(path)
    finally:
        if staged.exists():
            staged.unlink()


def validate_ready_runtime_artifacts(
    outcomes: list[dict[str, Any]],
    cache_root: Path,
    *,
    require_pmtiles: bool = False,
    pack_reader: Callable[..., dict[str, Any]] | None = None,
) -> None:
    """Validate every ready runtime result against its own published pack."""
    read_pack = pack_reader or read_domain_pack
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
        pack = read_pack(artifact_aoi_id, outcome["domain"], root=cache_root)
        if require_pmtiles:
            read_map_presentation(
                pack_root=domain_pack_root(artifact_aoi_id, outcome["domain"], root=cache_root),
                manifest=pack,
            )


def read_domain_checkpoint(
    path: Path,
    resolved: dict[str, Any],
    cache_root: Path,
    require_pmtiles: bool,
    *,
    pack_reader: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Load and validate a single domain's 24h checkpoint against cached pack artifacts."""
    try:
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
        if checkpoint["pipeline_version"] != resolved["pipeline_version"]:
            return None
        cached_at = datetime.fromisoformat(checkpoint["cached_at"])
        if cached_at.tzinfo is None or cached_at < datetime.now(UTC) - timedelta(hours=24):
            return None
        outcome = checkpoint["outcome"]
        if not is_complete_runtime_state(
            {"status": "ok", "cache_key": "checkpoint", "contexts": [], "outcomes": [outcome]}
        ):
            return None
        if outcome["domain"] != path.stem or outcome["status"] not in {"ready", "needs_source"}:
            return None
        if outcome["status"] == "ready" and outcome["artifact_aoi_id"] != resolved["aoi"]["aoi_id"]:
            return None
        validate_ready_runtime_artifacts(
            [outcome], cache_root, require_pmtiles=require_pmtiles, pack_reader=pack_reader
        )
        return {**outcome, "cache_status": "fresh" if outcome["status"] == "ready" else "missing"}
    except OSError, ValueError, KeyError, TypeError:
        return None


def has_retryable_failures(outcomes: list[dict[str, Any]]) -> bool:
    """Return True when any outcome is failed or still pending qualification."""
    return any(outcome.get("status") in {"failed", "pending_qualification"} for outcome in outcomes)


def emit_runtime_progress(
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


def report_existing_runtime_outcomes(
    outcomes: list[dict[str, Any]], *, progress: RuntimeProgressCallback | None = None
) -> list[dict[str, Any]]:
    """Report deterministic fixture/domain-pack work with the same progress contract."""
    reported: list[dict[str, Any]] = []
    for outcome in outcomes:
        emit_runtime_progress(
            progress,
            event="domain_started",
            outcomes=reported,
            total_domains=len(outcomes),
            active_domain=outcome["domain"],
        )
        reported.append(outcome)
        emit_runtime_progress(
            progress,
            event="domain_completed",
            outcomes=reported,
            total_domains=len(outcomes),
        )
    return reported


def failed_runtime_outcome(outcome: dict[str, Any], error: BaseException) -> dict[str, Any]:
    """Translate an acquisition or build exception into a retryable failed outcome."""
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


def runtime_response(
    resolved: dict[str, Any], outcomes: list[dict[str, Any]], request: dict[str, Any]
) -> dict[str, Any]:
    """Assemble the canonical runtime worker response payload."""
    return {
        "status": "ok",
        **resolved,
        "outcomes": outcomes,
        "contexts": context_outcomes(request),
        "job_state": "ready",
        "request_result": "refresh",
        "cached_at": utc_timestamp(),
    }


def publish_runtime_response(response: dict[str, Any], cache_root: Path) -> None:
    """Write source availability metadata and atomic prepared snapshot manifest."""
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


def replace_cache(target: Path, staged: Path) -> None:
    """Atomically swap a staged domain directory into its final cache path with backup rollback."""
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


def success(
    adapter: Any, input_mode: str, cache: dict[str, Any], *, refreshed: bool
) -> dict[str, Any]:
    """Assemble the CLI success payload for fixture/cache single-domain worker mode."""
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
