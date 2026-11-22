"""Atomic filesystem storage and contract validation for domain-pack-v2 caches."""

from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.aoi import validate_cache_key
from geo_pipeline.config import CACHE_DIR as DOMAIN_PACKS_DIR
from geo_pipeline.source_registry import (
    load_source_registry,
    validate_ordered_provenance,
)

DOMAIN_PACK_VERSION = "provider_domain_pack/v2"
PACK_DIRNAME = "domain-pack-v2"
OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
OSM_ODBL_NOTICE_PATH = "licenses/openstreetmap-odbl.md"
ARTIFACT_KINDS = {
    "native_vector",
    "native_raster",
    "remote_service",
    "processed_vector",
    "derived_vector",
    "representative_points",
}
FILE_KINDS = {
    "native_vector",
    "native_raster",
    "processed_vector",
    "derived_vector",
    "representative_points",
}


def domain_pack_root(aoi_id: str, domain: str, *, root: Path | None = None) -> Path:
    effective_root = DOMAIN_PACKS_DIR if root is None else root
    return effective_root / validate_cache_key(aoi_id) / domain / PACK_DIRNAME


def read_domain_pack(
    aoi_id: str, domain: str, *, root: Path | None = None, public_export: bool = False
) -> dict[str, Any]:
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


def validate_domain_pack(
    manifest: dict[str, Any], *, pack_root: Path, public_export: bool = False
) -> None:
    required = {
        "domain_pack_version",
        "aoi_id",
        "domain",
        "source_provenance",
        "artifacts",
        "validation",
        "readiness",
    }
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
        _validate_artifact(
            artifact,
            pack_root=pack_root,
            registry=registry,
            public_export=public_export,
            artifact_ids=ids,
        )
    for record_name in ("validation", "readiness"):
        record = manifest[record_name]
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise ValueError(f"Domain-pack {record_name} requires a file path")
        _safe_file(pack_root, record["path"])
    _validate_public_data_license_notices(manifest, pack_root=pack_root, registry=registry)


def write_domain_pack(
    aoi_id: str,
    domain: str,
    *,
    root: Path | None = None,
    manifest: dict[str, Any],
    files: dict[str, bytes],
) -> dict[str, Any]:
    manifest, files = _with_public_data_license_notices(manifest, files)
    target = domain_pack_root(aoi_id, domain, root=root)
    staging = target.parent / f".{PACK_DIRNAME}-staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir(parents=True)
        for relative_path, payload in files.items():
            path = _safe_file(staging, relative_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        manifest_path = staging / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
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


def _with_public_data_license_notices(
    manifest: dict[str, Any], files: dict[str, bytes]
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Attach source-specific licence notices to every public OSM data pack.

    The notice is intentionally stored inside the distributable pack, rather
    than only in repository documentation, so a copied bundle keeps the ODbL
    attribution and licence link with its exported database.
    """
    public_source_ids = {
        record["source_id"]
        for artifact in manifest.get("artifacts", [])
        if artifact.get("public_export") is True
        for record in artifact.get("source_provenance", [])
        if isinstance(record, dict) and isinstance(record.get("source_id"), str)
    }
    if "openstreetmap" not in public_source_ids:
        return manifest, files

    updated_manifest = deepcopy(manifest)
    updated_files = dict(files)
    updated_files[OSM_ODBL_NOTICE_PATH] = (
        "OpenStreetMap data notice\n\n"
        "This domain pack includes data derived from OpenStreetMap contributors. "
        "It is made available under the Open Database License (ODbL) 1.0.\n\n"
        f"Attribution: © OpenStreetMap contributors — {OSM_COPYRIGHT_URL}\n"
        "Licence: https://opendatacommons.org/licenses/odbl/1-0/\n\n"
        "When redistributing this database or a derivative database, retain this "
        "notice and comply with the ODbL attribution, notice and share-alike terms.\n"
    ).encode("utf-8")
    updated_manifest["data_license_notices"] = [
        {
            "source_id": "openstreetmap",
            "license": "ODbL-1.0",
            "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
            "attribution": "© OpenStreetMap contributors",
            "attribution_url": OSM_COPYRIGHT_URL,
            "notice_path": OSM_ODBL_NOTICE_PATH,
        }
    ]
    return updated_manifest, updated_files


def _validate_public_data_license_notices(
    manifest: dict[str, Any], *, pack_root: Path, registry: dict[str, Any]
) -> None:
    public_source_ids = {
        record["source_id"]
        for artifact in manifest["artifacts"]
        if artifact.get("public_export") is True
        for record in artifact["source_provenance"]
    }
    if "openstreetmap" not in public_source_ids:
        return

    notices = manifest.get("data_license_notices")
    if not isinstance(notices, list) or len(notices) != 1:
        raise ValueError("Public OpenStreetMap artifacts require one data licence notice")
    notice = notices[0]
    expected = {
        "source_id": "openstreetmap",
        "license": "ODbL-1.0",
        "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
        "attribution": "© OpenStreetMap contributors",
        "attribution_url": OSM_COPYRIGHT_URL,
        "notice_path": OSM_ODBL_NOTICE_PATH,
    }
    if not isinstance(notice, dict) or notice != expected:
        raise ValueError(
            "OpenStreetMap data licence notice does not match the required ODbL notice"
        )
    if not _safe_file(pack_root, OSM_ODBL_NOTICE_PATH).exists():
        raise FileNotFoundError("Domain-pack OpenStreetMap data licence notice is missing")


def _merge_osm_attributes(layer: dict[str, Any], evidence: dict[str, Any]) -> None:
    attributes = evidence.get("attributes")
    if not isinstance(attributes, dict):
        raise ValueError("OSM attribute evidence requires an attributes mapping")
    for feature in layer.get("features", []):
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        source_id = properties.get("source_id")
        source_tags = attributes.get(source_id)
        if not isinstance(source_tags, dict):
            continue
        existing = properties.get("osm_tags")
        properties["osm_tags"] = {
            **(existing if isinstance(existing, dict) else {}),
            **source_tags,
        }


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_artifact(
    artifact: Any,
    *,
    pack_root: Path,
    registry: dict[str, Any],
    public_export: bool,
    artifact_ids: set[str],
) -> None:
    required = {"id", "kind", "format", "source_provenance", "public_export"}
    if not isinstance(artifact, dict) or not required <= set(artifact):
        raise ValueError("Domain-pack artifact is missing required fields")
    if artifact["id"] in artifact_ids or not isinstance(artifact["id"], str):
        raise ValueError("Domain-pack artifact IDs must be unique")
    artifact_ids.add(artifact["id"])
    if artifact["kind"] not in ARTIFACT_KINDS:
        raise ValueError("Unsupported domain-pack artifact kind")
    if artifact["kind"] == "native_raster" and artifact["public_export"] is True:
        raise ValueError(
            "Native raster artifacts cannot be publicly exported through vector-only paths"
        )
    validate_ordered_provenance(
        artifact["source_provenance"],
        registry,
        public_export=bool(artifact["public_export"]),
    )
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
            if (
                payload.get("type") != "FeatureCollection"
                or len(payload.get("features", [])) != artifact["feature_count"]
            ):
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
