"""Representative/inspection point generation shared across domain packs."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from shapely.geometry import mapping, shape

from geo_pipeline.contracts import validate_provider_geojson


def representative_points_layer(layer: dict[str, Any]) -> dict[str, Any]:
    """Derive representative inspection points for every feature in a single layer."""
    metadata = {
        **deepcopy(layer["metadata"]),
        "layer_id": "power.representative_points",
    }
    features = []
    for feature in layer["features"]:
        geometry = shape(feature["geometry"])
        properties = {
            **deepcopy(feature["properties"]),
            "source_geometry_type": geometry.geom_type,
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(geometry.representative_point()),
            }
        )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def build_domain_inspection_points(
    domain: str,
    layers: dict[str, dict[str, Any]],
    *,
    error_label: str,
    skip_points: bool = True,
    metadata_layer: str | None = None,
    include_origin_source_id: bool = True,
) -> dict[str, Any]:
    """Derive inspection points across categorized domain layers."""
    base_layer = (
        layers[metadata_layer] if metadata_layer is not None else next(iter(layers.values()))
    )
    metadata = {**deepcopy(base_layer["metadata"]), "layer_id": f"{domain}.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if skip_points and geometry.geom_type == "Point":
                continue
            properties: dict[str, Any] = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"{domain}.{category}",
                "source_geometry_type": geometry.geom_type,
            }
            if include_origin_source_id:
                properties["origin_source_id"] = feature["properties"]["source_id"]
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(f"{error_label} violate the provider contract: {', '.join(errors)}")
    return points
