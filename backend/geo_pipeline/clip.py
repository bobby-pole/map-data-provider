import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import geopandas as gpd
from shapely.geometry import Point

from .config import PROCESSED_DIR, REPORTS_DIR, RYBNIK_AOI, AoiConfig

ClipMode = Literal["clip", "keep-intersecting"]


def clip_geojson_to_aoi(
    input_path: Path,
    output_path: Path,
    *,
    aoi: AoiConfig = RYBNIK_AOI,
    mode: ClipMode = "keep-intersecting",
) -> dict[str, Any]:
    gdf = gpd.read_file(input_path)
    input_count = int(len(gdf))

    if gdf.empty:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps({"type": "FeatureCollection", "features": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return _report(input_path, output_path, aoi, mode, input_count, 0, 0, "warn", ["empty_input"])

    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")

    metric = gdf.to_crs("EPSG:2180")
    center = gpd.GeoSeries(
        [Point(aoi.center_lon, aoi.center_lat)],
        crs="EPSG:4326",
    ).to_crs("EPSG:2180").iloc[0]
    aoi_buffer = center.buffer(aoi.radius_m)

    intersects = metric.geometry.intersects(aoi_buffer)

    if mode == "keep-intersecting":
        processed = metric[intersects].copy()
    elif mode == "clip":
        processed = metric[intersects].copy()
        processed.geometry = processed.geometry.intersection(aoi_buffer)
        processed = processed[~processed.geometry.is_empty].copy()
    else:
        raise ValueError(f"Unsupported clip mode: {mode}")

    processed = processed.to_crs("EPSG:4326")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    processed.to_file(output_path, driver="GeoJSON")

    output_count = int(len(processed))
    removed_count = input_count - output_count
    warnings = []
    if output_count == 0:
        warnings.append("empty_output")

    return _report(
        input_path,
        output_path,
        aoi,
        mode,
        input_count,
        output_count,
        removed_count,
        "warn" if warnings else "pass",
        warnings,
    )


def write_clip_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def _report(
    input_path: Path,
    output_path: Path,
    aoi: AoiConfig,
    mode: ClipMode,
    input_count: int,
    output_count: int,
    removed_count: int,
    status: str,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "status": status,
        "mode": mode,
        "aoi": {
            "name": aoi.name,
            "center_lat": aoi.center_lat,
            "center_lon": aoi.center_lon,
            "radius_m": aoi.radius_m,
            "metric_crs": "EPSG:2180",
            "output_crs": "EPSG:4326",
        },
        "input": str(input_path),
        "output": str(output_path),
        "feature_count": {
            "input": input_count,
            "output": output_count,
            "removed": removed_count,
        },
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Clip a GeoJSON layer to the Map Data Quality Lab AOI.")
    parser.add_argument("--input", required=True, type=Path, help="Input GeoJSON path.")
    parser.add_argument("--output", type=Path, help="Output GeoJSON path.")
    parser.add_argument("--mode", choices=["clip", "keep-intersecting"], default="keep-intersecting")
    parser.add_argument("--report", type=Path, help="Optional report JSON path.")
    args = parser.parse_args()

    output = args.output
    if output is None:
        output = PROCESSED_DIR / f"{args.input.stem}_clipped.geojson"

    report = clip_geojson_to_aoi(args.input, output, mode=args.mode)

    report_path = args.report
    if report_path is None:
        report_path = REPORTS_DIR / f"{output.stem}_clip_report.json"
    write_clip_report(report_path, report)

    print(json.dumps({"status": report["status"], "output": str(output), "report": str(report_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
