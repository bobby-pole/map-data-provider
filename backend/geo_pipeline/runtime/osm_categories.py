"""OSM domain query catalog mapping, feature categorization, AOI clipping, and layer splitting."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import geopandas as gpd
from shapely.geometry import mapping, shape

from geo_pipeline.domains.bridges import (
    category_for_osm_feature as bridges_category_for_osm_feature,
)
from geo_pipeline.domains.district_heating import (
    category_for_osm_feature as district_heating_category_for_osm_feature,
)
from geo_pipeline.domains.emergency import (
    category_for_osm_feature as emergency_category_for_osm_feature,
)
from geo_pipeline.domains.gas import category_for_osm_feature as gas_category_for_osm_feature
from geo_pipeline.domains.industrial import (
    category_for_osm_feature as industrial_category_for_osm_feature,
)
from geo_pipeline.domains.public_services import (
    category_for_osm_feature as public_category_for_osm_feature,
)
from geo_pipeline.domains.sewer import category_for_osm_feature as sewer_category_for_osm_feature
from geo_pipeline.domains.telecom import (
    category_for_osm_feature as telecom_category_for_osm_feature,
)
from geo_pipeline.domains.transport import (
    category_for_osm_feature as transport_category_for_osm_feature,
)
from geo_pipeline.domains.transport import road_class_for_osm_feature
from geo_pipeline.domains.water import category_for_osm_feature as water_category_for_osm_feature
from geo_pipeline.layers.power import _add_power_categories, _compact_power_properties
from geo_pipeline.query_catalog import (
    BRIDGES_OSM_QUERY,
    DISTRICT_HEATING_OSM_QUERY,
    EMERGENCY_OSM_QUERY,
    GAS_OSM_QUERY,
    INDUSTRIAL_OSM_QUERY,
    POWER_OSM_QUERY,
    PUBLIC_OSM_QUERY,
    SEWER_OSM_QUERY,
    TELECOM_OSM_QUERY,
    TRANSPORT_OSM_QUERY,
    WATER_OSM_QUERY,
)

QUERY_BY_DOMAIN = {
    "power": POWER_OSM_QUERY,
    "emergency": EMERGENCY_OSM_QUERY,
    "public": PUBLIC_OSM_QUERY,
    "transport": TRANSPORT_OSM_QUERY,
    "bridges": BRIDGES_OSM_QUERY,
    "water": WATER_OSM_QUERY,
    "gas": GAS_OSM_QUERY,
    "sewer": SEWER_OSM_QUERY,
    "industrial": INDUSTRIAL_OSM_QUERY,
    "telecom": TELECOM_OSM_QUERY,
    "district_heating": DISTRICT_HEATING_OSM_QUERY,
}

_DOMAIN_CATEGORY_CLASSIFIERS: dict[str, Callable[[dict[str, Any]], str | None]] = {
    "emergency": emergency_category_for_osm_feature,
    "public": public_category_for_osm_feature,
    "transport": transport_category_for_osm_feature,
    "bridges": bridges_category_for_osm_feature,
    "water": water_category_for_osm_feature,
    "gas": gas_category_for_osm_feature,
    "sewer": sewer_category_for_osm_feature,
    "industrial": industrial_category_for_osm_feature,
    "telecom": telecom_category_for_osm_feature,
    "district_heating": district_heating_category_for_osm_feature,
}

_FIXED_LAYER_BUCKETS: dict[str, tuple[str, ...]] = {
    "telecom": ("telecom.towers", "telecom.facilities", "telecom.lines"),
    "district_heating": (
        "district_heating.plants",
        "district_heating.facilities",
        "district_heating.lines",
    ),
}

_CLIPPABLE_GEOM_TYPES = frozenset(
    {
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
    }
)


def categorize_domain_frame(domain: str, frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Assign `provider_category` (and domain-specific attributes) to acquired OSM features."""
    if domain == "power":
        return _compact_power_properties(_add_power_categories(frame))
    classifier = _DOMAIN_CATEGORY_CLASSIFIERS.get(domain)
    if classifier is None:
        raise ValueError(f"Runtime OSM categorization is not enabled for domain: {domain}")
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: classifier(dict(row)) or "other", axis=1
    )
    filtered = enriched[enriched["provider_category"] != "other"].copy()
    if domain == "transport" and not filtered.empty:
        filtered["road_class"] = filtered.apply(
            lambda row: (
                road_class_for_osm_feature(dict(row))
                if row.get("provider_category") == "roads"
                else None
            ),
            axis=1,
        )
    return filtered


def geojson_collection(frame: gpd.GeoDataFrame) -> dict[str, Any]:
    """Serialize a categorized GeoDataFrame into a GeoJSON FeatureCollection dict."""
    if frame.empty:
        return {"type": "FeatureCollection", "features": []}
    return json.loads(frame.to_json())


def clip_to_aoi(collection: dict[str, Any], geometry: dict[str, Any]) -> dict[str, Any]:
    """Clip acquired OSM features strictly to the target AOI geometry."""
    boundary = shape(geometry)
    features = []
    bb = boundary.bounds
    for feature in collection["features"]:
        geom_data = feature.get("geometry")
        if not isinstance(geom_data, dict):
            continue
        candidate = shape(geom_data)
        if candidate.is_empty:
            continue
        cb = candidate.bounds
        if (
            candidate.geom_type == "Point"
            and cb[0] >= bb[0]
            and cb[1] >= bb[1]
            and cb[2] <= bb[2]
            and cb[3] <= bb[3]
        ):
            features.append(feature)
            continue
        clipped = candidate.intersection(boundary)
        if clipped.is_empty or clipped.geom_type not in _CLIPPABLE_GEOM_TYPES:
            continue
        features.append({**feature, "geometry": mapping(clipped)})
    return {"type": "FeatureCollection", "features": features}


def domain_layers(domain: str, collection: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Split an AOI-clipped FeatureCollection into domain artifact layer buckets."""
    if domain == "power":
        lines = [
            feature
            for feature in collection["features"]
            if feature["geometry"]["type"] in {"LineString", "MultiLineString"}
        ]
        assets = [
            feature
            for feature in collection["features"]
            if feature["geometry"]["type"] not in {"LineString", "MultiLineString"}
        ]
        return {
            key: value
            for key, value in {"power.lines": lines, "power.assets": assets}.items()
            if value
        }
    if domain == "emergency":
        return {"emergency.facilities": collection["features"]} if collection["features"] else {}
    fixed_buckets = _FIXED_LAYER_BUCKETS.get(domain)
    if fixed_buckets is not None:
        grouped: dict[str, list[dict[str, Any]]] = {bucket: [] for bucket in fixed_buckets}
        for feature in collection["features"]:
            category = feature.get("properties", {}).get("provider_category")
            layer_id = f"{domain}.{category}" if isinstance(category, str) else ""
            if layer_id in grouped:
                grouped[layer_id].append(feature)
        if not any(grouped.values()):
            return {}
        _append_inspection_points(domain, grouped)
        return grouped
    grouped = {}
    for feature in collection["features"]:
        category = feature.get("properties", {}).get("provider_category")
        if isinstance(category, str):
            grouped.setdefault(f"{domain}.{category}", []).append(feature)
    _append_inspection_points(domain, grouped)
    return grouped


def _append_inspection_points(domain: str, grouped: dict[str, list[dict[str, Any]]]) -> None:
    inspection_points = []
    for layer_id, features in grouped.items():
        for feature in features:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = dict(feature.get("properties", {}))
            properties.update(
                {
                    "origin_artifact": layer_id,
                    "origin_source_id": f"{properties.get('element', 'feature')}/{properties.get('id')}",
                    "source_geometry_type": geometry.geom_type,
                }
            )
            inspection_points.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    if inspection_points:
        grouped[f"{domain}.inspection_points"] = inspection_points
