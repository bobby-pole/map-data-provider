"""Fixture-first telecom normalization with explicit communications semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.query_catalog import TELECOM_OSM_QUERY
from geo_pipeline.source_registry import guard_source_access

TELECOM_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_35km" / "telecom" / "osm-telecom.geojson"
TELECOM_SNAPSHOT_AT = "2026-08-10T10:00:00Z"
TELECOM_LIMITATIONS = [
    "OSM telecom infrastructure and communication-network completeness varies significantly by area and operator.",
    "The committed contract fixture demonstrates explicit telecom categories; it is not a complete Rybnik 35 km network, coverage or transmission model.",
    "Generic masts, towers, poles, buildings, ducts and utilities without qualifying communication tags are excluded to prevent false telecom attribution.",
    "No qualified official analytical telecom-network vector feed is enabled; an empty telecom.lines layer remains an explicit source gap.",
    "KIUT telecom WMS layers are visual reference overlays only and do not replace analytical vector artifacts.",
]

TELECOM_CATEGORIES = ("towers", "facilities", "lines")
TELECOM_FACILITY_VALUES = {
    "antenna", "exchange", "distribution_point", "service_point", "street_cabinet", "data_center", "cable_landing_station",
}
COMMUNICATION_SERVICE_KEYS = {
    "communication:mobile_phone", "communication:radio", "communication:television", "communication:microwave", "communication:bos",
}


def load_osm_telecom_fixture() -> dict[str, Any]:
    return guard_source_access("openstreetmap", "local_import", lambda: json.loads(TELECOM_FIXTURE.read_text(encoding="utf-8")))


def _has_communication_service(properties: dict[str, Any]) -> bool:
    return any(properties.get(key) == "yes" for key in COMMUNICATION_SERVICE_KEYS)


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    """Classify only explicit telecommunications structures, facilities and lines.

    OSMnx uses OR semantics for the query catalog, therefore a broad structural
    candidate (for example ``man_made=mast``) is accepted only after composing
    it with an explicit communications tag here.
    """
    if properties.get("communication") == "line" or properties.get("cable") == "communication":
        return "lines"
    man_made = properties.get("man_made")
    if man_made == "communications_tower":
        return "towers"
    if man_made in {"mast", "tower"} and (
        properties.get("tower:type") == "communication" or _has_communication_service(properties)
    ):
        return "towers"
    if properties.get("telecom") in TELECOM_FACILITY_VALUES:
        return "facilities"
    if man_made == "antenna" and _has_communication_service(properties):
        return "facilities"
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_telecom_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Telecom OSM fixture must be a GeoJSON FeatureCollection")
    categorized: dict[str, list[dict[str, Any]]] = {category: [] for category in TELECOM_CATEGORIES}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Telecom OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError("Telecom OSM fixture contains a feature without an allow-listed telecom mapping")
        props = {**deepcopy(properties), "provider_category": category}
        categorized[category].append({**deepcopy(feature), "properties": props})
    missing = [category for category in ("towers", "facilities") if not categorized[category]]
    if missing:
        raise ValueError(f"Telecom OSM fixture is missing required categories: {', '.join(missing)}")
    return categorized


def telecom_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "telecom",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Fixture contract evidence for telecom-osm/v1: explicit communication towers/masts, telecom facilities and communication=line or cable=communication routes.",
        "snapshot_at": TELECOM_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/telecom/v1",
        "query_version": TELECOM_OSM_QUERY.query_version,
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(TELECOM_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_telecom_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=telecom_osm_metadata(
                layer_id=f"telecom.{category}",
                readiness="needs_source" if category == "lines" and not features else readiness,
            ),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_telecom_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [feature for category_features in categorized_osm_features().values() for feature in category_features]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=telecom_osm_metadata(layer_id="telecom.osm_features", readiness=readiness),
    )
