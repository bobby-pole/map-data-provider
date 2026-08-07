import json
from datetime import UTC, datetime

import pytest

from geo_pipeline.aoi_runtime import RuntimeRequestError, administrative_catalog, context_outcomes, profile_outcomes, resolve_runtime_request
from geo_pipeline.config import CACHE_DIR
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.runtime_osm import publish_runtime_osm_collection
from geo_pipeline.query_catalog import GAS_OSM_QUERY, POWER_OSM_QUERY, TRANSPORT_OSM_QUERY, WATER_OSM_QUERY
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
    request = {"aoi": point_radius(), "profiles": ["power", "public", "transport", "water", "gas"]}
    outcomes = profile_outcomes(request)
    by_domain = {outcome["domain"]: outcome for outcome in outcomes}

    assert set(by_domain) == {"power", "public", "transport", "water", "gas"}
    assert all(outcome["status"] == "ready" and outcome["artifact_aoi_id"] == "rybnik_60km" for outcome in outcomes)
    assert by_domain["transport"]["query_version"] == "transport-osm/v3"
    assert by_domain["transport"]["tags"] == TRANSPORT_OSM_QUERY.tags
    assert by_domain["power"]["tags"] == POWER_OSM_QUERY.tags
    assert by_domain["water"]["tags"] == WATER_OSM_QUERY.tags
    assert by_domain["gas"]["query_version"] == "gas-osm/v2"
    assert by_domain["gas"]["tags"] == GAS_OSM_QUERY.tags
    assert all(outcome["queried_feature_count"] is None and outcome["accepted_feature_count"] is None and outcome["derived_feature_count"] is None for outcome in outcomes)


def test_runtime_reuses_only_a_valid_local_request_cache(tmp_path, monkeypatch) -> None:
    request = {"aoi": point_radius(), "profiles": ["power", "public"]}
    first = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)
    validated = []
    import geo_pipeline.worker as worker_module
    monkeypatch.setattr(worker_module, "read_domain_pack", lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)))
    second = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert first["request_result"] == "refresh"
    assert first["job_state"] == "ready"
    assert first["cached_at"].endswith("Z")
    assert second["request_result"] == "cache"
    assert second["outcomes"] == first["outcomes"]
    assert validated == [("rybnik_60km", "power", CACHE_DIR), ("rybnik_60km", "public", CACHE_DIR)]


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


def test_runtime_ignores_cache_without_acquisition_counts(tmp_path) -> None:
    request = {"aoi": point_radius(), "profiles": ["gas"]}
    first = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)
    state_path = tmp_path / "provider-runtime-v1" / f"{first['cache_key']}.json"
    stale = json.loads(state_path.read_text(encoding="utf-8"))
    for field in ("queried_feature_count", "accepted_feature_count", "derived_feature_count"):
        stale["outcomes"][0].pop(field)
    state_path.write_text(json.dumps(stale), encoding="utf-8")

    refreshed = run_runtime_worker(request=request, input_mode="fixture", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert refreshed["request_result"] == "refresh"
    assert refreshed["outcomes"][0]["accepted_feature_count"] is None


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

    assert result == {
        "status": "ready",
        "detail": "A bounded OpenStreetMap runtime artifact was acquired, validated and cached for this AOI.",
        "artifact_aoi_id": aoi["aoi_id"],
        "cache_status": "fresh",
        "queried_feature_count": 2,
        "accepted_feature_count": 2,
        "derived_feature_count": 0,
    }
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


def test_runtime_transport_publication_keeps_semantic_categories_independent(tmp_path) -> None:
    aoi = resolve_runtime_request({"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]}, "profiles": ["transport"]})["aoi"]
    source = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"element": "way", "id": 1, "provider_category": "roads", "road_class": "major", "highway": "primary", "name": "fixture major road"}, "geometry": {"type": "LineString", "coordinates": [[18.49, 50.09], [18.50, 50.10]]}},
        {"type": "Feature", "properties": {"element": "way", "id": 3, "provider_category": "roads", "road_class": "secondary", "highway": "tertiary", "name": "fixture secondary road"}, "geometry": {"type": "LineString", "coordinates": [[18.50, 50.10], [18.51, 50.11]]}},
        {"type": "Feature", "properties": {"element": "way", "id": 4, "provider_category": "roads", "road_class": "local", "highway": "residential", "name": "fixture local road"}, "geometry": {"type": "LineString", "coordinates": [[18.51, 50.11], [18.52, 50.12]]}},
        {"type": "Feature", "properties": {"element": "way", "id": 5, "provider_category": "roads", "road_class": "service", "highway": "service", "name": "fixture service road"}, "geometry": {"type": "LineString", "coordinates": [[18.52, 50.12], [18.53, 50.13]]}},
        {"type": "Feature", "properties": {"element": "node", "id": 2, "provider_category": "stations", "railway": "station", "name": "fixture station"}, "geometry": {"type": "Point", "coordinates": [18.5, 50.1]}},
    ]}

    publish_runtime_osm_collection(aoi=aoi, domain="transport", source=source, query_version="transport-osm/v3", root=tmp_path)

    pack = read_domain_pack(aoi["aoi_id"], "transport", root=tmp_path)
    assert [artifact["id"] for artifact in pack["artifacts"]] == ["transport.roads", "transport.stations", "transport.inspection_points"]
    roads = json.loads((tmp_path / aoi["aoi_id"] / "transport" / "domain-pack-v2" / "layers" / "transport.roads.geojson").read_text())
    assert {feature["properties"]["road_class"] for feature in roads["features"]} == {"major", "secondary", "local", "service"}
    inspection = json.loads((tmp_path / aoi["aoi_id"] / "transport" / "domain-pack-v2" / "layers" / "transport.inspection_points.geojson").read_text())
    assert inspection["features"][0]["properties"]["origin_artifact"] == "transport.roads"


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


def test_live_worker_refreshes_transport_profile_for_non_demo_aoi(tmp_path, monkeypatch) -> None:
    request = {"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]}, "profiles": ["transport"]}
    calls = []
    validated = []

    def mock_refresh(*, aoi, domain, root):
        calls.append((aoi["aoi_id"], domain))
        return {"status": "ready", "detail": "Bounded OpenStreetMap transport artifact acquired.", "artifact_aoi_id": aoi["aoi_id"], "cache_status": "fresh", "queried_feature_count": 4, "accepted_feature_count": 3, "derived_feature_count": 2}

    import geo_pipeline.worker as worker_module
    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(worker_module, "read_domain_pack", lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)))

    response = run_runtime_worker(request=request, input_mode="live", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert response["request_result"] == "refresh"
    assert response["job_state"] == "ready"
    assert response["outcomes"][0]["domain"] == "transport"
    assert response["outcomes"][0]["status"] == "ready"
    assert len(calls) == 1
    assert calls[0][1] == "transport"
    assert validated == [(response["aoi"]["aoi_id"], "transport", CACHE_DIR)]


def test_live_worker_refreshes_gas_profile_for_non_demo_aoi(tmp_path, monkeypatch) -> None:
    request = {"aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]}, "profiles": ["gas"]}
    calls = []
    validated = []

    def mock_refresh(*, aoi, domain, root):
        calls.append((aoi["aoi_id"], domain))
        return {"status": "ready", "detail": "Bounded OpenStreetMap gas artifact acquired.", "artifact_aoi_id": aoi["aoi_id"], "cache_status": "fresh", "queried_feature_count": 4, "accepted_feature_count": 3, "derived_feature_count": 2}

    import geo_pipeline.worker as worker_module
    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(worker_module, "read_domain_pack", lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)))

    response = run_runtime_worker(request=request, input_mode="live", cache_root=CACHE_DIR, runtime_root=tmp_path)

    assert response["outcomes"][0]["domain"] == "gas"
    assert response["outcomes"][0]["status"] == "ready"
    assert calls and calls[0][1] == "gas"
    assert validated == [(response["aoi"]["aoi_id"], "gas", CACHE_DIR)]
