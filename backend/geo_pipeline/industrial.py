"""Industrial domain models and OSM layer synthesis for vector tiles."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from geo_pipeline.contracts import (
    normalize_analytical_vector_layer,
    validate_provider_geojson,
)

INDUSTRIAL_LIMITATIONS = "OSM industrial facilities might lack complete boundary semantics. Fixture is bounded to Rybnik 35km."

INDUSTRIAL_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "fixtures"
    / "rybnik_35km"
    / "industrial"
    / "osm-industrial.geojson"
)

IndustrialCategory = Literal[
    "land_use", "facilities", "works", "building_context", "military_context"
]

INDUSTRIAL_FACILITY_MAPPINGS: dict[IndustrialCategory, list[tuple[str, str]]] = {
    "land_use": [("landuse", "industrial")],
    "facilities": [("industrial", "factory"), ("industrial", "works")],
    "works": [("man_made", "works")],
    "building_context": [("building", "industrial")],
    "military_context": [
        ("landuse", "military"),
        ("military", "danger_area"),
        ("military", "base"),
    ],
}


def category_for_osm_feature(tags: dict[str, Any]) -> IndustrialCategory | None:
    """Classify OSM tags into mutually exclusive analytical industrial categories."""
    if tags.get("military") in ("danger_area", "base") or tags.get("landuse") == "military":
        return "military_context"
    if tags.get("landuse") == "industrial":
        return "land_use"
    if tags.get("man_made") == "works":
        return "works"
    if tags.get("industrial") in ("factory", "works"):
        return "facilities"
    if tags.get("building") == "industrial":
        return "building_context"
    return None


def _layer_template(category: IndustrialCategory, readiness: str) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "metadata": industrial_osm_metadata(layer_id=f"industrial.{category}", readiness=readiness),
        "features": [],
    }


def industrial_osm_metadata(*, layer_id: str, readiness: str) -> dict[str, Any]:
    from geo_pipeline.query_catalog import INDUSTRIAL_OSM_QUERY

    return {
        "cache_layout_version": "provider_cache/v1",
        "geojson_contract_version": "provider_geojson/v1",
        "aoi_id": "rybnik_35km",
        "domain": "industrial",
        "layer_id": layer_id,
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_registry_id": "openstreetmap",
        "source_url": "https://overpass-api.de/api/interpreter",
        "source_query": "Fixture contract evidence for industrial-osm/v1",
        "snapshot_at": datetime.now().isoformat() + "Z",
        "pipeline_version": "geo_pipeline/industrial/v1",
        "query_version": INDUSTRIAL_OSM_QUERY.query_version,
        "validation_status_raw": "warning",
        "quality_status": "warning",
        "confidence": "medium",
        "limitations": [INDUSTRIAL_LIMITATIONS],
        "eligible_for_analysis": True,
        "feature_count": 0,
        "readiness": readiness,
    }


def build_osm_industrial_layers(*, readiness: str) -> dict[str, dict[str, Any]]:
    """Synthesize disjoint analytical feature collections per industrial category."""
    raw_collection = json.loads(INDUSTRIAL_FIXTURE.read_text(encoding="utf-8"))
    layers: dict[IndustrialCategory, dict[str, Any]] = {
        "land_use": _layer_template("land_use", readiness),
        "facilities": _layer_template("facilities", readiness),
        "works": _layer_template("works", readiness),
        "building_context": _layer_template("building_context", readiness),
        "military_context": _layer_template("military_context", readiness),
    }
    for feature in raw_collection.get("features", []):
        category = category_for_osm_feature(feature.get("properties", {}))
        if category is None:
            continue

        properties = {
            **deepcopy(feature.get("properties", {})),
            "source_id": feature.get("properties", {}).get("source_id", "osm/unknown"),
            "domain": "industrial",
            "asset_type": category,
            "source": "OpenStreetMap",
            "confidence": "medium",
            "limitations": [INDUSTRIAL_LIMITATIONS],
            "eligible_for_analysis": True,
            "missing_fields": [],
        }
        layers[category]["features"].append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": feature["geometry"],
            }
        )

    for category in layers:
        meta = layers[category].pop("metadata")
        meta["feature_count"] = len(layers[category]["features"])
        meta["readiness"] = readiness
        layers[category] = normalize_analytical_vector_layer(layers[category], metadata=meta)
        errors = validate_provider_geojson(layers[category])
        if errors:
            raise ValueError(
                f"Provider contract violated for industrial {category}: {', '.join(errors)}"
            )

    return layers


def build_osm_industrial_cache_layer(*, readiness: str) -> dict[str, Any]:
    """Legacy v1 single-layer cache builder for industrial facilities."""
    raw_collection = json.loads(INDUSTRIAL_FIXTURE.read_text(encoding="utf-8"))
    features = []

    for feature in raw_collection.get("features", []):
        category = category_for_osm_feature(feature.get("properties", {}))
        if category is None:
            continue

        properties = {
            **deepcopy(feature.get("properties", {})),
            "source_id": feature.get("properties", {}).get("source_id", "osm/unknown"),
            "domain": "industrial",
            "asset_type": category,
            "source": "OpenStreetMap",
            "confidence": "medium",
            "limitations": [INDUSTRIAL_LIMITATIONS],
            "eligible_for_analysis": True,
            "missing_fields": [],
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": feature["geometry"],
            }
        )

    legacy = {
        "type": "FeatureCollection",
        "features": features,
    }

    meta = industrial_osm_metadata(layer_id="industrial.osm_facilities", readiness=readiness)
    meta["feature_count"] = len(features)

    legacy = normalize_analytical_vector_layer(legacy, metadata=meta)

    errors = validate_provider_geojson(legacy)
    if errors:
        raise ValueError(f"Legacy industrial cache violates provider contract: {', '.join(errors)}")
    return legacy
