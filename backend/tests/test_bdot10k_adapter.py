from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import pytest
from pyproj import Transformer
from shapely.geometry import LineString, Polygon

from geo_pipeline.sources.bdot10k import (
    BDOT10K_ADAPTER_VERSION,
    BDOT10K_CLASS_MAPPING,
    Bdot10kAdapterError,
    class_definition,
    load_fixture_manifest,
    package_discovery_descriptor,
    read_bdot10k_class,
    read_fixture_class,
)


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "bdot10k"
MANIFEST = FIXTURE_ROOT / "fixture_manifest.json"


def _aoi_4326(*, min_x: float = 499990, min_y: float = 249990, max_x: float = 500160, max_y: float = 250140) -> dict:
    transformer = Transformer.from_crs("EPSG:2180", "EPSG:4326", always_xy=True)
    corners = [
        transformer.transform(min_x, min_y),
        transformer.transform(max_x, min_y),
        transformer.transform(max_x, max_y),
        transformer.transform(min_x, max_y),
        transformer.transform(min_x, min_y),
    ]
    return {"type": "Polygon", "coordinates": [corners]}


def test_manifest_is_versioned_and_has_digests_for_bounded_native_artifacts() -> None:
    manifest = load_fixture_manifest(MANIFEST)

    assert manifest["adapter_version"] == BDOT10K_ADAPTER_VERSION
    assert manifest["snapshot_at"] == "2026-08-02T11:54:10Z"
    assert {artifact["format"] for artifact in manifest["artifacts"]} == {"gpkg", "geoparquet"}
    assert all(len(artifact["sha256"]) == 64 for artifact in manifest["artifacts"])


@pytest.mark.parametrize(
    ("source_class", "source_role", "geometry_type"),
    [
        ("OT_SKDR_L", "transport", "LineString"),
        ("OT_BUIN_L", "bridge_context", "LineString"),
        ("OT_SWRS_L", "water_context", "LineString"),
        ("OT_BUBD_A", "building_context", "Polygon"),
        ("OT_KUPG_A", "industrial_context", "Polygon"),
        ("OT_KUPG_P", "industrial_context", "Point"),
    ],
)
def test_gpkg_fixture_addresses_each_initial_source_role(
    source_class: str, source_role: str, geometry_type: str
) -> None:
    result = read_fixture_class(
        manifest_path=MANIFEST,
        source_class=source_class,
        artifact_format="gpkg",
        aoi_geometry=_aoi_4326(),
    )

    assert result["metadata"]["source_role"] == source_role
    assert result["metadata"]["source_crs"] == "EPSG:2180"
    assert result["metadata"]["interchange_crs"] == "EPSG:4326"
    assert len(result["features"]) == 1
    feature = result["features"][0]
    assert feature["geometry"]["type"] == geometry_type
    assert feature["properties"]["source_feature_type"] == source_class
    assert feature["properties"]["source_feature_id"].startswith("PL.PZGiK.025.")
    assert feature["properties"]["attribution"].endswith("BDOT10k")
    assert feature["properties"]["snapshot_at"] == "2026-08-02T11:54:10Z"


def test_geoparquet_fixture_preserves_point_provenance_and_clips_aoi() -> None:
    result = read_fixture_class(
        manifest_path=MANIFEST,
        source_class="OT_KUPG_P",
        artifact_format="geoparquet",
        aoi_geometry=_aoi_4326(),
    )

    assert result["metadata"]["artifact_format"] == "geoparquet"
    assert result["features"][0]["geometry"]["type"] == "Point"
    outside = read_fixture_class(
        manifest_path=MANIFEST,
        source_class="OT_KUPG_P",
        artifact_format="geoparquet",
        aoi_geometry=_aoi_4326(min_x=500200, min_y=250200, max_x=500250, max_y=250250),
    )
    assert outside["features"] == []


def test_readers_receive_selected_fields_and_a_bounded_aoi() -> None:
    gpkg = FIXTURE_ROOT / "bdot10k_fixture.gpkg"
    parquet = FIXTURE_ROOT / "OT_KUPG_P.parquet"
    with patch("geo_pipeline.sources.bdot10k.gpd.read_file", wraps=gpd.read_file) as read_file:
        read_bdot10k_class(
            source_class="OT_SKDR_L", artifact_path=gpkg, aoi_geometry=_aoi_4326(), snapshot_at="fixture"
        )
    assert read_file.call_args.kwargs["columns"] == ["idIIP", "x_kod", "nazwa"]
    assert len(read_file.call_args.kwargs["bbox"]) == 4

    with patch("geo_pipeline.sources.bdot10k.gpd.read_parquet", wraps=gpd.read_parquet) as read_parquet:
        read_bdot10k_class(
            source_class="OT_KUPG_P", artifact_path=parquet, aoi_geometry=_aoi_4326(), snapshot_at="fixture"
        )
    assert read_parquet.call_args.kwargs["columns"] == ["idIIP", "x_kod", "nazwa", "geometry"]
    assert len(read_parquet.call_args.kwargs["bbox"]) == 4


def test_unknown_class_checksum_and_schema_drift_fail_clearly(tmp_path: Path) -> None:
    with pytest.raises(Bdot10kAdapterError, match="Unsupported BDOT10k source class"):
        class_definition("OT_UNVERIFIED_X")

    with pytest.raises(Bdot10kAdapterError, match="checksum"):
        read_bdot10k_class(
            source_class="OT_SKDR_L",
            artifact_path=FIXTURE_ROOT / "bdot10k_fixture.gpkg",
            aoi_geometry=_aoi_4326(),
            snapshot_at="fixture",
            expected_sha256="0" * 64,
        )

    broken = tmp_path / "broken.gpkg"
    gpd.GeoDataFrame(
        {"other_id": ["missing-idIIP"]},
        geometry=[LineString([(500000, 250000), (500010, 250010)])],
        crs="EPSG:2180",
    ).to_file(broken, layer="OT_SKDR_L", driver="GPKG", engine="pyogrio")
    with pytest.raises(Bdot10kAdapterError, match="missing idIIP"):
        read_bdot10k_class(
            source_class="OT_SKDR_L", artifact_path=broken, aoi_geometry=_aoi_4326(), snapshot_at="fixture"
        )


def test_mapping_is_narrow_and_uses_only_supported_geometry_families() -> None:
    assert set(BDOT10K_CLASS_MAPPING) == {
        "OT_SKDR_L", "OT_BUIN_L", "OT_SWRS_L", "OT_BUBD_A", "OT_KUPG_A", "OT_KUPG_P", "OT_PTKM_A"
    }
    assert {definition["geometry_family"] for definition in BDOT10K_CLASS_MAPPING.values()} == {
        "line", "point", "polygon"
    }


def test_package_discovery_fallback_is_fixed_and_not_a_vector_proxy() -> None:
    descriptor = package_discovery_descriptor()

    assert descriptor["method"] == "GetFeatureInfo"
    assert descriptor["purpose"] == "package_discovery_only"
    assert "not a vector feature" in descriptor["limitation"]
