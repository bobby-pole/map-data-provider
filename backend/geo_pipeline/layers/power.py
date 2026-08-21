import argparse
import logging

import geopandas as gpd

from geo_pipeline.clip import clip_geojson_to_aoi, write_clip_report
from geo_pipeline.config import (
    GEOJSON_DIR,
    PREVIEWS_DIR,
    PROCESSED_DIR,
    RAW_DIR,
    REPORTS_DIR,
    RYBNIK_AOI,
    ensure_data_dirs,
)
from geo_pipeline.extract import (
    configure_osmnx,
    fetch_osm_features,
    filter_geometry_types,
    representative_points,
    sanitize_for_geojson,
    write_geojson,
    write_metadata,
)
from geo_pipeline.preview import write_power_preview
from geo_pipeline.query_catalog import POWER_OSM_QUERY
from geo_pipeline.validate import validate_power_outputs, write_validation_report

POWER_TAGS = POWER_OSM_QUERY.tags

LINE_TYPES = {"LineString", "MultiLineString"}
NODE_TYPES = {"Point", "MultiPoint", "Polygon", "MultiPolygon"}
POINT_TYPES = {"Point", "MultiPoint"}
LINE_LAYER_CATEGORIES = {
    "power_major_lines": ["line"],
    "power_minor_lines": ["minor_line"],
    "power_cables": ["cable"],
    "power_busbars": ["busbar", "bay"],
}
NODE_LAYER_CATEGORIES = {
    "power_substations": ["substation"],
    "power_transformers": ["transformer"],
    "power_plants": ["plant"],
    "power_generators": ["generator"],
    "power_supports": ["tower", "pole", "portal", "utility_pole"],
    "power_switchgear": ["switch", "terminal", "converter", "compensator"],
}
DISPLAY_NODE_CATEGORIES = [
    "substation",
    "transformer",
    "plant",
    "switch",
    "terminal",
    "converter",
    "compensator",
]

POWER_PROPERTY_COLUMNS = [
    "element",
    "id",
    "power",
    "man_made",
    "ss_power_category",
    "ss_power_label",
    "name",
    "ref",
    "operator",
    "operator:short",
    "operator:wikidata",
    "voltage",
    "voltage:primary",
    "voltage:secondary",
    "frequency",
    "substation",
    "transformer",
    "rating",
    "location",
    "line",
    "cables",
    "circuits",
    "wires",
    "phases",
    "generator:source",
    "generator:method",
    "generator:type",
    "plant:source",
    "plant:output:electricity",
    "height",
    "material",
    "design",
    "tower:type",
    "tower:construction",
    "source",
    "source:position",
    "source:geometry",
    "source_geometry_type",
]


def extract_power_grid(write_preview: bool = True) -> None:
    ensure_data_dirs()
    configure_osmnx()

    logging.info("Starting power extraction for AOI=%s", RYBNIK_AOI.name)
    raw = fetch_osm_features(RYBNIK_AOI, POWER_TAGS)
    raw = _add_power_categories(raw)
    raw = sanitize_for_geojson(raw)
    raw = _compact_power_properties(raw)

    raw_path = RAW_DIR / f"{RYBNIK_AOI.name}_power_osm.geojson"
    write_geojson(raw, raw_path)

    line_layers = {
        layer_name: filter_geometry_types(_filter_category(raw, categories), LINE_TYPES)
        for layer_name, categories in LINE_LAYER_CATEGORIES.items()
    }
    lines = _combine_layers(line_layers.values())
    node_layers = {
        layer_name: filter_geometry_types(_filter_category(raw, categories), NODE_TYPES)
        for layer_name, categories in NODE_LAYER_CATEGORIES.items()
    }
    nodes = _combine_layers(node_layers.values())
    node_points = representative_points(nodes)
    display_node_points = _filter_category(node_points, DISPLAY_NODE_CATEGORIES)
    node_point_layers = {
        layer_name: representative_points(gdf) for layer_name, gdf in node_layers.items()
    }

    lines_path = _geojson_path("power_lines")
    nodes_path = _geojson_path("power_nodes")
    node_points_path = _geojson_path("power_node_points")
    display_node_points_path = _geojson_path("power_node_points_display")
    clipped_lines_path = _processed_path("power_lines")
    clipped_nodes_path = _processed_path("power_nodes")
    clipped_node_points_path = _processed_path("power_node_points")
    clipped_display_node_points_path = _processed_path("power_node_points_display")

    write_geojson(lines, lines_path)
    write_geojson(nodes, nodes_path)
    write_geojson(node_points, node_points_path)
    write_geojson(display_node_points, display_node_points_path)

    for layer_name, gdf in line_layers.items():
        write_geojson(gdf, _geojson_path(layer_name))
    for layer_name, gdf in node_layers.items():
        write_geojson(gdf, _geojson_path(layer_name))
    for layer_name, gdf in node_point_layers.items():
        write_geojson(gdf, _geojson_path(f"{layer_name}_points"))

    clip_reports = {
        "power_lines": clip_geojson_to_aoi(
            lines_path, clipped_lines_path, aoi=RYBNIK_AOI, mode="clip"
        ),
        "power_nodes": clip_geojson_to_aoi(
            nodes_path, clipped_nodes_path, aoi=RYBNIK_AOI, mode="keep-intersecting"
        ),
        "power_node_points": clip_geojson_to_aoi(
            node_points_path,
            clipped_node_points_path,
            aoi=RYBNIK_AOI,
            mode="keep-intersecting",
        ),
        "power_node_points_display": clip_geojson_to_aoi(
            display_node_points_path,
            clipped_display_node_points_path,
            aoi=RYBNIK_AOI,
            mode="keep-intersecting",
        ),
    }
    for layer_name in line_layers:
        clip_reports[layer_name] = clip_geojson_to_aoi(
            _geojson_path(layer_name),
            _processed_path(layer_name),
            aoi=RYBNIK_AOI,
            mode="clip",
        )
    for layer_name in node_layers:
        clip_reports[layer_name] = clip_geojson_to_aoi(
            _geojson_path(layer_name),
            _processed_path(layer_name),
            aoi=RYBNIK_AOI,
            mode="keep-intersecting",
        )
        clip_reports[f"{layer_name}_points"] = clip_geojson_to_aoi(
            _geojson_path(f"{layer_name}_points"),
            _processed_path(f"{layer_name}_points"),
            aoi=RYBNIK_AOI,
            mode="keep-intersecting",
        )
    clip_report_path = REPORTS_DIR / f"{RYBNIK_AOI.name}_power_clip_report.json"
    write_clip_report(clip_report_path, clip_reports)

    if write_preview:
        write_power_preview(
            gpd.read_file(clipped_lines_path),
            gpd.read_file(clipped_node_points_path),
            PREVIEWS_DIR / f"{RYBNIK_AOI.name}_power_preview.png",
        )

    extra_layers = {
        **{
            layer_name: (_processed_path(layer_name), LINE_TYPES)
            for layer_name, gdf in line_layers.items()
            if not gdf.empty
        },
        **{
            layer_name: (_processed_path(layer_name), NODE_TYPES)
            for layer_name, gdf in node_layers.items()
            if not gdf.empty
        },
        **{
            f"{layer_name}_points": (
                _processed_path(f"{layer_name}_points"),
                POINT_TYPES,
            )
            for layer_name, gdf in node_point_layers.items()
            if not gdf.empty
        },
        "power_node_points_display": (clipped_display_node_points_path, POINT_TYPES),
    }
    validation = validate_power_outputs(
        aoi=RYBNIK_AOI,
        lines_path=clipped_lines_path,
        nodes_path=clipped_nodes_path,
        node_points_path=clipped_node_points_path,
        extra_layers=extra_layers,
    )
    validation_path = REPORTS_DIR / f"{RYBNIK_AOI.name}_power_validation_clipped.json"
    write_validation_report(validation_path, validation)

    report = {
        "aoi": {
            "name": RYBNIK_AOI.name,
            "center_lat": RYBNIK_AOI.center_lat,
            "center_lon": RYBNIK_AOI.center_lon,
            "radius_m": RYBNIK_AOI.radius_m,
        },
        "source": "OpenStreetMap via OSMnx",
        "tags": POWER_TAGS,
        "outputs": {
            "raw": str(raw_path.relative_to(RAW_DIR.parents[0])),
            "power_lines": str(lines_path.relative_to(GEOJSON_DIR.parents[0])),
            "power_nodes": str(nodes_path.relative_to(GEOJSON_DIR.parents[0])),
            "power_node_points": str(node_points_path.relative_to(GEOJSON_DIR.parents[0])),
            "power_node_points_display": str(
                display_node_points_path.relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_lines_clipped": str(clipped_lines_path.relative_to(GEOJSON_DIR.parents[0])),
            "power_nodes_clipped": str(clipped_nodes_path.relative_to(GEOJSON_DIR.parents[0])),
            "power_node_points_clipped": str(
                clipped_node_points_path.relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_node_points_display_clipped": str(
                clipped_display_node_points_path.relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_major_lines_clipped": str(
                _processed_path("power_major_lines").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_minor_lines_clipped": str(
                _processed_path("power_minor_lines").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_cables_clipped": str(
                _processed_path("power_cables").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_busbars_clipped": str(
                _processed_path("power_busbars").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_substations_clipped": str(
                _processed_path("power_substations").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_transformers_clipped": str(
                _processed_path("power_transformers").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_plants_clipped": str(
                _processed_path("power_plants").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_generators_clipped": str(
                _processed_path("power_generators").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_supports_clipped": str(
                _processed_path("power_supports").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_switchgear_clipped": str(
                _processed_path("power_switchgear").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_substations_points_clipped": str(
                _processed_path("power_substations_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_transformers_points_clipped": str(
                _processed_path("power_transformers_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_plants_points_clipped": str(
                _processed_path("power_plants_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_generators_points_clipped": str(
                _processed_path("power_generators_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_supports_points_clipped": str(
                _processed_path("power_supports_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "power_switchgear_points_clipped": str(
                _processed_path("power_switchgear_points").relative_to(GEOJSON_DIR.parents[0])
            ),
            "clip_report": str(clip_report_path.relative_to(REPORTS_DIR.parents[0])),
            "validation": str(validation_path.relative_to(REPORTS_DIR.parents[0])),
        },
        "feature_count": {
            "raw": len(raw),
            "power_lines": len(lines),
            "power_nodes": len(nodes),
            "power_node_points": len(node_points),
            "power_node_points_display": len(display_node_points),
            **{layer_name: len(gdf) for layer_name, gdf in line_layers.items()},
            "power_substations": len(node_layers["power_substations"]),
            "power_transformers": len(node_layers["power_transformers"]),
            "power_plants": len(node_layers["power_plants"]),
            "power_generators": len(node_layers["power_generators"]),
            "power_supports": len(node_layers["power_supports"]),
            "power_switchgear": len(node_layers["power_switchgear"]),
            "power_substations_points": len(node_point_layers["power_substations"]),
            "power_transformers_points": len(node_point_layers["power_transformers"]),
            "power_plants_points": len(node_point_layers["power_plants"]),
            "power_generators_points": len(node_point_layers["power_generators"]),
            "power_supports_points": len(node_point_layers["power_supports"]),
            "power_switchgear_points": len(node_point_layers["power_switchgear"]),
        },
        "quality_notes": [
            "OSM power=line is usually useful for high-voltage and visible transmission infrastructure.",
            "Low-voltage and detailed distribution networks may be missing or incomplete in OSM.",
            "Use KIUT WMS as visual overlay and GESUT/utility data for future analytical-grade distribution networks.",
        ],
        "validation_status": validation["status"],
    }
    write_metadata(REPORTS_DIR / f"{RYBNIK_AOI.name}_power_report.json", report)
    logging.info(
        "Power extraction complete: %s lines, %s nodes",
        len(lines),
        len(nodes),
    )


def _filter_power(gdf: gpd.GeoDataFrame, values: list[str]) -> gpd.GeoDataFrame:
    if gdf.empty or "power" not in gdf.columns:
        return gdf.iloc[0:0].copy()
    return gdf[gdf["power"].isin(values)].copy()


def _filter_category(gdf: gpd.GeoDataFrame, categories: list[str]) -> gpd.GeoDataFrame:
    if gdf.empty or "ss_power_category" not in gdf.columns:
        return gdf.iloc[0:0].copy()
    return gdf[gdf["ss_power_category"].isin(categories)].copy()


def _add_power_categories(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    enriched = gdf.copy()
    enriched["ss_power_category"] = enriched.apply(_classify_power_row, axis=1)
    enriched["ss_power_label"] = (
        enriched["ss_power_category"].map(_POWER_LABELS).fillna("Other power feature")
    )
    return enriched


def _compact_power_properties(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    geometry_column = gdf.geometry.name
    keep_columns = [column for column in POWER_PROPERTY_COLUMNS if column in gdf.columns]
    if geometry_column not in keep_columns:
        keep_columns.append(geometry_column)
    return gdf[keep_columns].copy()


def _value(row: object, key: str) -> str:
    value = row.get(key) if hasattr(row, "get") else None
    if value is None:
        return ""
    try:
        if value != value:
            return ""
    except Exception:
        pass
    return str(value)


def _classify_power_row(row: object) -> str:
    power = _value(row, "power")
    man_made = _value(row, "man_made")
    if power in _POWER_LABELS:
        return power
    if man_made == "utility_pole":
        return "utility_pole"
    return "other"


_POWER_LABELS = {
    "line": "Transmission or major distribution line",
    "minor_line": "Minor distribution line",
    "cable": "Power cable",
    "substation": "Substation",
    "transformer": "Transformer",
    "plant": "Power plant",
    "generator": "Generator",
    "tower": "Power tower",
    "pole": "Power pole",
    "portal": "Power portal",
    "utility_pole": "Utility pole",
    "switch": "Switch",
    "terminal": "Terminal",
    "converter": "Converter",
    "compensator": "Compensator",
    "busbar": "Busbar",
    "bay": "Bay",
    "other": "Other power feature",
}


def _combine_layers(layers: object) -> gpd.GeoDataFrame:
    frames = [layer for layer in layers if isinstance(layer, gpd.GeoDataFrame) and not layer.empty]
    if not frames:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.GeoDataFrame(gpd.pd.concat(frames, ignore_index=True), crs=frames[0].crs)


def _geojson_path(layer_name: str):
    return GEOJSON_DIR / f"{RYBNIK_AOI.name}_{layer_name}.geojson"


def _processed_path(layer_name: str):
    return PROCESSED_DIR / f"{RYBNIK_AOI.name}_{layer_name}_clipped.geojson"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract OSM power infrastructure for Rybnik + 60 km."
    )
    parser.add_argument("--no-preview", action="store_true", help="Skip PNG preview generation.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    extract_power_grid(write_preview=not args.no_preview)


if __name__ == "__main__":
    main()
