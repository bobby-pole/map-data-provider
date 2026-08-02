from pathlib import Path

import pytest

from geo_pipeline.sources.kiut import KiutAdapterError, build_getmap_url, parse_capabilities, reference_descriptor


CAPABILITIES = (Path(__file__).resolve().parents[1] / "data" / "fixtures" / "kiut" / "capabilities.xml").read_bytes()
AOI = {"type": "Polygon", "coordinates": [[[18.5, 50.0], [18.6, 50.0], [18.6, 50.1], [18.5, 50.1], [18.5, 50.0]]]}


def test_parses_verified_utility_layers_and_scales() -> None:
    layers = parse_capabilities(CAPABILITIES)
    assert layers["gesut"].min_scale == 50000
    assert layers["przewod_elektroenergetyczny"].max_scale == 1000


@pytest.mark.parametrize("domain", ["power", "water", "gas", "sewer", "telecom", "district_heating"])
def test_reference_descriptors_are_non_analytical_and_allow_list_domains(domain: str) -> None:
    descriptor = reference_descriptor(domain=domain, aoi_geometry=AOI, scale_denominator=1000, capabilities=CAPABILITIES)
    assert descriptor["status"] == "available_reference"
    assert descriptor["analytical_geojson"] is False
    assert descriptor["coverage"]["state"] == "possible"
    assert "GetMap" in descriptor["get_map"] and descriptor["layer"] in descriptor["get_map"]


def test_reports_uncovered_and_unsupported_scale_without_vector_fallback() -> None:
    far_aoi = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    assert reference_descriptor(domain="power", aoi_geometry=far_aoi, scale_denominator=1000, capabilities=CAPABILITIES)["status"] == "uncovered"
    assert reference_descriptor(domain="power", aoi_geometry=AOI, scale_denominator=1001, capabilities=CAPABILITIES)["status"] == "unsupported_scale"
    assert reference_descriptor(domain="power", aoi_geometry=AOI, scale_denominator=1000, capabilities=None)["status"] == "service_unavailable"


def test_rejects_schema_drift_and_arbitrary_wms_layer_urls() -> None:
    with pytest.raises(KiutAdapterError, match="schema drift"):
        parse_capabilities(b'<WMS_Capabilities version="1.3.0"><Capability><Layer /></Capability></WMS_Capabilities>')
    with pytest.raises(KiutAdapterError, match="allow-listed"):
        build_getmap_url("https://attacker.invalid", (18, 50, 19, 51))
