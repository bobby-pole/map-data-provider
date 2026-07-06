import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
import osmnx as ox
from shapely.geometry.base import BaseGeometry

from .config import AoiConfig

logger = logging.getLogger(__name__)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api",
    "https://overpass.kumi.systems/api",
]


def configure_osmnx() -> None:
    ox.settings.use_cache = True
    ox.settings.log_console = False
    ox.settings.requests_timeout = 180


def fetch_osm_features(aoi: AoiConfig, tags: dict[str, list[str]]) -> gpd.GeoDataFrame:
    logger.info(
        "Fetching OSM features for %s around %.6f, %.6f, radius=%sm, tags=%s",
        aoi.name,
        aoi.center_lat,
        aoi.center_lon,
        aoi.radius_m,
        tags,
    )
    last_error: Exception | None = None
    original_endpoint = ox.settings.overpass_url

    for endpoint in OVERPASS_ENDPOINTS:
        ox.settings.overpass_url = endpoint
        try:
            return ox.features_from_point(aoi.center, tags=tags, dist=aoi.radius_m)
        except Exception as exc:
            last_error = exc
            logger.warning("Overpass endpoint failed: %s (%s)", endpoint, exc)

    ox.settings.overpass_url = original_endpoint
    if last_error is not None:
        raise last_error
    raise RuntimeError("No Overpass endpoint configured")


def sanitize_for_geojson(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf

    clean = gdf.reset_index()
    if clean.crs is None:
        clean = clean.set_crs("EPSG:4326")
    else:
        clean = clean.to_crs("EPSG:4326")

    for column in clean.columns:
        if column == clean.geometry.name:
            continue
        clean[column] = clean[column].map(_json_safe_value)

    return clean


def filter_geometry_types(gdf: gpd.GeoDataFrame, geometry_types: set[str]) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    return gdf[gdf.geometry.type.isin(geometry_types)].copy()


def representative_points(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    points = gdf.copy()
    points["source_geometry_type"] = points.geometry.type
    points.geometry = points.geometry.representative_point()
    return points


def write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if gdf.empty:
        empty = {"type": "FeatureCollection", "features": []}
        path.write_text(json.dumps(empty, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    gdf.to_file(path, driver="GeoJSON")


def write_metadata(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    enriched = {
        "generated_at": datetime.now(UTC).isoformat(),
        **payload,
    }
    path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")


def _json_safe_value(value: Any) -> Any:
    if isinstance(value, BaseGeometry):
        return value.wkt
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:
        pass
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple, set, dict)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)
