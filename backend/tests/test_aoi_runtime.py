import pytest

from geo_pipeline.aoi_runtime import RuntimeRequestError, administrative_catalog, context_outcomes, profile_outcomes, resolve_runtime_request
from geo_pipeline.config import CACHE_DIR
from geo_pipeline.worker import run_runtime_worker


def point_radius() -> dict[str, object]:
    return {"type": "point_radius", "longitude": 18.546285, "latitude": 50.102174, "radius_m": 60_000}


def test_administrative_catalog_is_source_labelled_and_distinguishes_rybnik_units() -> None:
    catalogue = administrative_catalog()
    assert catalogue["source_registry_id"] == "prg_wfs"
    assert {unit["id"] for unit in catalogue["units"]} >= {"county_rybnik_city", "county_rybnicki", "gmina_rybnik"}


def test_administrative_union_and_profile_order_have_one_request_identity() -> None:
    first = resolve_runtime_request({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki", "county_rybnik_city"]}, "profiles": ["water", "power"]})
    equivalent = resolve_runtime_request({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city", "county_rybnicki", "county_rybnik_city"]}, "profiles": ["power", "water"]})

    assert first["request_id"] == equivalent["request_id"]
    assert first["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert first["aoi"]["boundary_provenance"]["unit_ids"] == sorted(["county_rybnik_city", "county_rybnicki"])


def test_runtime_profiles_are_explicit_and_do_not_fabricate_non_fixture_data() -> None:
    request = {"aoi": point_radius(), "profiles": ["power", "public", "water"]}
    outcomes = profile_outcomes(request)

    assert [outcome["domain"] for outcome in outcomes] == ["power", "public", "water"]
    assert outcomes[0]["status"] == "ready"
    assert outcomes[0]["artifact_aoi_id"] == "rybnik_60km"
    assert outcomes[1]["status"] == "needs_source"
    assert outcomes[1]["artifact_aoi_id"] is None
    assert outcomes[2]["tags"] == {"man_made": ["water_tower", "water_works"], "waterway": ["stream", "river", "canal"], "pipeline": ["water"]}


def test_runtime_reuses_a_valid_local_request_cache(tmp_path) -> None:
    request = {"aoi": point_radius(), "profiles": ["power", "public"]}
    first = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)
    second = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert first["request_result"] == "refresh"
    assert first["job_state"] == "ready"
    assert first["cached_at"].endswith("Z")
    assert second["request_result"] == "cache"
    assert second["outcomes"] == first["outcomes"]


def test_non_osm_contexts_remain_source_labelled_and_non_vector() -> None:
    contexts = context_outcomes({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]}, "profiles": ["water", "gas"]})
    assert {record["source_registry_id"] for record in contexts} >= {"prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"}
    assert next(record for record in contexts if record["source_registry_id"] == "kiut_gesut_wms")["status"] == "reference_only"
    assert all(record["output_kind"] != "analytical_vector" for record in contexts)


@pytest.mark.parametrize(
    "runtime_payload",
    [
        {"aoi": {"type": "point_radius", "longitude": 2.35, "latitude": 48.85, "radius_m": 1_000}, "profiles": ["power"]},
        {"aoi": {"type": "point_radius", "longitude": 14.1, "latitude": 50.0, "radius_m": 50_000}, "profiles": ["power"]},
        {"aoi": {"type": "administrative_selection", "unit_ids": []}, "profiles": ["power"]},
        {"aoi": {"type": "administrative_selection", "unit_ids": ["unknown"]}, "profiles": ["power"]},
        {"aoi": point_radius(), "profiles": ["unknown"]},
    ],
)
def test_invalid_runtime_requests_do_not_resolve_a_cache_identity(runtime_payload: dict[str, object]) -> None:
    with pytest.raises(RuntimeRequestError):
        resolve_runtime_request(runtime_payload)
