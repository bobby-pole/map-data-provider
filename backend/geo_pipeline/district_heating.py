"""Fixture-first district-heating normalization with explicit OSM semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.query_catalog import DISTRICT_HEATING_OSM_QUERY
from geo_pipeline.source_registry import guard_source_access

DISTRICT_HEATING_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_60km" / "district_heating" / "osm-district-heating.geojson"
DISTRICT_HEATING_SNAPSHOT_AT = "2026-08-10T12:00:00Z"
DISTRICT_HEATING_LIMITATIONS = [
    "OSM district-heating infrastructure completeness varies significantly by area and operator.",
    "The committed contract fixture is not a complete Rybnik 60 km heat-network, capacity, pressure or flow model.",
    "Generic industrial buildings, chimneys, power equipment and pipelines without explicit heating semantics are excluded.",
    "No qualified official analytical district-heating-network vector feed is enabled; an empty district_heating.lines layer remains an explicit source gap.",
    "KIUT district-heating WMS is visual reference-only imagery and does not replace analytical vector artifacts.",
]
DISTRICT_HEATING_CATEGORIES = ("plants", "facilities", "lines")
HEAT_SUBSTANCES = {"hot_water", "steam", "heat"}
HEAT_OUTPUT_VALUES = {"yes", "true", "1", "heat"}


def load_osm_district_heating_fixture() -> dict[str, Any]:
    return guard_source_access("openstreetmap", "local_import", lambda: json.loads(DISTRICT_HEATING_FIXTURE.read_text(encoding="utf-8")))


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    """Classify only explicit heat-production, facility and network evidence."""
    has_heat_output = (
        properties.get("plant:source") == "heat"
        or properties.get("generator:source") == "heat"
        or str(properties.get("plant:output:heat", "")).lower() in HEAT_OUTPUT_VALUES
        or str(properties.get("generator:output:heat", "")).lower() in HEAT_OUTPUT_VALUES
    )
    if properties.get("industrial") == "heating_station" or (
        properties.get("power") in {"plant", "generator"} and has_heat_output
    ):
        return "plants"
    if properties.get("man_made") == "heat_exchanger":
        return "facilities"
    if properties.get("pipeline") == "heating":
        return "lines"
    if properties.get("man_made") == "pipeline" and properties.get("substance") in HEAT_SUBSTANCES:
        return "lines"
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_district_heating_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("District-heating OSM fixture must be a GeoJSON FeatureCollection")
    categorized = {category: [] for category in DISTRICT_HEATING_CATEGORIES}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("District-heating OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError("District-heating fixture contains a feature without an allow-listed heating mapping")
        categorized[category].append({**deepcopy(feature), "properties": {**deepcopy(properties), "provider_category": category}})
    missing = [category for category in ("plants", "facilities") if not categorized[category]]
    if missing:
        raise ValueError(f"District-heating fixture is missing required categories: {', '.join(missing)}")
    return categorized


def district_heating_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_60km",
        "domain": "district_heating",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Fixture contract evidence for explicit district-heating plants, heat exchangers and heat-network lines.",
        "snapshot_at": DISTRICT_HEATING_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/district-heating/v1",
        "query_version": DISTRICT_HEATING_OSM_QUERY.query_version,
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(DISTRICT_HEATING_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_district_heating_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=district_heating_osm_metadata(
                layer_id=f"district_heating.{category}",
                readiness="needs_source" if category == "lines" and not features else readiness,
            ),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_district_heating_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [item for category in categorized_osm_features().values() for item in category]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=district_heating_osm_metadata(
            layer_id="district_heating.osm_features",
            readiness=readiness,
        ),
    )
