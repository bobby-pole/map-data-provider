from pathlib import Path

import pytest

from geo_pipeline.sources.orthophoto import OrthophotoAdapterError, build_getmap_url, parse_capabilities, reference_descriptor


CAPABILITIES = (Path(__file__).resolve().parents[1] / "data" / "fixtures" / "orthophoto" / "capabilities.xml").read_bytes()
AOI = {"type": "Polygon", "coordinates": [[[18.5, 50.0], [18.6, 50.0], [18.6, 50.1], [18.5, 50.1], [18.5, 50.0]]]}


def test_parses_verified_raster_layer_and_coverage() -> None:
    raster = parse_capabilities(CAPABILITIES)
    assert raster.name == "Raster"
    assert raster.bbox_wgs84 == (14.076638, 48.980459, 24.551068, 54.668798)
    assert raster.metadata_url.startswith("https://mapy.geoportal.gov.pl/wss/service/")


def test_reference_descriptor_is_non_analytical_and_discloses_missing_image_metadata() -> None:
    descriptor = reference_descriptor(aoi_geometry=AOI, capabilities=CAPABILITIES)
    assert descriptor["status"] == "available_reference"
    assert descriptor["analytical_geojson"] is False
    assert descriptor["imagery"]["date"] == {"state": "not_published", "value": None}
    assert descriptor["imagery"]["resolution"]["state"] == "not_published"
    assert "Raster" in descriptor["get_map"]


def test_reports_uncovered_and_unavailable_without_image_or_vector_fallback() -> None:
    far_aoi = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    assert reference_descriptor(aoi_geometry=far_aoi, capabilities=CAPABILITIES)["status"] == "uncovered"
    unavailable = reference_descriptor(aoi_geometry=AOI, capabilities=None)
    assert unavailable["status"] == "service_unavailable"
    assert unavailable["get_map"] is None
    assert unavailable["analytical_geojson"] is False


def test_rejects_schema_drift_unsafe_metadata_and_invalid_url_bounds() -> None:
    with pytest.raises(OrthophotoAdapterError, match="missing Raster"):
        parse_capabilities(b'<WMS_Capabilities version="1.3.0"/>')
    with pytest.raises(OrthophotoAdapterError, match="unsafe"):
        parse_capabilities(CAPABILITIES.replace(b"mapy.geoportal.gov.pl", b"attacker.invalid"))
    with pytest.raises(OrthophotoAdapterError, match="EPSG:4326"):
        parse_capabilities(CAPABILITIES.replace(b"EPSG:4326", b"EPSG:3857"))
    with pytest.raises(OrthophotoAdapterError, match="invalid"):
        build_getmap_url((18.0, 50.0, 18.0, 51.0))
