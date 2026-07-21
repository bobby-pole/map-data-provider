import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import LineString, Point, Polygon

from geo_pipeline.config import AoiConfig
from geo_pipeline.contracts import CONTRACT_VERSION, normalize_analytical_vector_layer, validate_steel_sentinel_geojson
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


def test_contract_sample_matches_the_steel_sentinel_geojson_schema() -> None:
    sample_path = Path(__file__).resolve().parents[1] / "data/cache/rybnik_60km/power/contract-sample.geojson"
    sample = json.loads(sample_path.read_text(encoding="utf-8"))

    assert validate_steel_sentinel_geojson(sample) == []
    assert sample["metadata"]["contract_version"] == CONTRACT_VERSION
    assert sample["metadata"]["feature_count"] == len(sample["features"])
    assert sample["features"][0]["properties"]["osm_tags"]["power"] == "line"


def test_contract_validator_reports_missing_metadata_and_feature_fields() -> None:
    invalid = {
        "type": "FeatureCollection",
        "metadata": {"contract_version": CONTRACT_VERSION, "feature_count": 1},
        "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [0, 0]}}],
    }

    errors = validate_steel_sentinel_geojson(invalid)

    assert "metadata.missing:aoi_id" in errors
    assert "features[0].properties.missing:source" in errors
    assert "features[0].properties.missing:usable_for_simulation" in errors


def test_contract_validator_rejects_invalid_timestamp_boolean_count_and_geometry() -> None:
    sample_path = Path(__file__).resolve().parents[1] / "data/cache/rybnik_60km/power/contract-sample.geojson"
    invalid = json.loads(sample_path.read_text(encoding="utf-8"))
    invalid["metadata"]["snapshot_at"] = "not-a-timestamp"
    invalid["metadata"]["feature_count"] = True
    invalid["features"][0]["geometry"] = {"type": "LineString"}

    errors = validate_steel_sentinel_geojson(invalid)

    assert "metadata.snapshot_at" in errors
    assert "metadata.feature_count" in errors
    assert "features[0].geometry" in errors


def test_normalizer_makes_provider_fields_without_losing_useful_osm_tags() -> None:
    source_collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 32043840,
                    "power": "line",
                    "voltage": "220000",
                    "operator": "ČEPS",
                    "source": "bing;uhul:ortofoto",
                },
                "geometry": {"type": "LineString", "coordinates": [[18.3, 49.7], [18.4, 49.8]]},
            }
        ],
    }
    metadata = {
        "aoi_id": "rybnik_60km",
        "domain": "power",
        "layer_id": "power.lines",
        "source": "OpenStreetMap",
        "snapshot_at": "2026-07-21T00:00:00Z",
        "readiness": "ready",
        "confidence": "medium",
        "limitations": ["OSM completeness varies by area and asset type."],
        "usable_for_simulation": True,
    }

    normalized = normalize_analytical_vector_layer(source_collection, metadata=metadata)
    properties = normalized["features"][0]["properties"]

    assert validate_steel_sentinel_geojson(normalized) == []
    assert normalized["metadata"]["feature_count"] == 1
    assert properties["source"] == "OpenStreetMap"
    assert properties["source_id"] == "way/32043840"
    assert properties["asset_type"] == "line"
    assert properties["missing_fields"] == []
    assert properties["osm_tags"]["source"] == "bing;uhul:ortofoto"
