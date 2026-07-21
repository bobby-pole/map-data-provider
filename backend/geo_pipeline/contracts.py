"""Provider-owned GeoJSON contract helpers for Steel Sentinel consumers."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

CONTRACT_VERSION = "steel_sentinel_geojson/v1"
SOURCE_TYPES = frozenset({"analytical_vector", "manual_seed", "reference_overlay"})
CONFIDENCE_LEVELS = frozenset({"high", "medium", "low", "not_applicable"})
READINESS_VALUES = frozenset({"ready", "usable_with_limitations", "needs_source", "not_usable"})

REQUIRED_METADATA_FIELDS = frozenset(
    {
        "contract_version",
        "aoi_id",
        "domain",
        "layer_id",
        "source",
        "source_type",
        "snapshot_at",
        "feature_count",
        "readiness",
        "confidence",
        "limitations",
        "usable_for_simulation",
    }
)
REQUIRED_FEATURE_FIELDS = frozenset(
    {
        "source",
        "source_id",
        "domain",
        "asset_type",
        "confidence",
        "missing_fields",
        "limitations",
        "usable_for_simulation",
    }
)
RAW_OSM_TAG_FIELDS = (
    "power",
    "man_made",
    "name",
    "ref",
    "operator",
    "voltage",
    "substation",
    "transformer",
    "generator:source",
    "source",
)


def normalize_analytical_vector_layer(
    source_collection: dict[str, Any], *, metadata: dict[str, Any]
) -> dict[str, Any]:
    """Create the v1 provider contract without exposing raw OSM as required API fields."""
    source_features = source_collection.get("features")
    if source_collection.get("type") != "FeatureCollection" or not isinstance(source_features, list):
        raise ValueError("source_collection must be a GeoJSON FeatureCollection")

    layer_metadata = deepcopy(metadata)
    layer_metadata["contract_version"] = CONTRACT_VERSION
    layer_metadata["source_type"] = "analytical_vector"
    layer_metadata["feature_count"] = len(source_features)
    metadata_errors = _validate_metadata(layer_metadata)
    if metadata_errors:
        raise ValueError(f"Invalid provider metadata: {', '.join(metadata_errors)}")

    normalized_features = [
        _normalize_feature(feature, metadata=layer_metadata) for feature in source_features
    ]
    collection = {
        "type": "FeatureCollection",
        "metadata": layer_metadata,
        "features": normalized_features,
    }
    errors = validate_steel_sentinel_geojson(collection)
    if errors:
        raise ValueError(f"Normalized GeoJSON violates the provider contract: {', '.join(errors)}")
    return collection


def validate_steel_sentinel_geojson(collection: object) -> list[str]:
    """Return stable schema errors for a v1 provider GeoJSON layer."""
    errors: list[str] = []
    if not isinstance(collection, dict):
        return ["collection.must_be_object"]
    if collection.get("type") != "FeatureCollection":
        errors.append("collection.type")

    metadata = collection.get("metadata")
    if not isinstance(metadata, dict):
        errors.append("metadata.must_be_object")
    else:
        errors.extend(_validate_metadata(metadata))

    features = collection.get("features")
    if not isinstance(features, list):
        errors.append("features.must_be_array")
        return errors

    if isinstance(metadata, dict) and metadata.get("feature_count") != len(features):
        errors.append("metadata.feature_count")

    for index, feature in enumerate(features):
        errors.extend(_validate_feature(feature, index=index))
    return errors


def _normalize_feature(feature: object, *, metadata: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        raise ValueError("source features must be GeoJSON Features")
    raw_properties = feature.get("properties")
    if not isinstance(raw_properties, dict):
        raise ValueError("source feature properties must be an object")

    asset_type = _as_string(raw_properties.get("ss_power_category") or raw_properties.get("power"), "unknown")
    source_id = _source_id(raw_properties)
    raw_tags = {
        key: value
        for key in RAW_OSM_TAG_FIELDS
        if (value := raw_properties.get(key)) is not None
    }
    properties: dict[str, Any] = {
        "source": metadata["source"],
        "source_id": source_id,
        "domain": metadata["domain"],
        "asset_type": asset_type,
        "confidence": metadata["confidence"],
        "missing_fields": _missing_fields(raw_properties, asset_type=asset_type),
        "limitations": list(metadata["limitations"]),
        "usable_for_simulation": metadata["usable_for_simulation"],
    }
    if raw_tags:
        properties["osm_tags"] = raw_tags
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": deepcopy(feature.get("geometry")),
    }


def _source_id(properties: dict[str, Any]) -> str:
    element = _as_string(properties.get("element"), "feature")
    identifier = properties.get("id")
    if identifier is None or str(identifier).strip() == "":
        raise ValueError("source feature requires an id for provider source_id")
    return f"{element}/{identifier}"


def _missing_fields(properties: dict[str, Any], *, asset_type: str) -> list[str]:
    required_by_asset = {"line": ("voltage",), "minor_line": ("voltage",), "cable": ("voltage",)}
    return [field for field in required_by_asset.get(asset_type, ()) if properties.get(field) in (None, "")]


def _validate_metadata(metadata: dict[str, Any]) -> list[str]:
    errors = [f"metadata.missing:{field}" for field in REQUIRED_METADATA_FIELDS if field not in metadata]
    for field in ("contract_version", "aoi_id", "domain", "layer_id", "source", "snapshot_at"):
        if field in metadata and not _is_non_empty_string(metadata[field]):
            errors.append(f"metadata.{field}")
    if metadata.get("contract_version") != CONTRACT_VERSION:
        errors.append("metadata.contract_version")
    if metadata.get("source_type") not in SOURCE_TYPES:
        errors.append("metadata.source_type")
    if metadata.get("readiness") not in READINESS_VALUES:
        errors.append("metadata.readiness")
    if metadata.get("confidence") not in CONFIDENCE_LEVELS:
        errors.append("metadata.confidence")
    if type(metadata.get("feature_count")) is not int or metadata.get("feature_count", -1) < 0:
        errors.append("metadata.feature_count")
    if "snapshot_at" in metadata and not _is_iso8601_timestamp(metadata["snapshot_at"]):
        errors.append("metadata.snapshot_at")
    if not _is_string_list(metadata.get("limitations")):
        errors.append("metadata.limitations")
    if not isinstance(metadata.get("usable_for_simulation"), bool):
        errors.append("metadata.usable_for_simulation")
    return errors


def _validate_feature(feature: object, *, index: int) -> list[str]:
    prefix = f"features[{index}]"
    if not isinstance(feature, dict) or feature.get("type") != "Feature":
        return [f"{prefix}.type"]
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return [f"{prefix}.geometry"]
    if not _is_non_empty_string(geometry.get("type")) or "coordinates" not in geometry:
        return [f"{prefix}.geometry"]
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        return [f"{prefix}.properties"]

    errors = [f"{prefix}.properties.missing:{field}" for field in REQUIRED_FEATURE_FIELDS if field not in properties]
    for field in ("source", "source_id", "domain", "asset_type"):
        if field in properties and not _is_non_empty_string(properties[field]):
            errors.append(f"{prefix}.properties.{field}")
    if properties.get("confidence") not in CONFIDENCE_LEVELS:
        errors.append(f"{prefix}.properties.confidence")
    if not _is_string_list(properties.get("missing_fields")):
        errors.append(f"{prefix}.properties.missing_fields")
    if not _is_string_list(properties.get("limitations")):
        errors.append(f"{prefix}.properties.limitations")
    if not isinstance(properties.get("usable_for_simulation"), bool):
        errors.append(f"{prefix}.properties.usable_for_simulation")
    if "osm_tags" in properties and not isinstance(properties["osm_tags"], dict):
        errors.append(f"{prefix}.properties.osm_tags")
    return errors


def _as_string(value: object, default: str) -> str:
    return str(value) if value is not None and str(value).strip() else default


def _is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_string_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_iso8601_timestamp(value: object) -> bool:
    if not _is_non_empty_string(value):
        return False
    if "T" not in value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None
