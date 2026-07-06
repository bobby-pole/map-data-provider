import json
import math
import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import Point

from .config import AoiConfig, GEOJSON_DIR, REPORTS_DIR, RYBNIK_AOI


def validate_geojson(
    path: Path,
    *,
    aoi: AoiConfig,
    expected_geometry_types: set[str],
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "readable": False,
        "feature_count": 0,
        "crs": None,
        "geometry_types": {},
        "empty_geometries": 0,
        "invalid_geometries": 0,
        "unexpected_geometry_types": [],
        "outside_aoi": 0,
        "bbox": None,
        "status": "fail",
        "errors": [],
        "warnings": [],
    }

    if not path.exists():
        base["errors"].append("file_missing")
        return base

    try:
        gdf = gpd.read_file(path)
    except Exception as exc:
        base["errors"].append(f"read_error: {exc}")
        return base

    base["readable"] = True
    base["feature_count"] = int(len(gdf))
    base["crs"] = str(gdf.crs) if gdf.crs is not None else None

    if gdf.empty:
        base["warnings"].append("empty_layer")
        base["status"] = "warn"
        return base

    if gdf.crs is None:
        base["warnings"].append("missing_crs_assumed_epsg_4326")
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")

    geometry_counts = gdf.geometry.type.value_counts(dropna=False).to_dict()
    base["geometry_types"] = {str(k): int(v) for k, v in geometry_counts.items()}

    actual_types = set(base["geometry_types"].keys())
    unexpected = sorted(actual_types - expected_geometry_types)
    base["unexpected_geometry_types"] = unexpected
    if unexpected:
        base["errors"].append("unexpected_geometry_types")

    empty_geometries = gdf.geometry.is_empty.fillna(True)
    invalid_geometries = ~gdf.geometry.is_valid.fillna(False)
    base["empty_geometries"] = int(empty_geometries.sum())
    base["invalid_geometries"] = int(invalid_geometries.sum())

    if base["empty_geometries"]:
        base["errors"].append("empty_geometries")
    if base["invalid_geometries"]:
        base["warnings"].append("invalid_geometries")

    bounds = gdf.total_bounds
    if len(bounds) == 4 and all(math.isfinite(float(v)) for v in bounds):
        base["bbox"] = {
            "min_lon": float(bounds[0]),
            "min_lat": float(bounds[1]),
            "max_lon": float(bounds[2]),
            "max_lat": float(bounds[3]),
        }

    aoi_point = Point(aoi.center_lon, aoi.center_lat)
    metric = gdf.to_crs("EPSG:2180")
    metric_center = gpd.GeoSeries([aoi_point], crs="EPSG:4326").to_crs("EPSG:2180").iloc[0]
    distances = metric.geometry.distance(metric_center)
    outside_aoi = distances > aoi.radius_m
    base["outside_aoi"] = int(outside_aoi.sum())
    if base["outside_aoi"]:
        base["warnings"].append("features_outside_aoi")

    if base["errors"]:
        base["status"] = "fail"
    elif base["warnings"]:
        base["status"] = "warn"
    else:
        base["status"] = "pass"

    return base


def validate_power_outputs(
    *,
    aoi: AoiConfig,
    lines_path: Path,
    nodes_path: Path,
    node_points_path: Path,
    extra_layers: dict[str, tuple[Path, set[str]]] | None = None,
) -> dict[str, Any]:
    layers = {
        "power_lines": validate_geojson(
            lines_path,
            aoi=aoi,
            expected_geometry_types={"LineString", "MultiLineString"},
        ),
        "power_nodes": validate_geojson(
            nodes_path,
            aoi=aoi,
            expected_geometry_types={"Point", "MultiPoint", "Polygon", "MultiPolygon"},
        ),
        "power_node_points": validate_geojson(
            node_points_path,
            aoi=aoi,
            expected_geometry_types={"Point", "MultiPoint"},
        ),
    }
    for layer_name, (path, geometry_types) in (extra_layers or {}).items():
        layers[layer_name] = validate_geojson(
            path,
            aoi=aoi,
            expected_geometry_types=geometry_types,
        )

    aggregate_categories = _category_counts(layers)

    domain_quality = {
        "has_power_lines": layers["power_lines"]["feature_count"] > 0,
        "has_power_nodes": layers["power_nodes"]["feature_count"] > 0,
        "has_distribution_candidates": any(
            layers.get(layer_name, {}).get("feature_count", 0) > 0
            for layer_name in ("power_minor_lines", "power_cables", "power_transformers", "power_supports")
        ),
        "likely_missing_distribution_grid": True,
        "category_counts": aggregate_categories,
        "notes": [
            "OSM power data usually represents visible/high-voltage infrastructure better than low-voltage distribution.",
            "power=minor_line, power=cable, transformers and poles improve distribution context, but OSM coverage is still uneven.",
            "Use this validation as a quality gate, not as proof of complete grid coverage.",
        ],
    }

    statuses = [layer["status"] for layer in layers.values()]
    if any(status == "fail" for status in statuses):
        status = "fail"
    elif any(status == "warn" for status in statuses):
        status = "warn"
    else:
        status = "pass"

    return {
        "aoi": asdict(aoi),
        "status": status,
        "layers": layers,
        "domain_quality": domain_quality,
    }


def _category_counts(layers: dict[str, dict[str, Any]]) -> dict[str, int]:
    grouped = {
        "lines": ["power_major_lines", "power_minor_lines", "power_cables", "power_busbars"],
        "nodes": [
            "power_substations_points",
            "power_transformers_points",
            "power_plants_points",
            "power_generators_points",
            "power_supports_points",
            "power_switchgear_points",
        ],
    }
    counts: dict[str, int] = {}
    for group_name, layer_names in grouped.items():
        counts[group_name] = sum(int(layers.get(layer_name, {}).get("feature_count", 0)) for layer_name in layer_names)
    return counts


def write_validation_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate generated Steel Sentinel GeoJSON layers.")
    parser.add_argument("--layer", choices=["power"], default="power", help="Layer group to validate.")
    args = parser.parse_args()

    if args.layer == "power":
        report = validate_power_outputs(
            aoi=RYBNIK_AOI,
            lines_path=GEOJSON_DIR.parent / "processed" / f"{RYBNIK_AOI.name}_power_lines_clipped.geojson",
            nodes_path=GEOJSON_DIR.parent / "processed" / f"{RYBNIK_AOI.name}_power_nodes_clipped.geojson",
            node_points_path=GEOJSON_DIR.parent / "processed" / f"{RYBNIK_AOI.name}_power_node_points_clipped.geojson",
        )
        output_path = REPORTS_DIR / f"{RYBNIK_AOI.name}_power_validation_clipped.json"
        write_validation_report(output_path, report)
        print(json.dumps({"status": report["status"], "report": str(output_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
