import json
from datetime import UTC, datetime

import pytest

from geo_pipeline.aoi_runtime import RuntimeRequestError, administrative_catalog, context_outcomes, profile_outcomes, resolve_runtime_request
from geo_pipeline.config import CACHE_DIR
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.runtime_osm import publish_runtime_osm_collection
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
    assert outcomes[1]["status"] == "ready"
    assert outcomes[1]["artifact_aoi_id"] == "rybnik_60km"
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


def test_runtime_ignores_incomplete_legacy_local_cache_and_refreshes_it(tmp_path) -> None:
    request = {"aoi": point_radius(), "profiles": ["public"]}
    resolved = resolve_runtime_request(request)
    state_path = tmp_path / "provider-runtime-v1" / f"{resolved['cache_key']}.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(
        f'{{"status":"ok","cache_key":"legacy","cached_at":"{datetime.now(UTC).isoformat()}","outcomes":[{{}}]}}',
        encoding="utf-8",
    )

    response = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert response["request_result"] == "refresh"
    assert response["contexts"]
    assert response["outcomes"][0]["artifact_aoi_id"] == "rybnik_60km"


def test_non_osm_contexts_remain_source_labelled_and_non_vector() -> None:
    contexts = context_outcomes({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]}, "profiles": ["water", "gas"]})
    assert {record["source_registry_id"] for record in contexts} >= {"prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"}
    assert next(record for record in contexts if record["source_registry_id"] == "kiut_gesut_wms")["status"] == "reference_only"
    assert all(record["output_kind"] != "analytical_vector" for record in contexts)


def test_runtime_power_publication_builds_a_valid_pmtiles_domain_pack(tmp_path) -> None:
    aoi = resolve_runtime_request({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]}, "profiles": ["power"]})["aoi"]
    source = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"element": "way", "id": 1, "ss_power_category": "line", "power": "line", "voltage": "110000", "name": "fixture line"}, "geometry": {"type": "LineString", "coordinates": [[18.45, 50.05], [18.55, 50.15]]}},
        {"type": "Feature", "properties": {"element": "node", "id": 2, "ss_power_category": "substation", "power": "substation", "name": "fixture substation"}, "geometry": {"type": "Point", "coordinates": [18.5, 50.1]}},
    ]}

    result = publish_runtime_osm_collection(aoi=aoi, domain="power", source=source, query_version="power-osm/v1", root=tmp_path)

    assert result == {"status": "ready", "detail": "A bounded OpenStreetMap runtime artifact was acquired, validated and cached for this AOI.", "artifact_aoi_id": aoi["aoi_id"], "cache_status": "fresh"}
    assert [artifact["id"] for artifact in read_domain_pack(aoi["aoi_id"], "power", root=tmp_path)["artifacts"]] == ["power.lines", "power.assets"]


def test_runtime_public_publication_keeps_semantic_categories_independent(tmp_path) -> None:
    aoi = resolve_runtime_request({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]}, "profiles": ["public"]})["aoi"]
    source = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"element": "way", "id": 1, "provider_category": "administration", "amenity": "townhall", "name": "fixture townhall"}, "geometry": {"type": "Polygon", "coordinates": [[[18.49, 50.09], [18.50, 50.09], [18.50, 50.10], [18.49, 50.10], [18.49, 50.09]]]}},
        {"type": "Feature", "properties": {"element": "node", "id": 2, "provider_category": "education", "amenity": "school", "name": "fixture school"}, "geometry": {"type": "Point", "coordinates": [18.5, 50.1]}},
    ]}

    publish_runtime_osm_collection(aoi=aoi, domain="public", source=source, query_version="public-osm/v1", root=tmp_path)

    pack = read_domain_pack(aoi["aoi_id"], "public", root=tmp_path)
    assert [artifact["id"] for artifact in pack["artifacts"]] == ["public.administration", "public.education", "public.inspection_points"]
    inspection = json.loads((tmp_path / aoi["aoi_id"] / "public" / "domain-pack-v2" / "layers" / "public.inspection_points.geojson").read_text())
    assert inspection["features"][0]["properties"]["origin_artifact"] == "public.administration"


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
