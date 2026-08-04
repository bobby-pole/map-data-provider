"""Fixture-first transport normalization with explicit facility and network semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.source_registry import guard_source_access

TRANSPORT_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_60km" / "transport" / "osm-transport.geojson"
TRANSPORT_SNAPSHOT_AT = "2026-08-03T21:00:00Z"
TRANSPORT_LIMITATIONS = [
    "OSM transport mapping completeness and classification vary by area, operator and transport mode.",
    "The bounded committed snapshot is fixture evidence for major transport infrastructure and not a statement of operational capacity or real-time schedule.",
    "BDOT10k road and railway geometry is retained only as topographic comparison context and cannot establish transport service semantics alone.",
    "No qualified PRG transport network or facility class is enabled for this domain pack.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "roads": (("highway", "motorway"), ("highway", "trunk"), ("highway", "primary")),
    "railways": (("railway", "rail"),),
    "stations": (("railway", "station"), ("railway", "halt")),
    "aviation": (("aeroway", "aerodrome"), ("aeroway", "helipad")),
}


def load_osm_transport_fixture() -> dict[str, Any]:
    return guard_source_access("openstreetmap", "local_import", lambda: json.loads(TRANSPORT_FIXTURE.read_text(encoding="utf-8")))


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    for category, mappings in FACILITY_MAPPINGS.items():
        if any(properties.get(key) == value for key, value in mappings):
            return category
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_transport_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Transport OSM fixture must be a GeoJSON FeatureCollection")
    categorized = {category: [] for category in FACILITY_MAPPINGS}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Transport OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError("Transport OSM fixture contains a feature without an allow-listed facility mapping")
        categorized[category].append({**deepcopy(feature), "properties": {**deepcopy(properties), "provider_category": category}})
    if any(not category_features for category_features in categorized.values()):
        missing = sorted(category for category, category_features in categorized.items() if not category_features)
        raise ValueError(f"Transport OSM fixture is missing required categories: {', '.join(missing)}")
    return categorized


def transport_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_60km",
        "domain": "transport",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Bounded Overpass snapshot: explicit transport highway, railway and aeroway tags within the Rybnik 60 km AOI.",
        "snapshot_at": TRANSPORT_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/transport/v1",
        "query_version": "transport-osm/v1",
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(TRANSPORT_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_transport_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=transport_osm_metadata(layer_id=f"transport.{category}", readiness=readiness),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_transport_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [feature for category_features in categorized_osm_features().values() for feature in category_features]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=transport_osm_metadata(layer_id="transport.osm_facilities", readiness=readiness),
    )
