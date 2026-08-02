from pathlib import Path

import pytest

from geo_pipeline.aoi import AoiResolutionError, resolve_aoi, validate_cache_key
from geo_pipeline.cache import cache_paths


def test_equivalent_circle_inputs_resolve_to_one_deterministic_identity() -> None:
    first = resolve_aoi({"type": "circle", "longitude": 18.546285, "latitude": 50.102174, "radius_m": 60_000})
    equivalent = resolve_aoi({"type": "circle", "longitude": 18.5462850, "latitude": 50.1021740, "radius_m": 60000.0})
    changed = resolve_aoi({"type": "circle", "longitude": 18.546285, "latitude": 50.102174, "radius_m": 59_999})

    assert first.aoi_id == equivalent.aoi_id
    assert first.aoi_id != changed.aoi_id
    assert first.geometry == equivalent.geometry
    assert first.as_dict()["aoi_contract_version"] == "provider_aoi/v1"
    assert first.as_dict()["geometry_crs"] == "EPSG:4326"


def test_rybnik_alias_preserves_v1_cache_key_but_has_geometry_identity() -> None:
    alias = resolve_aoi("rybnik_60km")
    direct = resolve_aoi({"type": "circle", "longitude": 18.546285, "latitude": 50.102174, "radius_m": 60_000})

    assert alias.aoi_id == direct.aoi_id
    assert alias.cache_key == "rybnik_60km"
    assert alias.aliases == ("rybnik_60km",)
    assert cache_paths(alias.cache_key, "power", root=Path("/tmp/cache")).root == Path("/tmp/cache/rybnik_60km/power")


def test_approved_prg_reference_keeps_fixture_provenance_without_live_access() -> None:
    resolved = resolve_aoi({"type": "administrative_reference", "reference_id": "prg_gmina_rybnik"})

    assert resolved.input_type == "administrative_reference"
    assert resolved.source_crs == "EPSG:4326"
    assert resolved.boundary_provenance["source_registry_id"] == "prg_wfs"
    assert resolved.boundary_provenance["fixture"] == "backend/data/fixtures/aoi/prg_gmina_rybnik.geojson"
    assert resolved.geometry["type"] == "Polygon"


@pytest.mark.parametrize(
    "value",
    [
        {"type": "circle", "longitude": 181, "latitude": 50, "radius_m": 1_000},
        {"type": "circle", "longitude": 18, "latitude": 50, "radius_m": 99},
        {"type": "circle", "longitude": 18, "latitude": 50, "radius_m": 1_000, "cache_key": "escape"},
        {"type": "administrative_reference", "reference_id": "unknown"},
        {"type": "geometry", "geometry": {"type": "Polygon"}},
    ],
)
def test_invalid_aoi_inputs_are_rejected_deterministically(value: dict[str, object]) -> None:
    with pytest.raises(AoiResolutionError):
        resolve_aoi(value)


def test_cache_keys_reject_path_like_or_untrusted_labels() -> None:
    assert validate_cache_key("fixture_aoi") == "fixture_aoi"
    for value in ("../escape", "unsafe-label", "", "Aoi"):
        with pytest.raises(AoiResolutionError):
            validate_cache_key(value)
