from pathlib import Path

import pytest
from pyproj import Transformer
from shapely.geometry import box, mapping
from shapely.ops import transform

from geo_pipeline.raster.nmt_nmpt import (
    DERIVED_PRODUCT_VERSION,
    NMT_NMPT_SOURCE_CRS,
    RasterAdapterError,
    derive_product,
    parse_ascii_grid,
    process_fixture,
)


FIXTURES = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "nmt_nmpt"
TO_WGS84 = Transformer.from_crs(NMT_NMPT_SOURCE_CRS, "EPSG:4326", always_xy=True)


def _aoi(bounds: tuple[float, float, float, float]) -> dict:
    return mapping(transform(TO_WGS84.transform, box(*bounds)))


def test_native_and_processed_rasters_keep_checksums_provenance_and_resolution() -> None:
    result = process_fixture(raster_path=FIXTURES / "valid.asc", aoi_geometry=_aoi((500000, 250000, 500030, 250030)), snapshot_at="2026-08-02T00:00:00Z")
    assert result["validation"] == {
        "status": "valid", "crs": "EPSG:2180", "resolution": {"value": 10.0, "unit": "metres"}, "nodata_value": -9999.0,
        "nodata_coverage": 0.0, "aoi_coverage": 1.0, "selected_cell_count": 9, "valid_cell_count": 9,
        "grid_bounds_source_crs": [500000.0, 250000.0, 500030.0, 250030.0],
    }
    assert len(result["native_raster"]["sha256"]) == len(result["processed_raster"]["sha256"]) == 64
    assert result["provenance"]["transforms"][-1]["resampling"] == "none"


def test_reports_partial_and_nodata_aoi_coverage_without_claiming_risk() -> None:
    partial = process_fixture(raster_path=FIXTURES / "partial.asc", aoi_geometry=_aoi((500000, 250000, 500030, 250030)), snapshot_at="2026-08-02T00:00:00Z")
    assert partial["validation"]["status"] == "partial"
    assert 0 < partial["validation"]["aoi_coverage"] < 1
    nodata = process_fixture(raster_path=FIXTURES / "nodata.asc", aoi_geometry=_aoi((500000, 250000, 500030, 250030)), snapshot_at="2026-08-02T00:00:00Z")
    assert nodata["validation"]["status"] == "nodata"
    assert nodata["validation"]["nodata_coverage"] == 1.0
    assert "flood risk" in nodata["limitations"][1].lower()


def test_derived_points_are_versioned_context_not_unlabelled_source_features() -> None:
    result = process_fixture(raster_path=FIXTURES / "valid.asc", aoi_geometry=_aoi((500000, 250000, 500030, 250030)), snapshot_at="2026-08-02T00:00:00Z")
    derived = derive_product(result, product=DERIVED_PRODUCT_VERSION)
    assert derived["metadata"]["data_kind"] == "derived_vector"
    assert derived["metadata"]["derived_product"] == DERIVED_PRODUCT_VERSION
    assert derived["metadata"]["native_raster_sha256"] == result["native_raster"]["sha256"]
    assert derived["metadata"]["processed_raster_sha256"] == result["processed_raster"]["sha256"]
    assert len(derived["features"]) == 9
    assert derived["features"][0]["properties"]["derived"] is True
    with pytest.raises(RasterAdapterError, match="Unsupported"):
        derive_product(result, product="flood_risk/v1")


def test_rejects_corrupt_empty_or_incompatible_raster_inputs() -> None:
    with pytest.raises(RasterAdapterError, match="row width"):
        parse_ascii_grid((FIXTURES / "corrupt.asc").read_bytes())
    with pytest.raises(RasterAdapterError, match="source CRS"):
        process_fixture(raster_path=FIXTURES / "valid.asc", aoi_geometry=_aoi((500000, 250000, 500030, 250030)), snapshot_at="2026-08-02T00:00:00Z", source_crs="EPSG:3857")
    with pytest.raises(RasterAdapterError, match="does not cover"):
        process_fixture(raster_path=FIXTURES / "valid.asc", aoi_geometry=_aoi((600000, 350000, 600010, 350010)), snapshot_at="2026-08-02T00:00:00Z")
