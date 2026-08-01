"""Native-artifact domain-pack cache v2 with v1 compatibility helpers."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from geo_pipeline.aoi import validate_cache_key
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.source_registry import load_source_registry, validate_ordered_provenance

DOMAIN_PACK_VERSION = "provider_domain_pack/v2"
PACK_DIRNAME = "domain-pack-v2"
ARTIFACT_KINDS = {"native_vector", "native_raster", "remote_service", "processed_vector", "derived_vector", "representative_points"}
FILE_KINDS = {"native_vector", "native_raster", "processed_vector", "derived_vector", "representative_points"}


def domain_pack_root(aoi_id: str, domain: str, *, root: Path) -> Path:
    return root / validate_cache_key(aoi_id) / domain / PACK_DIRNAME


def read_domain_pack(aoi_id: str, domain: str, *, root: Path, public_export: bool = False) -> dict[str, Any]:
    pack_root = domain_pack_root(aoi_id, domain, root=root)
    manifest_path = pack_root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing domain-pack manifest: {manifest_path.name}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_domain_pack(manifest, pack_root=pack_root, public_export=public_export)
    artifacts = manifest["artifacts"]
    if public_export:
        artifacts = [artifact for artifact in artifacts if artifact["public_export"]]
    return {**manifest, "artifacts": artifacts}


def validate_domain_pack(manifest: dict[str, Any], *, pack_root: Path, public_export: bool = False) -> None:
    required = {"domain_pack_version", "aoi_id", "domain", "source_provenance", "artifacts", "validation", "readiness"}
    if not isinstance(manifest, dict) or not required <= set(manifest):
        raise ValueError("Domain-pack manifest is missing required fields")
    if manifest["domain_pack_version"] != DOMAIN_PACK_VERSION:
        raise ValueError("Unsupported domain-pack version")
    if not isinstance(manifest["aoi_id"], str) or not isinstance(manifest["domain"], str):
        raise ValueError("Domain-pack identity must contain AOI and domain")
    registry = load_source_registry()
    validate_ordered_provenance(manifest["source_provenance"], registry, public_export=False)
    if not isinstance(manifest["artifacts"], list) or not manifest["artifacts"]:
        raise ValueError("Domain-pack must contain artifacts")

    ids: set[str] = set()
    for artifact in manifest["artifacts"]:
        _validate_artifact(artifact, pack_root=pack_root, registry=registry, public_export=public_export, artifact_ids=ids)
    for record_name in ("validation", "readiness"):
        record = manifest[record_name]
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise ValueError(f"Domain-pack {record_name} requires a file path")
        _safe_file(pack_root, record["path"])


def write_domain_pack(aoi_id: str, domain: str, *, root: Path, manifest: dict[str, Any], files: dict[str, bytes]) -> dict[str, Any]:
    target = domain_pack_root(aoi_id, domain, root=root)
    staging = target.parent / f".{PACK_DIRNAME}-staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir(parents=True)
        for relative_path, payload in files.items():
            path = _safe_file(staging, relative_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        manifest_path = staging / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        validate_domain_pack(manifest, pack_root=staging)
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = target.parent / f".{PACK_DIRNAME}-backup-{uuid.uuid4().hex}"
        if target.exists():
            target.replace(backup)
        try:
            staging.replace(target)
        except Exception:
            if backup.exists() and not target.exists():
                backup.replace(target)
            raise
        finally:
            shutil.rmtree(backup, ignore_errors=True)
        return read_domain_pack(aoi_id, domain, root=root)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def build_rybnik_power_domain_pack(*, root: Path) -> dict[str, Any]:
    legacy = read_cached_layer(cache_paths("rybnik_60km", "power", root=root))
    pack_root = domain_pack_root("rybnik_60km", "power", root=root)
    layer_bytes = json.dumps(legacy["layer"], ensure_ascii=False, indent=2).encode()
    metadata_bytes = json.dumps(legacy["metadata"], ensure_ascii=False, indent=2).encode()
    readiness_bytes = json.dumps(legacy["readiness"], ensure_ascii=False, indent=2).encode()
    source_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION, "aoi_id": "rybnik_60km", "domain": "power",
        "source_provenance": source_provenance,
        "artifacts": [
            {"id": "power.lines", "kind": "processed_vector", "format": "geojson", "path": "layers/power.lines.geojson",
             "sha256": _digest(layer_bytes), "feature_count": legacy["metadata"]["feature_count"],
             "source_provenance": source_provenance, "public_export": True},
            {"id": "power.representative_points", "kind": "representative_points", "format": "geojson",
             "not_applicable_reason": "Representative points are deferred until multi-layer power classification.", "source_provenance": source_provenance, "public_export": False},
            {"id": "power.source_metadata", "kind": "native_vector", "format": "json", "path": "native/metadata.json",
             "sha256": _digest(metadata_bytes), "source_provenance": source_provenance, "public_export": False},
        ],
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    return write_domain_pack("rybnik_60km", "power", root=root, manifest=manifest, files={
        "layers/power.lines.geojson": layer_bytes, "native/metadata.json": metadata_bytes,
        "validation/metadata.json": metadata_bytes, "readiness/readiness.json": readiness_bytes,
    })


def _validate_artifact(artifact: Any, *, pack_root: Path, registry: dict[str, Any], public_export: bool, artifact_ids: set[str]) -> None:
    required = {"id", "kind", "format", "source_provenance", "public_export"}
    if not isinstance(artifact, dict) or not required <= set(artifact):
        raise ValueError("Domain-pack artifact is missing required fields")
    if artifact["id"] in artifact_ids or not isinstance(artifact["id"], str):
        raise ValueError("Domain-pack artifact IDs must be unique")
    artifact_ids.add(artifact["id"])
    if artifact["kind"] not in ARTIFACT_KINDS:
        raise ValueError("Unsupported domain-pack artifact kind")
    validate_ordered_provenance(artifact["source_provenance"], registry, public_export=bool(artifact["public_export"]))
    if public_export and artifact["public_export"] is not True:
        return
    path = artifact.get("path")
    if artifact["kind"] in FILE_KINDS and not isinstance(path, str):
        if not artifact.get("not_applicable_reason"):
            raise ValueError("File-backed artifact requires a path or not-applicable reason")
        return
    if path is not None:
        file_path = _safe_file(pack_root, path)
        if not file_path.exists():
            raise FileNotFoundError(f"Domain-pack artifact is missing: {path}")
        if artifact.get("sha256") != _digest(file_path.read_bytes()):
            raise ValueError("Domain-pack artifact checksum does not match")
        if artifact.get("feature_count") is not None:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
            if payload.get("type") != "FeatureCollection" or len(payload.get("features", [])) != artifact["feature_count"]:
                raise ValueError("Domain-pack artifact feature count does not match")
    elif artifact["kind"] != "remote_service":
        raise ValueError("Non-remote artifact requires a path or not-applicable reason")


def _safe_file(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if not relative_path or candidate == root.resolve() or root.resolve() not in candidate.parents:
        raise ValueError("Domain-pack path escapes its root")
    return candidate


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
