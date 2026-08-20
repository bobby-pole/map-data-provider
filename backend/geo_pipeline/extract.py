import json
import logging
import socket
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
import osmnx as ox
import pandas as pd
import requests
from shapely.geometry import Point, LineString, Polygon, shape
from shapely.geometry.base import BaseGeometry
import urllib3.util.connection as urllib3_cn

from .config import AoiConfig
from .source_registry import guard_source_access

# Force IPv4 to prevent macOS dual-stack IPv6 Connection Refused / No Route to Host errors
urllib3_cn.allowed_gai_family = lambda: socket.AF_INET

logger = logging.getLogger(__name__)

OVERPASS_ENDPOINTS = [
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

HEADERS = {
    "User-Agent": "MapDataQualityLab-FastDirectOverpass/1.0 (https://github.com/bobby-pole/map-data-quality-lab)",
}


def configure_osmnx() -> None:
    ox.settings.use_cache = True
    ox.settings.log_console = False
    ox.settings.requests_timeout = 300
    ox.settings.overpass_rate_limit = False
    ox.settings.user_agent = "MapDataQualityLab/1.0 (https://github.com/bobby-pole/map-data-quality-lab)"


def query_overpass_ql_direct(ql_statements: str, timeout_sec: int = 120) -> dict[str, Any]:
    """Execute a single composite Overpass QL query with automatic endpoint failover."""
    full_query = f"""
    [out:json][timeout:{timeout_sec}][maxsize:1073741824];
    (
      {ql_statements}
    );
    out body;
    >;
    out skel qt;
    """
    last_err: Exception | None = None
    for server in OVERPASS_ENDPOINTS:
        server_host = server.split("//")[1].split("/")[0]
        for attempt in range(2):
            try:
                t0 = time.perf_counter()
                resp = requests.post(server, data={"data": full_query}, headers=HEADERS, timeout=timeout_sec + 20)
                duration = time.perf_counter() - t0
                if resp.status_code == 200:
                    data = resp.json()
                    elements = data.get("elements", [])
                    logger.info("  [%s] Overpass QL succeeded in %.2fs (%s elements)", server_host, duration, len(elements))
                    time.sleep(2)
                    return data
                elif resp.status_code == 429:
                    logger.warning("  [%s] Rate limited (HTTP 429). Waiting 5s before retry...", server_host)
                    time.sleep(5)
                    continue
                else:
                    logger.warning("  [%s] HTTP %s: %s", server_host, resp.status_code, resp.text[:120])
                    break
            except Exception as err:
                last_err = err
                logger.warning("  [%s] Failed: %s", server_host, err)
                time.sleep(1)
                break
    if last_err is not None:
        raise last_err
    raise RuntimeError("No Overpass endpoints available")


def elements_to_gdf(elements: list[dict[str, Any]]) -> gpd.GeoDataFrame:
    """Convert raw Overpass elements (nodes, ways) to a GeoPandas GeoDataFrame."""
    nodes = {item["id"]: item for item in elements if item.get("type") == "node"}
    features = []

    for item in elements:
        item_type = item.get("type")
        item_id = item.get("id")
        tags = item.get("tags")
        if not tags:
            continue

        props = {
            "source_id": f"{item_type}/{item_id}",
            "element": item_type,
            "id": int(item_id),
            "osmid": int(item_id),
            **tags,
        }

        if item_type == "node":
            if "lat" in item and "lon" in item:
                geom = Point(item["lon"], item["lat"])
                features.append({**props, "geometry": geom})

        elif item_type == "way":
            way_nodes = item.get("nodes", [])
            coords = []
            for nid in way_nodes:
                if nid in nodes:
                    n = nodes[nid]
                    coords.append((n["lon"], n["lat"]))

            if len(coords) >= 2:
                is_area = len(coords) >= 4 and coords[0] == coords[-1] and any(
                    k in tags for k in ("building", "landuse", "amenity", "emergency", "healthcare", "industrial", "leisure", "natural", "water")
                )
                if is_area:
                    try:
                        geom = Polygon(coords)
                        if geom.is_valid and not geom.is_empty:
                            features.append({**props, "geometry": geom})
                        else:
                            geom = LineString(coords)
                            features.append({**props, "geometry": geom})
                    except Exception:
                        geom = LineString(coords)
                        features.append({**props, "geometry": geom})
                else:
                    geom = LineString(coords)
                    features.append({**props, "geometry": geom})

    if not features:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    gdf = gpd.GeoDataFrame(features, geometry="geometry", crs="EPSG:4326")
    return gdf


def fetch_osm_features(aoi: AoiConfig, tags: dict[str, list[str]]) -> gpd.GeoDataFrame:
    return guard_source_access("openstreetmap", "acquisition", lambda: _fetch_osm_features(aoi, tags))


def fetch_osm_features_geometry(geometry: dict[str, Any], tags: dict[str, list[str]]) -> gpd.GeoDataFrame:
    """Fetch a bounded Polygon/MultiPolygon AOI without reducing it to its bbox."""
    return guard_source_access("openstreetmap", "acquisition", lambda: _fetch_osm_features_geometry(geometry, tags))


def _fetch_osm_features(aoi: AoiConfig, tags: dict[str, list[str]]) -> gpd.GeoDataFrame:
    logger.info(
        "Fetching fast OSM features for %s around %.6f, %.6f, radius=%sm, tags=%s",
        aoi.name,
        aoi.center_lat,
        aoi.center_lon,
        aoi.radius_m,
        tags,
    )
    statements = []
    for key, values in tags.items():
        if isinstance(values, str):
            values = [values]
        for val in values:
            if val == "*" or not val:
                statements.append(f'nwr["{key}"](around:{aoi.radius_m},{aoi.center_lat},{aoi.center_lon});')
            else:
                statements.append(f'nwr["{key}"="{val}"](around:{aoi.radius_m},{aoi.center_lat},{aoi.center_lon});')

    if not statements:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    ql = "\n      ".join(statements)
    data = query_overpass_ql_direct(ql)
    elements = data.get("elements", [])
    return elements_to_gdf(elements)


def _fetch_osm_features_geometry(geometry: dict[str, Any], tags: dict[str, list[str]]) -> gpd.GeoDataFrame:
    polygonal = shape(geometry)
    if polygonal.geom_type not in {"Polygon", "MultiPolygon"} or polygonal.is_empty:
        raise ValueError("OSM acquisition requires a non-empty polygonal AOI")

    polygons = [polygonal] if polygonal.geom_type == "Polygon" else list(polygonal.geoms)
    statements = []

    for poly in polygons:
        ext = poly.exterior
        if len(ext.coords) > 200:
            simplified = poly.simplify(0.001, preserve_topology=True)
            ext = simplified.exterior if simplified.geom_type == "Polygon" else ext

        coords = list(ext.coords)
        poly_str = " ".join(f"{lat:.6f} {lon:.6f}" for lon, lat in coords)

        for key, values in tags.items():
            if isinstance(values, str):
                values = [values]
            for val in values:
                if val == "*" or not val:
                    statements.append(f'nwr["{key}"](poly:"{poly_str}");')
                else:
                    statements.append(f'nwr["{key}"="{val}"](poly:"{poly_str}");')

    if not statements:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    ql = "\n      ".join(statements)
    data = query_overpass_ql_direct(ql)
    elements = data.get("elements", [])
    return elements_to_gdf(elements)


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
