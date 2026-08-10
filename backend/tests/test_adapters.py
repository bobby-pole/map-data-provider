from pathlib import Path

import pytest

from geo_pipeline.adapters import AdapterError, registered_adapters, resolve_adapter


def test_power_is_registered_through_a_versioned_query_catalog() -> None:
    adapter = resolve_adapter("rybnik_60km", "power")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "power-osmnx/v1"
    assert adapter.query.tags["power"]


def test_emergency_is_registered_through_an_explicit_osm_query_catalog() -> None:
    adapter = resolve_adapter("rybnik_60km", "emergency")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "emergency-osm/v1"
    assert adapter.query.tags["amenity"] == ["hospital", "fire_station", "police", "ambulance_station"]


def test_public_services_are_registered_through_an_explicit_osm_query_catalog() -> None:
    adapter = resolve_adapter("rybnik_60km", "public")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "public-osm/v1"
    assert adapter.query.tags["office"] == ["government"]


def test_gas_is_registered_through_an_explicit_and_bounded_osm_query_catalog() -> None:
    adapter = resolve_adapter("rybnik_60km", "gas")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "gas-osm/v2"
    assert adapter.query.tags["pipeline"] == ["gas", "valve"]
    assert "pipeline" not in adapter.query.tags["man_made"]


def test_telecom_is_registered_with_explicit_tower_facility_and_line_candidates() -> None:
    adapter = resolve_adapter("rybnik_60km", "telecom")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "telecom-osm/v1"
    assert adapter.query.tags["tower:type"] == ["communication"]
    assert adapter.query.tags["communication"] == ["line"]


def test_district_heating_is_registered_with_explicit_heat_candidates() -> None:
    adapter = resolve_adapter("rybnik_60km", "district_heating")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "district-heating-osm/v1"
    assert adapter.query.tags["industrial"] == ["heating_station"]
    assert adapter.query.tags["plant:output:heat"] == ["yes", "true", "1", "heat"]


def test_unsupported_targets_fail_before_any_cache_path_is_published(tmp_path: Path) -> None:
    with pytest.raises(AdapterError, match="Unsupported registered AOI/domain target"):
        resolve_adapter("unknown", "power")
    assert not list(tmp_path.iterdir())
