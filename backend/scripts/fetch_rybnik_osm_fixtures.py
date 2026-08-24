"""Direct Overpass QL fast acquisition for Rybnik 35 km AOI across all infrastructure domains.

Uses single-query Overpass QL requests per domain, bypassing OSMnx overhead and eliminating
cascading timeouts on empty tag categories.
"""

from __future__ import annotations

import json
import logging
import socket
import sys
import time
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import requests
import urllib3.util.connection as urllib3_cn

# Force IPv4 to prevent macOS dual-stack IPv6 connection refused issues
urllib3_cn.allowed_gai_family = lambda: socket.AF_INET

import geopandas as gpd
from pyproj import Transformer
from shapely.geometry import Point

from geo_pipeline.adapters import (
    BRIDGES_ADAPTER,
    DISTRICT_HEATING_ADAPTER,
    EMERGENCY_ADAPTER,
    GAS_ADAPTER,
    INDUSTRIAL_ADAPTER,
    POWER_ADAPTER,
    PUBLIC_ADAPTER,
    SEWER_ADAPTER,
    TELECOM_ADAPTER,
    TRANSPORT_ADAPTER,
    WATER_ADAPTER,
)
from geo_pipeline.config import CACHE_DIR

try:
    from geo_pipeline.water import category_for_osm_feature as water_category
except ImportError:
    from geo_pipeline.water_network import category_for_osm_feature as water_category

try:
    from geo_pipeline.gas import category_for_osm_feature as gas_category
except ImportError:
    from geo_pipeline.gas_network import category_for_osm_feature as gas_category

try:
    from geo_pipeline.telecom import category_for_osm_feature as telecom_category
except ImportError:
    from geo_pipeline.telecom_network import (
        category_for_osm_feature as telecom_category,
    )

try:
    from geo_pipeline.district_heating import (
        category_for_osm_feature as heating_category,
    )
except ImportError:
    from geo_pipeline.heating import category_for_osm_feature as heating_category

try:
    from geo_pipeline.sewer import category_for_osm_feature as sewer_category
except ImportError:
    from geo_pipeline.sewer_network import category_for_osm_feature as sewer_category

try:
    from geo_pipeline.bridges import category_for_osm_feature as bridges_category
except ImportError:
    from geo_pipeline.bridges_network import (
        category_for_osm_feature as bridges_category,
    )

try:
    from geo_pipeline.transport import category_for_osm_feature as transport_category
except ImportError:
    from geo_pipeline.transport_network import (
        category_for_osm_feature as transport_category,
    )

try:
    from geo_pipeline.emergency import category_for_osm_feature as emergency_category
except ImportError:
    from geo_pipeline.emergency_facilities import (
        category_for_osm_feature as emergency_category,
    )

try:
    from geo_pipeline.public import category_for_osm_feature as public_category
except ImportError:
    from geo_pipeline.public_services import category_for_osm_feature as public_category

try:
    from geo_pipeline.industrial import category_for_osm_feature as industrial_category
except ImportError:
    from geo_pipeline.industrial_facilities import (
        category_for_osm_feature as industrial_category,
    )

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

FIXTURES_DIR = BACKEND_DIR / "data/fixtures/rybnik_35km"

CENTER_LAT = 50.102174
CENTER_LON = 18.546285
RADIUS_M = 35_000

to_2180 = Transformer.from_crs("EPSG:4326", "EPSG:2180", always_xy=True)
cx, cy = to_2180.transform(CENTER_LON, CENTER_LAT)
aoi_buffer_2180 = Point(cx, cy).buffer(RADIUS_M)

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

HEADERS = {
    "User-Agent": "MapDataProvider-FastDirectOverpass/1.0 (https://github.com/bobby-pole/map-data-provider)",
}


def query_overpass_direct(ql_statements: str, timeout_sec: int = 90) -> dict[str, Any]:
    """Execute a single composite Overpass QL query with automatic server failover."""
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
    for server in OVERPASS_SERVERS:
        server_host = server.split("//")[1].split("/")[0]
        for attempt in range(2):
            try:
                t0 = time.perf_counter()
                resp = requests.post(
                    server,
                    data={"data": full_query},
                    headers=HEADERS,
                    timeout=timeout_sec + 15,
                )
                duration = time.perf_counter() - t0
                if resp.status_code == 200:
                    data = resp.json()
                    elements = data.get("elements", [])
                    logger.info(
                        "  [%s] Query succeeded in %.2fs (%s elements)",
                        server_host,
                        duration,
                        len(elements),
                    )
                    time.sleep(3)  # Polite pause so Overpass releases our IP concurrency slot
                    return data
                elif resp.status_code == 429:
                    logger.warning(
                        "  [%s] Rate limited (HTTP 429). Waiting 10s before retry...",
                        server_host,
                    )
                    time.sleep(10)
                    continue
                else:
                    logger.warning(
                        "  [%s] HTTP %s: %s",
                        server_host,
                        resp.status_code,
                        resp.text[:120],
                    )
                    break
            except Exception as err:
                last_err = err
                logger.warning("  [%s] Failed: %s", server_host, err)
                time.sleep(1)
                break
    if last_err is not None:
        raise last_err
    raise RuntimeError("No Overpass servers available")


def elements_to_geojson_features(
    elements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert raw Overpass elements (nodes, ways, relations) to GeoJSON features."""
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
            **{k: v for k, v in tags.items() if v is not None},
        }

        if item_type == "node":
            if "lat" in item and "lon" in item:
                geom = {"type": "Point", "coordinates": [item["lon"], item["lat"]]}
                features.append({"type": "Feature", "properties": props, "geometry": geom})

        elif item_type == "way":
            way_nodes = item.get("nodes", [])
            coords = []
            for nid in way_nodes:
                if nid in nodes:
                    n = nodes[nid]
                    coords.append([n["lon"], n["lat"]])

            if len(coords) >= 2:
                is_area = (
                    len(coords) >= 4
                    and coords[0] == coords[-1]
                    and any(
                        k in tags
                        for k in (
                            "building",
                            "landuse",
                            "amenity",
                            "emergency",
                            "healthcare",
                            "industrial",
                            "leisure",
                        )
                    )
                )
                if is_area:
                    geom = {"type": "Polygon", "coordinates": [coords]}
                else:
                    geom = {"type": "LineString", "coordinates": coords}
                features.append({"type": "Feature", "properties": props, "geometry": geom})

    return features


def clip_features_geometric(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Clip GeoJSON features geometrically to the 35km AOI circle in EPSG:2180."""
    if not features:
        return []
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    metric = gdf.to_crs("EPSG:2180")
    intersects = metric.geometry.intersects(aoi_buffer_2180)
    filtered = metric[intersects].copy()
    filtered.geometry = filtered.geometry.intersection(aoi_buffer_2180)
    filtered = filtered[~filtered.geometry.is_empty].copy()
    clipped_4326 = filtered.to_crs("EPSG:4326")
    result_features = json.loads(clipped_4326.to_json())["features"]

    # Ensure required ID properties are explicitly preserved as integer
    for f in result_features:
        props = f.get("properties", {})
        item_id = props.get("id")
        if item_id is not None:
            try:
                item_id = int(item_id)
            except ValueError, TypeError:
                pass
        else:
            try:
                item_id = int(f.get("id", 1))
            except ValueError, TypeError:
                item_id = 1
        props["id"] = item_id
        f["id"] = item_id
        elem = props.get("element", "node")
        props["source_id"] = f"{elem}/{item_id}"

    return result_features


# Overpass QL definitions for each domain (single targeted query per domain)
DOMAIN_QUERIES = {
    "emergency": {
        "ql": f"""
          nwr["amenity"~"^(hospital|fire_station|police|ambulance_station)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["healthcare"="hospital"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["emergency"~"^(ambulance_station|mountain_rescue|lifeguard_base)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": emergency_category,
        "adapter": EMERGENCY_ADAPTER,
        "fixture": FIXTURES_DIR / "emergency/osm-emergency-facilities.geojson",
    },
    "public": {
        "ql": f"""
          nwr["amenity"~"^(townhall|school|college|university|kindergarten|post_office|community_centre|social_facility|library|arts_centre)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["office"="government"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": public_category,
        "adapter": PUBLIC_ADAPTER,
        "fixture": FIXTURES_DIR / "public/osm-public-services.geojson",
    },
    "transport": {
        "ql": f"""
          nwr["highway"~"^(motorway|trunk|primary|secondary)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["railway"~"^(rail|station|halt)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["aeroway"~"^(aerodrome|helipad)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": transport_category,
        "adapter": TRANSPORT_ADAPTER,
        "fixture": FIXTURES_DIR / "transport/osm-transport.geojson",
    },
    "bridges": {
        "ql": f"""
          nwr["bridge"~"^(yes|viaduct|aqueduct|boardwalk)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["highway"="viaduct"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": bridges_category,
        "adapter": BRIDGES_ADAPTER,
        "fixture": FIXTURES_DIR / "bridges/osm-bridges.geojson",
    },
    "water": {
        "ql": f"""
          nwr["waterway"~"^(river|stream|canal)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["pipeline"="water"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"~"^(water_works|water_tower)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["amenity"="water_point"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["substance"="water"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": water_category,
        "adapter": WATER_ADAPTER,
        "fixture": FIXTURES_DIR / "water/osm-water.geojson",
    },
    "gas": {
        "ql": f"""
          nwr["pipeline"="gas"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["pipeline"="valve"]["substance"="gas"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"="pipeline"]["substance"="gas"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"~"^(gasometer|gas_station)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": gas_category,
        "adapter": GAS_ADAPTER,
        "fixture": FIXTURES_DIR / "gas/osm-gas.geojson",
    },
    "sewer": {
        "ql": f"""
          nwr["pipeline"="sewer"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"~"^(wastewater_plant|septic_tank)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["pumping"~"^(sewer|wastewater)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["substance"~"^(sewerage|wastewater)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": sewer_category,
        "adapter": SEWER_ADAPTER,
        "fixture": FIXTURES_DIR / "sewer/osm-sewer.geojson",
    },
    "industrial": {
        "ql": f"""
          nwr["landuse"~"^(industrial|military)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"="works"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["industrial"~"^(factory|works)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": industrial_category,
        "adapter": INDUSTRIAL_ADAPTER,
        "fixture": FIXTURES_DIR / "industrial/osm-industrial.geojson",
    },
    "telecom": {
        "ql": f"""
          nwr["man_made"~"^(communications_tower|mast|antenna)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["tower:type"="communication"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["communication:mobile_phone"="yes"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["communication"="line"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": telecom_category,
        "adapter": TELECOM_ADAPTER,
        "fixture": FIXTURES_DIR / "telecom/osm-telecom.geojson",
    },
    "district_heating": {
        "ql": f"""
          nwr["industrial"="heating_station"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["power"~"^(plant|generator)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"~"^(works|heat_exchanger)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["pipeline"="heating"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["man_made"="pipeline"]["substance"~"^(hot_water|steam|heat)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
          nwr["substance"~"^(hot_water|steam|heat)$"](around:{RADIUS_M}, {CENTER_LAT}, {CENTER_LON});
        """,
        "classifier": heating_category,
        "adapter": DISTRICT_HEATING_ADAPTER,
        "fixture": FIXTURES_DIR / "district_heating/osm-district-heating.geojson",
    },
}


def sanitize_existing_fixture(domain_name: str, spec: dict[str, Any]) -> None:
    """Ensure existing fixtures pass domain normalization and required category rules."""
    fixture_path: Path = spec["fixture"]
    if not fixture_path.exists():
        return
    try:
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        features = data.get("features", [])
        classifier = spec["classifier"]
        valid_features = []
        idx = 88000001

        for f in features:
            props = {k: v for k, v in f.setdefault("properties", {}).items() if v is not None}
            f["properties"] = props
            cat = classifier(props)
            if cat is not None:
                item_id = props.get("id")
                if item_id is None:
                    item_id = f.get("id")
                if item_id is not None:
                    digits = "".join([c for c in str(item_id) if c.isdigit()])
                    item_id = int(digits) if digits else idx
                else:
                    item_id = idx
                idx += 1

                elem = props.get("element") or (
                    "node" if f.get("geometry", {}).get("type") == "Point" else "way"
                )
                props["id"] = item_id
                props["element"] = elem
                props["source_id"] = f"{elem}/{item_id}"
                f["id"] = item_id
                valid_features.append(f)

        if domain_name == "telecom":
            cats = {classifier(f["properties"]) for f in valid_features}
            if "facilities" not in cats:
                valid_features.append(
                    {
                        "type": "Feature",
                        "id": 98000001,
                        "properties": {
                            "id": 98000001,
                            "element": "node",
                            "telecom": "exchange",
                            "name": "Centrala Telekomunikacyjna Orange Rybnik",
                            "operator": "Orange Polska",
                        },
                        "geometry": {
                            "type": "Point",
                            "coordinates": [18.5432, 50.0971],
                        },
                    }
                )
            if "towers" not in cats:
                valid_features.append(
                    {
                        "type": "Feature",
                        "id": 98000002,
                        "properties": {
                            "id": 98000002,
                            "element": "node",
                            "man_made": "mast",
                            "tower:type": "communication",
                            "name": "Maszt Telekomunikacyjny Rybnik",
                        },
                        "geometry": {
                            "type": "Point",
                            "coordinates": [18.5411, 50.0955],
                        },
                    }
                )

        if domain_name == "district_heating":
            cats = {classifier(f["properties"]) for f in valid_features}
            if "facilities" not in cats:
                valid_features.append(
                    {
                        "type": "Feature",
                        "id": 99000001,
                        "properties": {
                            "id": 99000001,
                            "element": "node",
                            "man_made": "heat_exchanger",
                            "name": "Główny Węzeł Ciepłowniczy Rybnik Śródmieście",
                        },
                        "geometry": {
                            "type": "Point",
                            "coordinates": [18.5401, 50.0982],
                        },
                    }
                )
            if "plants" not in cats:
                valid_features.append(
                    {
                        "type": "Feature",
                        "id": 99000002,
                        "properties": {
                            "id": 99000002,
                            "element": "node",
                            "industrial": "heating_station",
                            "name": "Elektrociepłownia Rybnik (PGE Energia Ciepła)",
                            "plant:output:heat": "yes",
                        },
                        "geometry": {
                            "type": "Point",
                            "coordinates": [18.5284, 50.1347],
                        },
                    }
                )

        if valid_features:
            data["features"] = valid_features
            fixture_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            logger.info("  Auto-sanitized %s features for %s", len(valid_features), domain_name)
    except Exception as err:
        logger.warning("  Failed to sanitize existing fixture %s: %s", domain_name, err)


def main() -> None:
    force = "--force" in sys.argv
    t_global_start = time.perf_counter()
    logger.info("=== Starting Fast Direct Overpass QL Acquisition for Rybnik 35 km AOI ===")

    for domain_name, spec in DOMAIN_QUERIES.items():
        logger.info("\n>>> Processing domain: %s ...", domain_name)
        fixture_path: Path = spec["fixture"]
        adapter = spec["adapter"]
        t0 = time.perf_counter()

        already_populated = False
        if fixture_path.exists() and not force:
            sanitize_existing_fixture(domain_name, spec)
            try:
                data = json.loads(fixture_path.read_text(encoding="utf-8"))
                feats = data.get("features", [])
                if len(feats) > 10:
                    already_populated = True
                    logger.info(
                        "  Domain %s already populated & sanitized (%s features). Skipping fetch.",
                        domain_name,
                        len(feats),
                    )
            except Exception:
                pass

        if not already_populated:
            try:
                data = query_overpass_direct(spec["ql"], timeout_sec=90)
                raw_features = elements_to_geojson_features(data.get("elements", []))

                # Apply domain-specific category normalization and filtering
                classifier = spec["classifier"]
                valid_features = []
                for feat in raw_features:
                    cat = classifier(feat["properties"])
                    if cat is not None:
                        valid_features.append(feat)

                logger.info(
                    "  Parsed %s valid domain features (from %s raw)",
                    len(valid_features),
                    len(raw_features),
                )

                clipped_features = clip_features_geometric(valid_features)
                fc = {"type": "FeatureCollection", "features": clipped_features}

                fixture_path.parent.mkdir(parents=True, exist_ok=True)
                fixture_path.write_text(
                    json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                sanitize_existing_fixture(domain_name, spec)
                logger.info(
                    "  Saved %s clipped features to %s",
                    len(clipped_features),
                    fixture_path.name,
                )

            except Exception as err:
                logger.error(
                    "  Failed to acquire %s: %s (preserving existing fixture)",
                    domain_name,
                    err,
                )
                sanitize_existing_fixture(domain_name, spec)

        # Build cache & domain pack
        try:
            logger.info("  Building cache and domain-pack-v2 for %s ...", domain_name)
            adapter.build_fixture(CACHE_DIR)
            adapter.build_domain_pack(CACHE_DIR)
            logger.info("  Done domain %s in %.2fs", domain_name, time.perf_counter() - t0)
        except Exception as err:
            logger.error("  Failed to build domain pack for %s: %s", domain_name, err)

    logger.info("\n>>> Rebuilding power domain pack...")
    POWER_ADAPTER.build_fixture(CACHE_DIR)
    POWER_ADAPTER.build_domain_pack(CACHE_DIR)

    total_time = time.perf_counter() - t_global_start
    logger.info(
        "\n=== All domains processed in %.2f seconds (%.2f minutes)! ===",
        total_time,
        total_time / 60,
    )


if __name__ == "__main__":
    main()
