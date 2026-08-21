"""Fixture-first water domain normalization with explicit facility, pipeline and waterway semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.query_catalog import WATER_OSM_QUERY
from geo_pipeline.source_registry import guard_source_access

WATER_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "rybnik_35km"
    / "water"
    / "osm-water.geojson"
)
WATER_SNAPSHOT_AT = "2026-08-04T23:00:00Z"
WATER_LIMITATIONS = [
    "OSM water infrastructure and waterway mapping completeness varies by area and operator.",
    "The bounded committed snapshot is fixture evidence for water facilities, supply pipelines and watercourses, not an operational hydraulic rating or pressure model.",
    "BDOT10k hydrographic geometry is retained only as topographic comparison context and cannot establish water service semantics alone.",
    "KIUT water WMS layers are visual reference overlays only and do not replace analytical vector artifacts.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "facilities": (
        ("man_made", "water_works"),
        ("man_made", "water_tower"),
        ("amenity", "water_point"),
    ),
    "pipelines": (("pipeline", "water"),),
    "waterways": (
        ("waterway", "river"),
        ("waterway", "stream"),
        ("waterway", "canal"),
        ("waterway", "drain"),
        ("waterway", "ditch"),
    ),
}


def load_osm_water_fixture() -> dict[str, Any]:
    return guard_source_access(
        "openstreetmap",
        "local_import",
        lambda: json.loads(WATER_FIXTURE.read_text(encoding="utf-8")),
    )


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    for category, mappings in FACILITY_MAPPINGS.items():
        if any(properties.get(key) == value for key, value in mappings):
            return category
    if properties.get("man_made") == "pumping_station" and properties.get("pumping") == "water":
        return "facilities"
    if properties.get("man_made") == "pumping_station" and properties.get("substance") == "water":
        return "facilities"
    if properties.get("man_made") == "pipeline" and properties.get("substance") == "water":
        return "pipelines"
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_water_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Water OSM fixture must be a GeoJSON FeatureCollection")
    categorized: dict[str, list[dict[str, Any]]] = {category: [] for category in FACILITY_MAPPINGS}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Water OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError(
                "Water OSM fixture contains a feature without an allow-listed water mapping"
            )
        props = {**deepcopy(properties), "provider_category": category}
        categorized[category].append({**deepcopy(feature), "properties": props})
    if any(not category_features for category_features in categorized.values()):
        missing = sorted(
            category for category, category_features in categorized.items() if not category_features
        )
        raise ValueError(f"Water OSM fixture is missing required categories: {', '.join(missing)}")
    return categorized


def water_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "water",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Bounded Overpass snapshot: explicit water facility, pipeline and waterway tags within the Rybnik 35 km AOI.",
        "snapshot_at": WATER_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/water/v2",
        "query_version": WATER_OSM_QUERY.query_version,
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(WATER_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_water_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=water_osm_metadata(layer_id=f"water.{category}", readiness=readiness),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_water_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [
        feature
        for category_features in categorized_osm_features().values()
        for feature in category_features
    ]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=water_osm_metadata(layer_id="water.osm_facilities", readiness=readiness),
    )
