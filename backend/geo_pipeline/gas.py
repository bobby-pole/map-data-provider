"""Fixture-first gas domain normalization with explicit facility and pipeline semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.source_registry import guard_source_access

GAS_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_35km" / "gas" / "osm-gas.geojson"
GAS_SNAPSHOT_AT = "2026-08-06T19:00:00Z"
GAS_LIMITATIONS = [
    "OSM gas infrastructure and distribution network mapping completeness varies significantly by area.",
    "The committed contract fixture demonstrates normalized gas categories; it is not a complete Rybnik 35 km OSM snapshot or an operational pressure or flow model.",
    "Generic unlabelled pipelines and valves without explicit gas tags are excluded to prevent false gas attribution.",
    "KIUT gas WMS layers are visual reference overlays only and do not replace analytical vector artifacts.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "facilities": (("man_made", "gasometer"), ("man_made", "gas_station"), ("pipeline", "valve")),
    "pipelines": (("pipeline", "gas"), ("man_made", "pipeline")),
}


def load_osm_gas_fixture() -> dict[str, Any]:
    return guard_source_access("openstreetmap", "local_import", lambda: json.loads(GAS_FIXTURE.read_text(encoding="utf-8")))


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    """Classify only features whose tags explicitly establish gas semantics.

    ``pipeline=valve`` identifies a pipeline component, not its transported
    substance, so a valve requires ``substance=gas``.  The same rule applies
    to the standard ``man_made=pipeline`` representation.  ``pipeline=gas``
    is retained as a backward-compatible explicit legacy representation.
    """
    if properties.get("man_made") in {"gasometer", "gas_station"}:
        return "facilities"
    if properties.get("pipeline") == "valve" and properties.get("substance") == "gas":
        return "facilities"
    if properties.get("pipeline") == "gas":
        return "pipelines"
    if properties.get("man_made") == "pipeline" and properties.get("substance") == "gas":
        return "pipelines"
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_gas_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Gas OSM fixture must be a GeoJSON FeatureCollection")
    categorized: dict[str, list[dict[str, Any]]] = {category: [] for category in FACILITY_MAPPINGS}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Gas OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError("Gas OSM fixture contains a feature without an allow-listed gas mapping")
        props = {**deepcopy(properties), "provider_category": category}
        categorized[category].append({**deepcopy(feature), "properties": props})
    if any(not category_features for category_features in categorized.values()):
        missing = sorted(category for category, category_features in categorized.items() if not category_features)
        raise ValueError(f"Gas OSM fixture is missing required categories: {', '.join(missing)}")
    return categorized


def gas_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "gas",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Fixture contract evidence for gas-osm/v2: gasometer/gas station, pipeline=gas, or gas-substance pipeline and valve tags.",
        "snapshot_at": GAS_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/gas/v2",
        "query_version": "gas-osm/v2",
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(GAS_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_gas_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=gas_osm_metadata(layer_id=f"gas.{category}", readiness=readiness),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_gas_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [feature for category_features in categorized_osm_features().values() for feature in category_features]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=gas_osm_metadata(layer_id="gas.osm_facilities", readiness=readiness),
    )
