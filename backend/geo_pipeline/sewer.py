"""Fixture-first sewer domain normalization with explicit facility and pipeline semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.query_catalog import SEWER_OSM_QUERY
from geo_pipeline.source_registry import guard_source_access

SEWER_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_60km" / "sewer" / "osm-sewer.geojson"
SEWER_SNAPSHOT_AT = "2026-08-07T15:30:00Z"
SEWER_LIMITATIONS = [
    "OSM sewer infrastructure and wastewater collection network mapping completeness varies significantly by area.",
    "The committed contract fixture demonstrates normalized sewer categories; it is not a complete Rybnik 60 km OSM snapshot or an operational hydraulic flow model.",
    "Generic unlabelled pipelines, water pipelines, and gas pipelines are excluded to prevent false sewer attribution.",
    "KIUT sewer WMS layers are visual reference overlays only and do not replace analytical vector artifacts.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "facilities": (("man_made", "wastewater_plant"), ("man_made", "septic_tank")),
    "pipelines": (("pipeline", "sewer"),),
}
SEWER_SUBSTANCES = {"sewerage", "wastewater"}
NON_SEWER_SEMANTICS = {"water", "gas", "stormwater", "drain", "drainage"}


def load_osm_sewer_fixture() -> dict[str, Any]:
    return guard_source_access("openstreetmap", "local_import", lambda: json.loads(SEWER_FIXTURE.read_text(encoding="utf-8")))


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    """Classify only features whose tags explicitly establish sewer/wastewater semantics."""
    if any(properties.get(key) in NON_SEWER_SEMANTICS for key in ("pipeline", "pumping", "substance", "utility", "sewer")):
        return None
    if properties.get("man_made") in {"wastewater_plant", "septic_tank"}:
        return "facilities"
    if properties.get("man_made") == "pumping_station" and (
        properties.get("pumping") in {"sewer", "wastewater"} or properties.get("substance") in SEWER_SUBSTANCES
    ):
        return "facilities"
    if properties.get("man_made") == "manhole" and properties.get("utility") == "sewer":
        return "facilities"
    if properties.get("pipeline") == "sewer" and properties.get("substance") in {None, *SEWER_SUBSTANCES}:
        return "pipelines"
    if properties.get("man_made") == "pipeline" and properties.get("substance") in SEWER_SUBSTANCES:
        return "pipelines"
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_sewer_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Sewer OSM fixture must be a GeoJSON FeatureCollection")
    categorized: dict[str, list[dict[str, Any]]] = {category: [] for category in FACILITY_MAPPINGS}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Sewer OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError("Sewer OSM fixture contains a feature without an allow-listed sewer mapping")
        props = {**deepcopy(properties), "provider_category": category}
        categorized[category].append({**deepcopy(feature), "properties": props})
    if any(not category_features for category_features in categorized.values()):
        missing = sorted(category for category, category_features in categorized.items() if not category_features)
        raise ValueError(f"Sewer OSM fixture is missing required categories: {', '.join(missing)}")
    return categorized


def sewer_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_60km",
        "domain": "sewer",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Fixture contract evidence for sewer-osm/v2: wastewater_plant, septic_tank, pipeline=sewer, and explicit sewer/wastewater tags.",
        "snapshot_at": SEWER_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/sewer/v2",
        "query_version": SEWER_OSM_QUERY.query_version,
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(SEWER_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_sewer_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=sewer_osm_metadata(layer_id=f"sewer.{category}", readiness=readiness),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_sewer_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [feature for category_features in categorized_osm_features().values() for feature in category_features]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=sewer_osm_metadata(layer_id="sewer.osm_facilities", readiness=readiness),
    )
