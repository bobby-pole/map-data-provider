"""Atomic, checksum-validated publication records for MDQ prepared snapshots.

The artefact packs remain the source of geometry.  This module writes only the
small catalogue/evidence records consumed by the Node read API, after every
ready pack has passed its own validation.  Keeping the records in the same AOI
root makes a mounted prepared directory self-contained and portable.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from geo_pipeline.domain_pack import read_domain_pack


def publish_runtime_snapshot(
    *,
    cache_root: Path,
    resolved: dict[str, Any],
    outcomes: list[dict[str, Any]],
    pipeline_version: str,
) -> None:
    """Publish evidence before the snapshot becomes ready/partial.

    The caller has already validated every ready domain pack.  Atomic replaces
    preserve the previous catalogue record when a process crashes halfway
    through a new publication.  Domain packs themselves use their existing
    atomic pack publication.
    """
    aoi = resolved["aoi"]
    aoi_id = aoi["aoi_id"]
    root = cache_root / aoi_id
    root.mkdir(parents=True, exist_ok=True)
    now = _utc_timestamp()
    source_observed_at = now
    snapshot_id = aoi_id
    domains = [_evidence_domain(outcome) for outcome in outcomes]
    evidence = {
        "evidence_version": "provider_runtime_acquisition_evidence/v1",
        "aoi_id": aoi_id,
        "snapshot_id": snapshot_id,
        "resolved_geometry": aoi["geometry"],
        "radius_m": (aoi.get("constraints") or {}).get("radius_m"),
        "allowed_domains": [outcome["domain"] for outcome in outcomes],
        "source_observed_at": source_observed_at,
        "overpass_endpoint": _shared_overpass_endpoint(outcomes),
        "pipeline_version": pipeline_version,
        "published_at": now,
        "domains": domains,
    }
    # The evidence is the publication precondition. Do not write a ready
    # manifest first and leave an API-visible snapshot without provenance.
    _atomic_json(root / "acquisition_evidence.json", evidence)

    domain_outcomes = [_manifest_domain(outcome, cache_root) for outcome in outcomes]
    state = "partial" if any(item["status"] == "failed" for item in domain_outcomes) else "ready"
    unsigned = {
        "snapshot_version": "provider_prepared_snapshot/v1",
        "snapshot_id": snapshot_id,
        "aoi_id": aoi_id,
        "version": f"runtime-{now}",
        "state": state,
        "published_at": now,
        "source_observed_at": source_observed_at,
        "pipeline_version": pipeline_version,
        "coverage": {
            "geometry": aoi["geometry"],
            "geometry_crs": "EPSG:4326",
            "input_type": aoi["input_type"],
            "source_label": _coverage_label(aoi),
            "limitations": [
                "Prepared snapshot is dated source evidence, not a completeness or live-state claim."
            ],
        },
        "domain_outcomes": domain_outcomes,
    }
    payload = {**unsigned, "checksum": _sha256(_canonical_json(unsigned).encode("utf-8"))}
    _atomic_json(root / "snapshot_manifest.json", payload)


def publish_existing_snapshot(
    *,
    cache_root: Path,
    aoi: dict[str, Any],
    snapshot_id: str,
    version: str,
    pipeline_version: str,
    domains: tuple[str, ...],
) -> None:
    """Publish a manifest for already-validated immutable domain packs.

    This is used when a deliberately static bundle is promoted. It never
    refreshes a source or rewrites a pack; it only makes the selected set of
    existing, validated packs an explicit checksum-bound snapshot.
    """
    root = cache_root / snapshot_id
    if not root.is_dir():
        raise FileNotFoundError(f"Prepared snapshot root does not exist: {root}")
    outcomes = []
    observed_at: list[str] = []
    evidence_domains: list[dict[str, Any]] = []
    for domain in domains:
        pack = read_domain_pack(snapshot_id, domain, root=cache_root)
        readiness_path = root / domain / "domain-pack-v2" / pack["readiness"]["path"]
        readiness_payload = json.loads(readiness_path.read_text(encoding="utf-8"))
        readiness = readiness_payload.get("readiness")
        if readiness not in {"ready", "usable_with_limitations"}:
            raise ValueError(f"Prepared {domain} pack is not usable: {readiness!r}")
        validation_path = root / domain / "domain-pack-v2" / pack["validation"]["path"]
        validation_payload = json.loads(validation_path.read_text(encoding="utf-8"))
        source_date = validation_payload.get("snapshot_at")
        if isinstance(source_date, str):
            observed_at.append(source_date)
        source_url = validation_payload.get("source_url")
        accepted_count = validation_payload.get("feature_count")
        evidence_domains.append(
            {
                "domain": domain,
                "preparation_duration_ms": None,
                "queried_feature_count": None,
                "accepted_feature_count": accepted_count
                if isinstance(accepted_count, int) and accepted_count >= 0
                else None,
                "rejected_feature_count": None,
                "validation_status": "passed"
                if validation_payload.get("quality_status") in {"passed", "warning"}
                else "unknown",
                "limitations": [
                    "Promoted from an existing prepared bundle; acquisition timing and rejected counts were not recorded.",
                    *(
                        validation_payload.get("limitations", [])
                        if isinstance(validation_payload.get("limitations"), list)
                        else []
                    ),
                ],
                "overpass_endpoint": source_url if isinstance(source_url, str) else None,
            }
        )
        outcomes.append(
            {
                "domain": domain,
                "status": "ready",
                "detail": "Existing checksum-validated domain pack is included in this immutable snapshot.",
                "artifact_aoi_id": snapshot_id,
                "readiness": readiness,
            }
        )
    now = _utc_timestamp()
    _atomic_json(
        root / "acquisition_evidence.json",
        {
            "evidence_version": "provider_runtime_acquisition_evidence/v1",
            "aoi_id": snapshot_id,
            "snapshot_id": snapshot_id,
            "resolved_geometry": aoi["geometry"],
            "radius_m": (aoi.get("constraints") or {}).get("radius_m"),
            "allowed_domains": list(domains),
            "source_observed_at": min(observed_at) if observed_at else now,
            "overpass_endpoint": _shared_overpass_endpoint(evidence_domains),
            "pipeline_version": pipeline_version,
            "published_at": now,
            "domains": evidence_domains,
        },
    )
    unsigned = {
        "snapshot_version": "provider_prepared_snapshot/v1",
        "snapshot_id": snapshot_id,
        "aoi_id": snapshot_id,
        "version": version,
        "state": "ready",
        "published_at": now,
        # The oldest source observation is the conservative all-domain date.
        "source_observed_at": min(observed_at) if observed_at else None,
        "pipeline_version": pipeline_version,
        "coverage": {
            "geometry": aoi["geometry"],
            "geometry_crs": "EPSG:4326",
            "input_type": aoi["input_type"],
            "source_label": _coverage_label(aoi),
            "limitations": [
                "Static prepared snapshot contains dated source evidence and does not claim live infrastructure state."
            ],
        },
        "domain_outcomes": [_manifest_domain(outcome, cache_root) for outcome in outcomes],
    }
    _atomic_json(
        root / "snapshot_manifest.json",
        {**unsigned, "checksum": _sha256(_canonical_json(unsigned).encode("utf-8"))},
    )


def _evidence_domain(outcome: dict[str, Any]) -> dict[str, Any]:
    accepted = _nonnegative_int(outcome.get("accepted_feature_count"))
    queried = _nonnegative_int(outcome.get("queried_feature_count"))
    return {
        "domain": outcome["domain"],
        "preparation_duration_ms": _nonnegative_int(outcome.get("preparation_duration_ms")),
        "queried_feature_count": queried,
        "accepted_feature_count": accepted,
        "rejected_feature_count": max(queried - accepted, 0)
        if queried is not None and accepted is not None
        else None,
        "validation_status": "passed"
        if outcome.get("status") == "ready"
        else "failed"
        if outcome.get("status") == "failed"
        else "unknown",
        "limitations": [outcome.get("detail", "No detail was reported.")],
        "overpass_endpoint": outcome.get("overpass_endpoint"),
    }


def _manifest_domain(outcome: dict[str, Any], root: Path) -> dict[str, Any]:
    status = outcome.get("status")
    manifest_sha256 = None
    readiness = outcome.get("readiness", "needs_source")
    if status == "ready":
        artifact_aoi_id = outcome.get("artifact_aoi_id")
        if not isinstance(artifact_aoi_id, str):
            raise ValueError(f"Ready {outcome['domain']} outcome has no artifact AOI identity")
        manifest_path = (
            root / artifact_aoi_id / outcome["domain"] / "domain-pack-v2" / "manifest.json"
        )
        # `read_domain_pack` has already enforced this in production. Keeping
        # a missing path explicit also prevents a hermetic worker double from
        # inventing a checksum that does not exist on disk.
        manifest_sha256 = _sha256(manifest_path.read_bytes()) if manifest_path.is_file() else None
        readiness = outcome.get("readiness", "ready")
    elif status == "failed":
        readiness = "not_usable"
    return {
        "domain": outcome["domain"],
        "status": "ready"
        if status == "ready"
        else "failed"
        if status == "failed"
        else "needs_source",
        "detail": outcome.get("detail", "No detail was reported."),
        "manifest_sha256": manifest_sha256,
        "readiness": readiness,
        "limitations": [outcome.get("detail", "No detail was reported.")],
    }


def _coverage_label(aoi: dict[str, Any]) -> str:
    provenance = aoi.get("boundary_provenance", {})
    if aoi.get("input_type") == "administrative_selection":
        return f"PRG administrative selection: {', '.join(provenance.get('unit_ids', []))}"
    return "Resolved bounded point/radius AOI"


def _shared_overpass_endpoint(outcomes: list[dict[str, Any]]) -> str | None:
    endpoints = {
        endpoint
        for outcome in outcomes
        if isinstance((endpoint := outcome.get("overpass_endpoint")), str)
    }
    return next(iter(endpoints)) if len(endpoints) == 1 else None


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    staged = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        staged.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        os.replace(staged, path)
    finally:
        if staged.exists():
            staged.unlink()


def _nonnegative_int(value: Any) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
