from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Point, Polygon

from geo_pipeline.config import AoiConfig
from geo_pipeline.extract import filter_geometry_types, representative_points, sanitize_for_geojson
from geo_pipeline.validate import validate_geojson


def test_sanitize_for_geojson_normalizes_crs_and_complex_values() -> None:
    source = gpd.GeoDataFrame(
        {
            "tags": [{"power": "line"}],
            "values": [["220000", "110000"]],
        },
        geometry=[LineString([(18.54, 50.10), (18.55, 50.11)])],
        crs="EPSG:4326",
    )

    result = sanitize_for_geojson(source)

    assert result.crs.to_string() == "EPSG:4326"
    assert result.loc[0, "tags"] == '{"power": "line"}'
    assert result.loc[0, "values"] == '["220000", "110000"]'


def test_filter_geometry_types_returns_only_requested_geometry() -> None:
    source = gpd.GeoDataFrame(
        {"kind": ["node", "line"]},
        geometry=[Point(18.54, 50.10), LineString([(18.54, 50.10), (18.55, 50.11)])],
        crs="EPSG:4326",
    )

    result = filter_geometry_types(source, {"LineString"})

    assert result["kind"].tolist() == ["line"]
    assert result.geometry.type.tolist() == ["LineString"]


def test_representative_points_keeps_source_geometry_type() -> None:
    source = gpd.GeoDataFrame(
        {"kind": ["area"]},
        geometry=[Polygon([(18.54, 50.10), (18.55, 50.10), (18.55, 50.11), (18.54, 50.10)])],
        crs="EPSG:4326",
    )

    result = representative_points(source)

    assert result.geometry.type.tolist() == ["Point"]
    assert result["source_geometry_type"].tolist() == ["Polygon"]


def test_validate_geojson_reports_missing_file_without_network(tmp_path: Path) -> None:
    aoi = AoiConfig(name="fixture", center_lat=50.1, center_lon=18.5, radius_m=1_000)

    result = validate_geojson(
        tmp_path / "missing.geojson",
        aoi=aoi,
        expected_geometry_types={"Point"},
    )

    assert result["status"] == "fail"
    assert result["exists"] is False
    assert result["errors"] == ["file_missing"]
