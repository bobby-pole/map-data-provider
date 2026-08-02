"""Create the small deterministic MDQ-025 GPKG/GeoParquet fixtures."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Point, Polygon


ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "bdot10k"
CRS = "EPSG:2180"


def frame(feature_id: str, code: str, name: str, geometry: object) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"idIIP": [feature_id], "x_kod": [code], "nazwa": [name]}, geometry=[geometry], crs=CRS
    )


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    classes = {
        "OT_SKDR_L": frame("PL.PZGiK.025.road-001", "SKDR01", "Fixture road", LineString([(500000, 250000), (500140, 250070)])),
        "OT_BUIN_L": frame("PL.PZGiK.025.bridge-001", "BUIN01", "Fixture bridge", LineString([(500050, 250010), (500050, 250130)])),
        "OT_SWRS_L": frame("PL.PZGiK.025.water-001", "SWRS01", "Fixture stream", LineString([(499980, 250100), (500150, 250100)])),
        "OT_BUBD_A": frame("PL.PZGiK.025.building-001", "BUBD01", "Fixture building", Polygon([(500060, 250020), (500100, 250020), (500100, 250060), (500060, 250060)])),
        "OT_KUPG_A": frame("PL.PZGiK.025.industrial-area-001", "KUPG01", "Fixture industrial area", Polygon([(500105, 250020), (500145, 250020), (500145, 250060), (500105, 250060)])),
        "OT_KUPG_P": frame("PL.PZGiK.025.industrial-point-001", "KUPG01", "Fixture industrial point", Point(500125, 250080)),
    }
    gpkg = ROOT / "bdot10k_fixture.gpkg"
    if gpkg.exists():
        gpkg.unlink()
    for source_class, data in classes.items():
        data.to_file(gpkg, layer=source_class, driver="GPKG", engine="pyogrio")
    parquet = ROOT / "OT_KUPG_P.parquet"
    classes["OT_KUPG_P"].to_parquet(parquet, index=False, write_covering_bbox=True)
    manifest = {
        "adapter_version": "bdot10k_adapter/v1",
        "snapshot_at": "2026-08-02T11:54:10Z",
        "schema": "BDOT10k 2021-class-download fixture",
        "artifacts": [
            {"file": gpkg.name, "format": "gpkg", "sha256": digest(gpkg), "source_classes": list(classes)},
            {"file": parquet.name, "format": "geoparquet", "sha256": digest(parquet), "source_classes": ["OT_KUPG_P"]},
        ],
    }
    (ROOT / "fixture_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
