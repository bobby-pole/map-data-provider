"""Cache-first AOI/domain artifacts for the provider's analytical vector layers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from geo_pipeline.aoi import resolve_aoi, validate_cache_key
from geo_pipeline.config import CACHE_DIR, RYBNIK_AOI
from geo_pipeline.contracts import (
    CONTRACT_VERSION,
    READINESS_VALUES,
    normalize_analytical_vector_layer,
    validate_provider_geojson,
)
from geo_pipeline.bridges import build_osm_bridges_cache_layer, bridges_osm_metadata
from geo_pipeline.emergency import build_osm_emergency_cache_layer, emergency_osm_metadata
from geo_pipeline.gas import build_osm_gas_cache_layer, gas_osm_metadata
from geo_pipeline.sewer import build_osm_sewer_cache_layer, sewer_osm_metadata
from geo_pipeline.industrial import build_osm_industrial_cache_layer, industrial_osm_metadata
from geo_pipeline.public_services import build_osm_public_services_cache_layer, public_services_osm_metadata
from geo_pipeline.transport import build_osm_transport_cache_layer, transport_osm_metadata
from geo_pipeline.water import build_osm_water_cache_layer, water_osm_metadata
from geo_pipeline.quality_rules import highest_issue_severity, triggered_issues
from geo_pipeline.readiness import derive_readiness
from geo_pipeline.source_registry import guard_source_access, validate_analytical_cache_provenance

CACHE_LAYOUT_VERSION = "provider_cache/v1"
POWER_LINES_SOURCE = Path(__file__).resolve().parents[1] / "data/processed/rybnik_60km_power_lines_clipped.geojson"
POWER_VALIDATION_REPORT = Path(__file__).resolve().parents[1] / "data/reports/rybnik_60km_power_validation_clipped.json"
POWER_LIMITATIONS = [
    "OSM completeness varies by area and asset type.",
    "Passed validation does not prove complete real-world infrastructure coverage.",
]
POWER_SOURCE_QUERY = "OSMnx features_from_point: power and man_made=utility_pole tags for Rybnik 60 km AOI."
POWER_SOURCE_URL = "https://overpass-api.de/api/interpreter"
POWER_PIPELINE_VERSION = "geo_pipeline/cache/v1"
POWER_QUERY_VERSION = "power-osmnx/v1"


@dataclass(frozen=True)
class CachePaths:
    root: Path
    layer: Path
    metadata: Path
    readiness: Path


def cache_paths(aoi_id: str, domain: str, *, root: Path | None = None) -> CachePaths:
    effective_root = CACHE_DIR if root is None else root
    cache_root = effective_root / validate_cache_key(aoi_id) / domain
    return CachePaths(
        root=cache_root,
        layer=cache_root / "layer.geojson",
        metadata=cache_root / "metadata.json",
        readiness=cache_root / "readiness.json",
    )


def build_rybnik_power_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build the committed Rybnik power-lines cache from local artifacts only."""
    source = guard_source_access("openstreetmap", "local_import", lambda: _read_json(POWER_LINES_SOURCE))
    validation_report = guard_source_access("openstreetmap", "local_import", lambda: _read_json(POWER_VALIDATION_REPORT))
    quality_status = _normalize_validation_status(validation_report.get("status"))
    metadata = {
        "cache_layout_version": CACHE_LAYOUT_VERSION,
        "geojson_contract_version": CONTRACT_VERSION,
        "aoi_id": resolve_aoi("rybnik_60km").cache_key,
        "domain": "power",
        "layer_id": "power.lines",
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": POWER_SOURCE_URL,
        "source_query": POWER_SOURCE_QUERY,
        "snapshot_at": "2026-07-22T00:00:00Z",
        "pipeline_version": POWER_PIPELINE_VERSION,
        "query_version": POWER_QUERY_VERSION,
        "validation_status_raw": validation_report.get("status"),
        "quality_status": quality_status,
        "confidence": "medium",
        "limitations": POWER_LIMITATIONS,
        "eligible_for_analysis": True,
        "readiness": "ready",
    }
    layer = normalize_analytical_vector_layer(source, metadata=metadata)
    quality_input = {
        **layer["metadata"],
        "id": layer["metadata"]["layer_id"],
        "label": "Power lines",
        "feature_count": layer["metadata"]["feature_count"],
        "not_authoritative": False,
        "missing_required_attributes": sorted(
            {field for feature in layer["features"] for field in feature["properties"]["missing_fields"]}
        ),
        "invalid_geometry_count": 0,
        "duplicate_count": 0,
        "unsupported_geometry_types": [],
    }
    issues = triggered_issues(quality_input)
    highest_severity = highest_issue_severity(issues)
    readiness_value = derive_readiness(
        quality_status=quality_status,
        feature_count=layer["metadata"]["feature_count"],
        source_type="analytical_vector",
        issue_severity=highest_severity,
    )
    layer["metadata"]["readiness"] = readiness_value

    provenance = {
        **metadata,
        "feature_count": layer["metadata"]["feature_count"],
        "readiness": readiness_value,
    }
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION,
        "aoi_id": RYBNIK_AOI.name,
        "domain": "power",
        "layer_id": "power.lines",
        "readiness": readiness_value,
        "quality_status": quality_status,
        "highest_issue_severity": highest_severity,
        "feature_count": layer["metadata"]["feature_count"],
        "evaluated_at": provenance["snapshot_at"],
    }
    paths = cache_paths(RYBNIK_AOI.name, "power", root=root)
    _write_cache(paths, layer=layer, metadata=provenance, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_emergency_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build the v1-compatible emergency cache from committed OSM fixture evidence."""
    layer = build_osm_emergency_cache_layer(readiness="usable_with_limitations")
    metadata = {
        **emergency_osm_metadata(layer_id="emergency.osm_facilities", readiness="usable_with_limitations"),
        "feature_count": layer["metadata"]["feature_count"],
    }
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION,
        "aoi_id": "rybnik_60km",
        "domain": "emergency",
        "layer_id": "emergency.osm_facilities",
        "readiness": "usable_with_limitations",
        "quality_status": "warning",
        "highest_issue_severity": "medium",
        "feature_count": layer["metadata"]["feature_count"],
        "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "emergency", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_public_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible public-services cache from committed OSM evidence."""
    layer = build_osm_public_services_cache_layer(readiness="usable_with_limitations")
    metadata = {**public_services_osm_metadata(layer_id="public.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "public",
        "layer_id": "public.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "public", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_transport_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible transport cache from committed OSM evidence."""
    layer = build_osm_transport_cache_layer(readiness="usable_with_limitations")
    metadata = {**transport_osm_metadata(layer_id="transport.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "transport",
        "layer_id": "transport.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "transport", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_bridges_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible bridges cache from committed OSM evidence."""
    layer = build_osm_bridges_cache_layer(readiness="usable_with_limitations")
    metadata = {**bridges_osm_metadata(layer_id="bridges.osm_structures", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "bridges",
        "layer_id": "bridges.osm_structures", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "bridges", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_water_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible water cache from committed OSM evidence."""
    layer = build_osm_water_cache_layer(readiness="usable_with_limitations")
    metadata = {**water_osm_metadata(layer_id="water.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "water",
        "layer_id": "water.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "water", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_gas_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible gas cache from committed OSM evidence."""
    layer = build_osm_gas_cache_layer(readiness="usable_with_limitations")
    metadata = {**gas_osm_metadata(layer_id="gas.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "gas",
        "layer_id": "gas.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "gas", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_sewer_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible sewer cache from committed OSM evidence."""
    layer = build_osm_sewer_cache_layer(readiness="usable_with_limitations")
    metadata = {**sewer_osm_metadata(layer_id="sewer.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "sewer",
        "layer_id": "sewer.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "sewer", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def build_rybnik_industrial_cache(*, root: Path = CACHE_DIR) -> dict[str, Any]:
    """Build a v1-compatible industrial cache from committed OSM evidence."""
    layer = build_osm_industrial_cache_layer(readiness="usable_with_limitations")
    metadata = {**industrial_osm_metadata(layer_id="industrial.osm_facilities", readiness="usable_with_limitations"), "feature_count": layer["metadata"]["feature_count"]}
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION, "aoi_id": "rybnik_60km", "domain": "industrial",
        "layer_id": "industrial.osm_facilities", "readiness": "usable_with_limitations", "quality_status": "warning",
        "highest_issue_severity": "medium", "feature_count": metadata["feature_count"], "evaluated_at": metadata["snapshot_at"],
    }
    paths = cache_paths("rybnik_60km", "industrial", root=root)
    _write_cache(paths, layer=layer, metadata=metadata, readiness=readiness)
    return read_cached_layer(paths)


def read_cached_layer(paths: CachePaths) -> dict[str, Any]:
    """Read and validate a complete cache layout without extraction or refresh work."""
    missing = [path.name for path in (paths.layer, paths.metadata, paths.readiness) if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Incomplete provider cache: missing {', '.join(missing)}")
    layer = _read_json(paths.layer)
    metadata = _read_json(paths.metadata)
    readiness = _read_json(paths.readiness)
    errors = validate_provider_geojson(layer)
    if errors:
        raise ValueError(f"Invalid cached GeoJSON: {', '.join(errors)}")
    _validate_cache_records(layer=layer, metadata=metadata, readiness=readiness)
    return {"layer": layer, "metadata": metadata, "readiness": readiness}


def _write_cache(paths: CachePaths, *, layer: dict[str, Any], metadata: dict[str, Any], readiness: dict[str, Any]) -> None:
    paths.root.mkdir(parents=True, exist_ok=True)
    for path, payload in ((paths.layer, layer), (paths.metadata, metadata), (paths.readiness, readiness)):
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _validate_cache_records(*, layer: dict[str, Any], metadata: dict[str, Any], readiness: dict[str, Any]) -> None:
    required_metadata = {
        "cache_layout_version",
        "geojson_contract_version",
        "aoi_id",
        "domain",
        "layer_id",
        "source",
        "source_type",
        "snapshot_at",
        "feature_count",
        "validation_status_raw",
        "quality_status",
        "confidence",
        "limitations",
        "readiness",
    }
    if not required_metadata <= set(metadata):
        raise ValueError("Cached metadata is missing required provenance fields")
    if metadata["cache_layout_version"] != CACHE_LAYOUT_VERSION:
        raise ValueError("Unsupported cache layout version")
    if metadata["geojson_contract_version"] != CONTRACT_VERSION:
        raise ValueError("Unsupported cached GeoJSON contract version")
    if metadata["feature_count"] != len(layer["features"]):
        raise ValueError("Cached metadata feature count does not match layer")
    if metadata["source_type"] != "analytical_vector":
        raise ValueError("This cache layout is reserved for analytical vector layers")
    validate_analytical_cache_provenance(metadata)
    required_readiness = {
        "cache_layout_version",
        "aoi_id",
        "domain",
        "layer_id",
        "readiness",
        "quality_status",
        "highest_issue_severity",
        "feature_count",
        "evaluated_at",
    }
    if not required_readiness <= set(readiness):
        raise ValueError("Cached readiness record is missing required fields")
    if readiness["cache_layout_version"] != CACHE_LAYOUT_VERSION:
        raise ValueError("Unsupported cached readiness layout version")
    if readiness["readiness"] not in READINESS_VALUES:
        raise ValueError("Cached readiness has an unsupported value")
    if readiness["feature_count"] != metadata["feature_count"]:
        raise ValueError("Cached readiness feature count does not match metadata")
    if metadata["readiness"] != readiness["readiness"] or layer["metadata"]["readiness"] != readiness["readiness"]:
        raise ValueError("Cached readiness values do not match")
    if layer["metadata"]["feature_count"] != metadata["feature_count"]:
        raise ValueError("Cached GeoJSON feature count does not match metadata")
    for key in ("aoi_id", "domain", "layer_id"):
        if readiness[key] != metadata[key] or layer["metadata"][key] != metadata[key]:
            raise ValueError(f"Cached {key} values do not match")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_validation_status(value: object) -> str:
    status = str(value or "").strip().casefold()
    if status in {"pass", "ok", "success", "valid"}:
        return "passed"
    if status in {"warn", "warning"}:
        return "warning"
    if status in {"fail", "failed", "error", "invalid"}:
        return "failed"
    return "unknown"
