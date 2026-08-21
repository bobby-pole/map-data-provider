"""Fixture-first OSM emergency-facility normalization for the provider."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.source_registry import guard_source_access

EMERGENCY_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "rybnik_35km"
    / "emergency"
    / "osm-emergency-facilities.geojson"
)
PRG_EMERGENCY_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "rybnik_35km"
    / "emergency"
    / "prg-police-fire-representative-points.geojson"
)
EMERGENCY_SNAPSHOT_AT = "2026-08-03T10:14:06Z"
EMERGENCY_SOURCE_QUERY = (
    "Overpass bounded snapshot: explicit amenity=hospital|fire_station|police|ambulance_station, "
    "healthcare=hospital and emergency=ambulance_station|mountain_rescue|lifeguard_base within the Rybnik 35 km AOI."
)
EMERGENCY_LIMITATIONS = [
    "OSM emergency and healthcare mapping completeness varies by area and facility type.",
    "The bounded committed snapshot is not a complete emergency-service registry or an operational-status statement.",
    "No qualified official hospital or ambulance/rescue facility registry is enabled for this provider AOI.",
]
PRG_EMERGENCY_LIMITATIONS = [
    "PRG police and fire records are official unit-area geometry, not verified facility footprints or operational locations.",
    "The public inspection layer contains one representative point per retained PRG source area; source geometry type and source checksum remain explicit.",
    "PRG contributes police/fire evidence only. Hospitals and ambulance/rescue remain separately published OSM community evidence where no qualified official facility registry is enabled.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "hospital": (("amenity", "hospital"), ("healthcare", "hospital")),
    "fire_service": (("amenity", "fire_station"),),
    "police": (("amenity", "police"),),
    "ambulance_rescue": (
        ("amenity", "ambulance_station"),
        ("emergency", "ambulance_station"),
        ("emergency", "mountain_rescue"),
        ("emergency", "lifeguard_base"),
    ),
}


def load_osm_emergency_fixture() -> dict[str, Any]:
    return guard_source_access(
        "openstreetmap",
        "local_import",
        lambda: json.loads(EMERGENCY_FIXTURE.read_text(encoding="utf-8")),
    )


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    for category, mappings in FACILITY_MAPPINGS.items():
        if any(properties.get(key) == value for key, value in mappings):
            return category
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_emergency_fixture()
    if fixture.get("type") != "FeatureCollection" or not isinstance(fixture.get("features"), list):
        raise ValueError("Emergency OSM fixture must be a GeoJSON FeatureCollection")
    categorized = {category: [] for category in FACILITY_MAPPINGS}
    for feature in fixture["features"]:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Emergency OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError(
                "Emergency OSM fixture contains a feature without an allow-listed facility mapping"
            )
        categorized[category].append(
            {
                **deepcopy(feature),
                "properties": {**deepcopy(properties), "provider_category": category},
            }
        )
    if any(not features for features in categorized.values()):
        missing = sorted(category for category, features in categorized.items() if not features)
        raise ValueError(
            f"Emergency OSM fixture is missing required categories: {', '.join(missing)}"
        )
    return categorized


def build_osm_emergency_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    layers: dict[str, dict[str, Any]] = {}
    for category, features in categorized_osm_features().items():
        metadata = emergency_osm_metadata(layer_id=f"emergency.{category}", readiness=readiness)
        layers[category] = normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features}, metadata=metadata
        )
    return layers


def load_prg_emergency_fixture() -> dict[str, Any]:
    return guard_source_access(
        "prg_wfs",
        "local_import",
        lambda: json.loads(PRG_EMERGENCY_FIXTURE.read_text(encoding="utf-8")),
    )


def build_prg_emergency_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    fixture = load_prg_emergency_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("PRG emergency fixture must be a GeoJSON FeatureCollection")
    categorized = {"fire_service": [], "police": []}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("PRG emergency fixture feature requires properties")
        category = properties.get("provider_category")
        if category not in categorized:
            raise ValueError("PRG emergency fixture has an unsupported facility category")
        categorized[category].append(deepcopy(feature))
    if any(not category_features for category_features in categorized.values()):
        raise ValueError("PRG emergency fixture must retain both police and fire source areas")
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": category_features},
            metadata=prg_emergency_metadata(
                layer_id=f"emergency.official_{category}", readiness=readiness
            ),
        )
        for category, category_features in categorized.items()
    }


def build_osm_emergency_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [
        feature
        for category_features in categorized_osm_features().values()
        for feature in category_features
    ]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=emergency_osm_metadata(layer_id="emergency.osm_facilities", readiness=readiness),
    )


def emergency_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "emergency",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": EMERGENCY_SOURCE_QUERY,
        "snapshot_at": EMERGENCY_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/emergency/v1",
        "query_version": "emergency-osm/v1",
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(EMERGENCY_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def prg_emergency_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "emergency",
        "layer_id": layer_id,
        "source": "PRG (official unit-area evidence)",
        "source_type": "analytical_vector",
        "source_registry_id": "prg_wfs",
        "source_url": "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries",
        "source_query": "PRG WFS 2.0 GetFeature: K02_Komenda_powiatowa_policji and K07_Komenda_powiatowa_strazy_pozarnej, retained as representative points.",
        "snapshot_at": "2026-08-03T10:26:40Z",
        "pipeline_version": "geo_pipeline/emergency/v1",
        "query_version": "emergency-prg/v1",
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(PRG_EMERGENCY_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }
