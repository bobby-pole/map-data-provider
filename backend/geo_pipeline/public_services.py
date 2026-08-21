"""Fixture-first public-service normalization with explicit facility semantics."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.source_registry import guard_source_access

PUBLIC_SERVICES_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "rybnik_35km"
    / "public"
    / "osm-public-services.geojson"
)
PUBLIC_SERVICES_SNAPSHOT_AT = "2026-08-03T20:30:00Z"
PUBLIC_SERVICES_LIMITATIONS = [
    "OSM public-service completeness and tagging vary by area and facility type.",
    "A facility tag is evidence of mapped semantics, not service availability, capacity, accessibility or operating status.",
    "BDOT10k building geometry is retained only as topographic comparison context and cannot establish facility semantics.",
    "No qualified PRG public-service facility class is enabled for this domain pack.",
]

FACILITY_MAPPINGS: dict[str, tuple[tuple[str, str], ...]] = {
    "administration": (("amenity", "townhall"), ("office", "government")),
    "education": (
        ("amenity", "school"),
        ("amenity", "college"),
        ("amenity", "university"),
        ("amenity", "kindergarten"),
    ),
    "post": (("amenity", "post_office"),),
    "community_social": (
        ("amenity", "community_centre"),
        ("amenity", "social_facility"),
        ("amenity", "library"),
        ("amenity", "arts_centre"),
    ),
}


def load_osm_public_services_fixture() -> dict[str, Any]:
    return guard_source_access(
        "openstreetmap",
        "local_import",
        lambda: json.loads(PUBLIC_SERVICES_FIXTURE.read_text(encoding="utf-8")),
    )


def category_for_osm_feature(properties: dict[str, Any]) -> str | None:
    for category, mappings in FACILITY_MAPPINGS.items():
        if any(properties.get(key) == value for key, value in mappings):
            return category
    return None


def categorized_osm_features() -> dict[str, list[dict[str, Any]]]:
    fixture = load_osm_public_services_fixture()
    features = fixture.get("features") if fixture.get("type") == "FeatureCollection" else None
    if not isinstance(features, list):
        raise ValueError("Public-services OSM fixture must be a GeoJSON FeatureCollection")
    categorized = {category: [] for category in FACILITY_MAPPINGS}
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict):
            raise ValueError("Public-services OSM fixture feature requires properties")
        category = category_for_osm_feature(properties)
        if category is None:
            raise ValueError(
                "Public-services OSM fixture contains a feature without an allow-listed facility mapping"
            )
        categorized[category].append(
            {
                **deepcopy(feature),
                "properties": {**deepcopy(properties), "provider_category": category},
            }
        )
    if any(not category_features for category_features in categorized.values()):
        missing = sorted(
            category for category, category_features in categorized.items() if not category_features
        )
        raise ValueError(
            f"Public-services OSM fixture is missing required categories: {', '.join(missing)}"
        )
    return categorized


def public_services_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "public",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Bounded Overpass snapshot: explicit public-service amenity and office tags within the Rybnik 35 km AOI.",
        "snapshot_at": PUBLIC_SERVICES_SNAPSHOT_AT,
        "pipeline_version": "geo_pipeline/public-services/v1",
        "query_version": "public-osm/v1",
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": list(PUBLIC_SERVICES_LIMITATIONS),
        "eligible_for_analysis": True,
        "readiness": readiness,
    }


def build_osm_public_service_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    return {
        category: normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features},
            metadata=public_services_osm_metadata(
                layer_id=f"public.{category}", readiness=readiness
            ),
        )
        for category, features in categorized_osm_features().items()
    }


def build_osm_public_services_cache_layer(*, readiness: str) -> dict[str, Any]:
    features = [
        feature
        for category_features in categorized_osm_features().values()
        for feature in category_features
    ]
    return normalize_analytical_vector_layer(
        {"type": "FeatureCollection", "features": features},
        metadata=public_services_osm_metadata(
            layer_id="public.osm_facilities", readiness=readiness
        ),
    )
