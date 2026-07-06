import argparse
import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, Polygon

from geo_pipeline.config import PROCESSED_DIR, REPORTS_DIR, RYBNIK_AOI, ensure_data_dirs

TARGET_CRS = "EPSG:2180"
WGS84 = "EPSG:4326"
DEFAULT_HEX_LEVEL = "regional"
HEX_LEVELS = {
    "regional": {
        "edge_m": 3_000,
        "radius_m": RYBNIK_AOI.radius_m,
        "min_zoom": 0,
        "max_zoom": 10,
        "description": "Regional overview for the full Rybnik 60 km AOI.",
    },
    "urban": {
        "edge_m": 1_000,
        "radius_m": RYBNIK_AOI.radius_m,
        "min_zoom": 11,
        "max_zoom": 15,
        "description": "Urban-scale analysis for the full Rybnik 60 km AOI.",
    },
    "local": {
        "edge_m": 500,
        "radius_m": RYBNIK_AOI.radius_m,
        "min_zoom": 16,
        "max_zoom": 22,
        "description": "Local fine-grained analysis for the full Rybnik 60 km AOI.",
    },
}
_POWER_LAYER_CACHE: tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, Path, Path] | None = None
_POWER_NODE_UNION_CACHE = None


def build_power_hex_analytics(levels: list[str] | None = None) -> None:
    ensure_data_dirs()

    lines, nodes, lines_path, nodes_path = _read_power_layers_2180()
    selected_levels = levels or list(HEX_LEVELS)

    for level in selected_levels:
        if level not in HEX_LEVELS:
            raise ValueError(f"Unknown hex level: {level}. Available: {', '.join(HEX_LEVELS)}")
        _build_level(level, lines, nodes, lines_path, nodes_path)

def _read_power_layers_2180() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, Path, Path]:
    global _POWER_LAYER_CACHE
    if _POWER_LAYER_CACHE is None:
        lines_path = PROCESSED_DIR / f"{RYBNIK_AOI.name}_power_lines_clipped.geojson"
        nodes_path = PROCESSED_DIR / f"{RYBNIK_AOI.name}_power_node_points_clipped.geojson"
        lines = _read_layer(lines_path, geometry_types={"LineString", "MultiLineString"}).to_crs(TARGET_CRS)
        nodes = _read_layer(nodes_path, geometry_types={"Point", "MultiPoint"}).to_crs(TARGET_CRS)
        _POWER_LAYER_CACHE = (lines, nodes, lines_path, nodes_path)
    return _POWER_LAYER_CACHE


def _build_level(
    level: str,
    lines: gpd.GeoDataFrame,
    nodes: gpd.GeoDataFrame,
    lines_path: Path,
    nodes_path: Path,
) -> None:
    config = HEX_LEVELS[level]
    hex_edge_m = int(config["edge_m"])
    scope_radius_m = int(config["radius_m"])
    output_path = _hex_output_path(level)
    report_path = _hex_report_path(level)

    aoi_center = _aoi_center_2180()
    aoi_circle = aoi_center.buffer(scope_radius_m)

    hexes = _make_hex_grid(aoi_circle, hex_edge_m, level)
    hexes = _attach_line_metrics(hexes, lines)
    hexes = _attach_node_metrics(hexes, nodes)
    hexes = _attach_nearest_metrics(hexes, nodes)
    hexes = _attach_neighbors(hexes, hex_edge_m)
    hexes = _attach_quality_metrics(hexes)

    output = hexes.to_crs(WGS84)
    output.to_file(output_path, driver="GeoJSON")

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aoi": {
            "name": RYBNIK_AOI.name,
            "center_lat": RYBNIK_AOI.center_lat,
            "center_lon": RYBNIK_AOI.center_lon,
            "radius_m": RYBNIK_AOI.radius_m,
        },
        "level": level,
        "level_description": config["description"],
        "source_layers": {
            "lines": str(lines_path.relative_to(PROCESSED_DIR.parents[0])),
            "nodes": str(nodes_path.relative_to(PROCESSED_DIR.parents[0])),
        },
        "source_note": "OSM vectors are used for analytics. KIUT/GESUT WMS remains a visual reference layer only.",
        "hex_edge_m": hex_edge_m,
        "scope_radius_m": scope_radius_m,
        "min_zoom": config["min_zoom"],
        "max_zoom": config["max_zoom"],
        "feature_count": int(len(output)),
        "active_feature_count": int(output["has_infrastructure"].sum()),
        "confidence_counts": output["confidence_label"].value_counts().to_dict(),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logging.info("Power hex analytics %s complete: %s hexes -> %s", level, len(output), output_path)


def _read_layer(path: Path, geometry_types: set[str]) -> gpd.GeoDataFrame:
    if not path.exists():
        logging.warning("Missing layer: %s", path)
        return gpd.GeoDataFrame(geometry=[], crs=WGS84)
    gdf = gpd.read_file(path)
    if gdf.empty:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs or WGS84)
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84)
    return cast(gpd.GeoDataFrame, gdf[gdf.geometry.geom_type.isin(geometry_types)].copy())


def _aoi_center_2180() -> Point:
    center = gpd.GeoSeries([Point(RYBNIK_AOI.center_lon, RYBNIK_AOI.center_lat)], crs=WGS84)
    return cast(Point, center.to_crs(TARGET_CRS).iloc[0])


def _make_hex_grid(aoi_circle, edge_m: int, level: str) -> gpd.GeoDataFrame:
    minx, miny, maxx, maxy = aoi_circle.bounds
    width = math.sqrt(3) * edge_m
    vertical_step = 1.5 * edge_m
    hexes: list[Polygon] = []
    row = 0
    y = miny - edge_m

    while y <= maxy + edge_m:
        x_offset = 0 if row % 2 == 0 else width / 2
        x = minx - width + x_offset
        while x <= maxx + width:
            polygon = _hex_polygon(x, y, edge_m)
            clipped = polygon.intersection(aoi_circle)
            if not clipped.is_empty and clipped.area > 1:
                hexes.append(clipped)
            x += width
        y += vertical_step
        row += 1

    ids = [f"{level}-{index:04d}" for index in range(len(hexes))]
    return gpd.GeoDataFrame({"hex_id": ids, "hex_level": level, "hex_edge_m": edge_m}, geometry=hexes, crs=TARGET_CRS)


def _hex_polygon(x: float, y: float, edge_m: int) -> Polygon:
    points = []
    for index in range(6):
        angle = math.radians(60 * index - 30)
        points.append((x + edge_m * math.cos(angle), y + edge_m * math.sin(angle)))
    return Polygon(points)


def _attach_line_metrics(hexes: gpd.GeoDataFrame, lines: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    enriched = hexes.copy()
    enriched["line_count"] = 0
    enriched["line_length_m"] = 0.0
    enriched["major_line_count"] = 0
    enriched["minor_line_count"] = 0
    enriched["cable_count"] = 0

    if lines.empty:
        return enriched

    candidates = gpd.sjoin(
        cast(gpd.GeoDataFrame, lines[["ss_power_category", "voltage", "geometry"]].copy()),
        cast(gpd.GeoDataFrame, enriched[["hex_id", "geometry"]]),
        predicate="intersects",
        how="inner",
    )
    hex_geometries = enriched.set_index("hex_id").geometry
    metrics: dict[str, dict[str, float]] = {}

    for row in candidates.itertuples():
        hex_id = str(row.hex_id)
        intersection = row.geometry.intersection(hex_geometries.loc[hex_id])
        if intersection.is_empty:
            continue
        bucket = metrics.setdefault(
            hex_id,
            {
                "line_count": 0,
                "line_length_m": 0.0,
                "major_line_count": 0,
                "minor_line_count": 0,
                "cable_count": 0,
            },
        )
        bucket["line_count"] += 1
        bucket["line_length_m"] += float(intersection.length)
        category = str(getattr(row, "ss_power_category", "") or "")
        if category == "line":
            bucket["major_line_count"] += 1
        elif category == "minor_line":
            bucket["minor_line_count"] += 1
        elif category == "cable":
            bucket["cable_count"] += 1

    for hex_id, values in metrics.items():
        mask = enriched["hex_id"] == hex_id
        for key, value in values.items():
            enriched.loc[mask, key] = value

    enriched["line_length_m"] = cast(pd.Series, enriched["line_length_m"]).round(1)
    return enriched


def _attach_node_metrics(hexes: gpd.GeoDataFrame, nodes: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    enriched = hexes.copy()
    node_columns = {
        "node_count": 0,
        "substation_count": 0,
        "transformer_count": 0,
        "generator_count": 0,
        "plant_count": 0,
        "support_count": 0,
        "switchgear_count": 0,
    }
    for column, default in node_columns.items():
        enriched[column] = default

    if nodes.empty:
        return enriched

    joined = gpd.sjoin(
        cast(gpd.GeoDataFrame, nodes[["ss_power_category", "geometry"]].copy()),
        cast(gpd.GeoDataFrame, enriched[["hex_id", "geometry"]]),
        predicate="intersects",
        how="inner",
    )
    if joined.empty:
        return enriched

    grouped = joined.groupby("hex_id")
    enriched = enriched.set_index("hex_id")
    enriched.loc[grouped.size().index, "node_count"] = grouped.size()

    category_to_column = {
        "substation": "substation_count",
        "transformer": "transformer_count",
        "generator": "generator_count",
        "plant": "plant_count",
        "tower": "support_count",
        "pole": "support_count",
        "portal": "support_count",
        "utility_pole": "support_count",
        "switch": "switchgear_count",
        "terminal": "switchgear_count",
        "converter": "switchgear_count",
        "compensator": "switchgear_count",
    }
    for category, column in category_to_column.items():
        counts = joined[joined["ss_power_category"] == category].groupby("hex_id").size()
        if not counts.empty:
            enriched.loc[counts.index, column] = enriched.loc[counts.index, column] + counts

    return enriched.reset_index()


def _attach_nearest_metrics(hexes: gpd.GeoDataFrame, nodes: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    enriched = hexes.copy()
    enriched["nearest_power_node_m"] = None
    if nodes.empty:
        return enriched

    node_union = _power_node_union(nodes)
    enriched["nearest_power_node_m"] = cast(pd.Series, enriched.geometry.centroid.distance(node_union)).round(1)
    return enriched


def _power_node_union(nodes: gpd.GeoDataFrame):
    global _POWER_NODE_UNION_CACHE
    if _POWER_NODE_UNION_CACHE is None:
        _POWER_NODE_UNION_CACHE = nodes.geometry.union_all()
    return _POWER_NODE_UNION_CACHE


def _attach_neighbors(hexes: gpd.GeoDataFrame, edge_m: int) -> gpd.GeoDataFrame:
    enriched = hexes.copy()
    neighbor_distance_m = math.sqrt(3) * edge_m * 1.05
    centroids = enriched.geometry.centroid
    spatial_index = gpd.GeoSeries(centroids, crs=enriched.crs).sindex
    ids = enriched["hex_id"].tolist()
    neighbor_map: dict[str, list[str]] = {}

    for index, centroid in enumerate(centroids):
        candidate_indexes = spatial_index.query(centroid.buffer(neighbor_distance_m), predicate="intersects")
        neighbor_ids = [
            ids[candidate_index]
            for candidate_index in candidate_indexes
            if candidate_index != index and centroid.distance(centroids.iloc[candidate_index]) <= neighbor_distance_m
        ]
        neighbor_map[ids[index]] = sorted(neighbor_ids)

    enriched["neighbor_ids"] = enriched["hex_id"].map(lambda hex_id: neighbor_map.get(hex_id, []))
    return enriched


def _attach_quality_metrics(hexes: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    enriched = hexes.copy()
    enriched["has_infrastructure"] = (enriched["line_length_m"] > 0) | (enriched["node_count"] > 0)
    enriched["operational_status"] = enriched["has_infrastructure"].map(
        lambda has_infrastructure: "operational" if has_infrastructure else "empty"
    )
    enriched["operational_status_note"] = enriched["has_infrastructure"].map(
        lambda has_infrastructure: (
            "Infrastructure present; no failure simulation is active."
            if has_infrastructure
            else "No OSM power infrastructure in this hex."
        )
    )
    active_ids = set(enriched.loc[enriched["has_infrastructure"], "hex_id"])

    enriched["connected_hex_ids"] = enriched["neighbor_ids"].map(
        lambda ids: [hex_id for hex_id in ids if hex_id in active_ids]
    )
    enriched["connected_hex_count"] = enriched["connected_hex_ids"].map(len)

    def confidence(row: pd.Series) -> tuple[float, str, str]:
        critical_nodes = row.substation_count + row.transformer_count + row.generator_count + row.plant_count
        if row.line_length_m >= 500 and critical_nodes > 0:
            return 0.85, "high", "OSM vector lines and power nodes in hex."
        if row.line_length_m > 0 or critical_nodes > 0:
            return 0.62, "medium", "OSM vector feature present; topology is inferred."
        if row.node_count > 0 or row.nearest_power_node_m is not None and row.nearest_power_node_m <= float(row.hex_edge_m) * 1.5:
            return 0.35, "low", "Nearby OSM feature only; KIUT may be used as visual reference."
        return 0.0, "unknown", "No analytical vector evidence in public OSM for this hex."

    quality = enriched.apply(confidence, axis=1, result_type="expand")
    enriched["confidence_score"] = quality[0]
    enriched["confidence_label"] = quality[1]
    enriched["data_quality_note"] = quality[2]
    enriched["source_mode"] = "osm_vector_derived"
    enriched["kiut_role"] = "visual_reference_only"

    score = (
        enriched["line_length_m"] / 900
        + enriched["major_line_count"] * 2
        + enriched["minor_line_count"] * 1
        + enriched["substation_count"] * 15
        + enriched["transformer_count"] * 8
        + enriched["generator_count"] * 6
        + enriched["plant_count"] * 12
        + enriched["switchgear_count"] * 3
        + enriched["connected_hex_count"].where(enriched["has_infrastructure"], 0) * 2
    )
    enriched["infrastructure_score"] = score.clip(lower=0, upper=100).round(1)
    enriched.loc[~enriched["has_infrastructure"], "infrastructure_score"] = 0.0

    return enriched


def _hex_output_path(level: str) -> Path:
    if level == DEFAULT_HEX_LEVEL:
        return PROCESSED_DIR / f"{RYBNIK_AOI.name}_power_hexes_clipped.geojson"
    return PROCESSED_DIR / f"{RYBNIK_AOI.name}_power_hexes_{level}_clipped.geojson"


def _hex_report_path(level: str) -> Path:
    if level == DEFAULT_HEX_LEVEL:
        return REPORTS_DIR / f"{RYBNIK_AOI.name}_power_hexes_report.json"
    return REPORTS_DIR / f"{RYBNIK_AOI.name}_power_hexes_{level}_report.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build confidence-aware hex analytics for Rybnik power OSM layers.")
    parser.add_argument(
        "--level",
        choices=list(HEX_LEVELS),
        action="append",
        help="Build only the selected level. Can be passed multiple times.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    build_power_hex_analytics(levels=args.level)


if __name__ == "__main__":
    main()
