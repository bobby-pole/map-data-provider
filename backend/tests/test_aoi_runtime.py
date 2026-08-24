import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pytest

from geo_pipeline.aoi_runtime import (
    RuntimeRequestError,
    administrative_boundary,
    administrative_catalog,
    context_outcomes,
    preflight_runtime_request,
    profile_outcomes,
    resolve_runtime_request,
)
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.query_catalog import (
    DISTRICT_HEATING_OSM_QUERY,
    GAS_OSM_QUERY,
    POWER_OSM_QUERY,
    SEWER_OSM_QUERY,
    TELECOM_OSM_QUERY,
    TRANSPORT_OSM_QUERY,
    WATER_OSM_QUERY,
)
from geo_pipeline.runtime_osm import (
    _power_relation_evidence,
    _unavailable_power_relation_evidence,
    publish_runtime_osm_collection,
)
from geo_pipeline.worker import run_runtime_worker, run_worker


def point_radius() -> dict[str, object]:
    return {
        "type": "point_radius",
        "longitude": 18.546285,
        "latitude": 50.102174,
        "radius_m": 35_000,
    }


def seed_runtime_fixture_cache(cache_root: Path, *domains: str) -> None:
    for domain in domains:
        run_worker(
            aoi="rybnik_35km",
            domain=domain,
            input_mode="fixture",
            cache_root=cache_root,
        )


def test_administrative_catalog_is_source_labelled_national_hierarchy_without_bulk_geometry() -> (
    None
):
    catalogue = administrative_catalog()
    assert catalogue["source_registry_id"] == "prg_wfs"
    assert catalogue["catalog_version"] == "prg_administrative_catalog/v2"
    assert len(catalogue["units"]) == 2_875
    assert {unit["id"] for unit in catalogue["units"]} >= {
        "county_2473",
        "county_2412",
        "gmina_2473011",
        "voivodeship_24",
    }
    assert (
        next(unit for unit in catalogue["units"] if unit["id"] == "gmina_2473011")["parent_id"]
        == "county_2473"
    )
    assert all("geometry" not in unit for unit in catalogue["units"])


def test_administrative_union_and_profile_order_have_one_request_identity() -> None:
    first = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnicki", "county_rybnik_city"],
            },
            "profiles": ["water", "power"],
        }
    )
    equivalent = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": [
                    "county_rybnik_city",
                    "county_rybnicki",
                    "county_rybnik_city",
                ],
            },
            "profiles": ["power", "water"],
        }
    )

    assert first["request_id"] == equivalent["request_id"]
    assert first["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert first["aoi"]["boundary_provenance"]["unit_ids"] == [
        "county_2412",
        "county_2473",
    ]


def test_administrative_boundary_and_preflight_keep_actual_prg_geometry_before_acquisition() -> (
    None
):
    boundary = administrative_boundary(["gmina_2473011"])
    assert boundary["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert boundary["aoi"]["boundary_provenance"]["source_registry_id"] == "prg_wfs"
    assert boundary["within_provider_area_limit"] is True

    preflight = preflight_runtime_request(
        {
            "aoi": {"type": "administrative_selection", "unit_ids": ["gmina_2473011"]},
            "profiles": ["power"],
        }
    )
    assert preflight["status"] == "ready"
    assert preflight["code"] == "bounded_provider_request"
    assert preflight["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}


def test_administrative_selection_rejects_entire_voivodeship() -> None:
    with pytest.raises(RuntimeRequestError, match="entire voivodeship"):
        administrative_boundary(["voivodeship_14"])
    with pytest.raises(RuntimeRequestError, match="entire voivodeship"):
        preflight_runtime_request(
            {
                "aoi": {
                    "type": "administrative_selection",
                    "unit_ids": ["voivodeship_24"],
                },
                "profiles": ["power"],
            }
        )


def test_administrative_selection_rejects_more_than_one_voivodeship() -> None:
    # county_1465 (Warszawa in Mazowieckie) and county_2473 (Rybnik in Śląskie)
    with pytest.raises(RuntimeRequestError, match="one voivodeship"):
        administrative_boundary(["county_1465", "county_2473"])
    with pytest.raises(RuntimeRequestError, match="one voivodeship"):
        preflight_runtime_request(
            {
                "aoi": {
                    "type": "administrative_selection",
                    "unit_ids": ["county_1465", "county_2473"],
                },
                "profiles": ["power"],
            }
        )


def test_administrative_selection_enforces_county_limit_and_adjacency() -> None:
    # Up to 3 adjacent counties in Śląskie: Rybnik (2473) + Rybnicki (2412) + Wodzisławski (2415)
    boundary = administrative_boundary(["county_2473", "county_2412", "county_2415"])
    assert boundary["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}

    # More than 3 counties: rejected
    with pytest.raises(RuntimeRequestError, match="more than 3 adjacent counties"):
        administrative_boundary(["county_2473", "county_2412", "county_2415", "county_2402"])

    # Non-adjacent counties in Śląskie: Rybnik (2473) + Częstochowa (2464)
    with pytest.raises(RuntimeRequestError, match="directly adjacent"):
        administrative_boundary(["county_2473", "county_2464"])


def test_administrative_selection_allows_gminas_across_adjacent_counties() -> None:
    catalogue = administrative_catalog()["units"]
    gminas_rybnicki = [
        u["id"] for u in catalogue if u["kind"] == "gmina" and u.get("parent_id") == "county_2412"
    ]
    assert len(gminas_rybnicki) >= 4

    # Gminas across adjacent counties (Rybnik city + Rybnicki county gminas): allowed
    boundary = administrative_boundary(["gmina_2473011", gminas_rybnicki[0]])
    assert boundary["aoi"]["geometry"]["type"] in {"Polygon", "MultiPolygon"}

    # Gminas across non-adjacent counties (Rybnik city + Częstochowa city): rejected
    with pytest.raises(RuntimeRequestError, match="directly adjacent"):
        administrative_boundary(["gmina_2473011", "gmina_2464011"])


def test_point_radius_enforces_20km_limit_for_custom_aoi() -> None:
    # Custom radius <= 20km: allowed
    resolved = resolve_runtime_request(
        {
            "aoi": {
                "type": "point_radius",
                "longitude": 19.0,
                "latitude": 50.0,
                "radius_m": 20_000,
            },
            "profiles": ["power"],
        }
    )
    assert resolved["aoi"]["geometry"]["type"] == "Polygon"

    # Custom radius > 20km: rejected
    with pytest.raises(RuntimeRequestError, match="cannot exceed 20 km"):
        resolve_runtime_request(
            {
                "aoi": {
                    "type": "point_radius",
                    "longitude": 19.0,
                    "latitude": 50.0,
                    "radius_m": 25_000,
                },
                "profiles": ["power"],
            }
        )

    # Default Rybnik 35km baseline: allowed
    demo = resolve_runtime_request(
        {
            "aoi": {
                "type": "point_radius",
                "longitude": 18.546285,
                "latitude": 50.102174,
                "radius_m": 35_000,
            },
            "profiles": ["power"],
        }
    )
    assert demo["aoi"]["geometry"]["type"] == "Polygon"


def test_runtime_profiles_are_explicit_and_do_not_fabricate_non_fixture_data() -> None:
    request = {
        "aoi": point_radius(),
        "profiles": ["power", "public", "transport", "water", "gas", "sewer"],
    }
    outcomes = profile_outcomes(request)
    by_domain = {outcome["domain"]: outcome for outcome in outcomes}

    assert set(by_domain) == {"power", "public", "transport", "water", "gas", "sewer"}
    assert all(
        outcome["status"] == "ready" and outcome["artifact_aoi_id"] == "rybnik_35km"
        for outcome in outcomes
    )
    assert by_domain["transport"]["query_version"] == "transport-osm/v4"
    assert by_domain["transport"]["tags"] == TRANSPORT_OSM_QUERY.tags
    assert by_domain["power"]["tags"] == POWER_OSM_QUERY.tags
    assert by_domain["water"]["tags"] == WATER_OSM_QUERY.tags
    assert by_domain["gas"]["query_version"] == "gas-osm/v2"
    assert by_domain["gas"]["tags"] == GAS_OSM_QUERY.tags
    assert by_domain["sewer"]["query_version"] == SEWER_OSM_QUERY.query_version
    assert by_domain["sewer"]["tags"] == SEWER_OSM_QUERY.tags
    assert all(
        outcome["queried_feature_count"] is None
        and outcome["accepted_feature_count"] is None
        and outcome["derived_feature_count"] is None
        for outcome in outcomes
    )


def test_runtime_reuses_only_a_valid_local_request_cache(tmp_path, monkeypatch) -> None:
    cache_root = tmp_path / "cache"
    request = {"aoi": point_radius(), "profiles": ["power", "public"]}
    seed_runtime_fixture_cache(cache_root, "power", "public")
    first = run_runtime_worker(
        request=request,
        input_mode="fixture",
        cache_root=cache_root,
        runtime_root=tmp_path,
    )
    validated = []
    import geo_pipeline.worker as worker_module

    monkeypatch.setattr(
        worker_module,
        "read_domain_pack",
        lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)),
    )
    second = run_runtime_worker(
        request=request,
        input_mode="fixture",
        cache_root=cache_root,
        runtime_root=tmp_path,
    )

    assert first["request_result"] == "refresh"
    assert first["job_state"] == "ready"
    assert first["cached_at"].endswith("Z")
    assert second["request_result"] == "cache"
    assert second["outcomes"] == first["outcomes"]
    assert validated == [
        ("rybnik_35km", "power", cache_root),
        ("rybnik_35km", "public", cache_root),
    ]


def test_runtime_ignores_incomplete_legacy_local_cache_and_refreshes_it(
    tmp_path,
) -> None:
    cache_root = tmp_path / "cache"
    request = {"aoi": point_radius(), "profiles": ["public"]}
    seed_runtime_fixture_cache(cache_root, "public")
    resolved = resolve_runtime_request(request)
    state_path = tmp_path / "provider-runtime-v1" / f"{resolved['cache_key']}.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(
        f'{{"status":"ok","cache_key":"legacy","cached_at":"{datetime.now(UTC).isoformat()}","outcomes":[{{}}]}}',
        encoding="utf-8",
    )

    response = run_runtime_worker(
        request=request,
        input_mode="fixture",
        cache_root=cache_root,
        runtime_root=tmp_path,
    )

    assert response["request_result"] == "refresh"
    assert response["contexts"]
    assert response["outcomes"][0]["artifact_aoi_id"] == "rybnik_35km"


def test_runtime_ignores_cache_without_acquisition_counts(tmp_path) -> None:
    cache_root = tmp_path / "cache"
    request = {"aoi": point_radius(), "profiles": ["gas"]}
    seed_runtime_fixture_cache(cache_root, "gas")
    first = run_runtime_worker(
        request=request,
        input_mode="fixture",
        cache_root=cache_root,
        runtime_root=tmp_path,
    )
    state_path = tmp_path / "provider-runtime-v1" / f"{first['cache_key']}.json"
    stale = json.loads(state_path.read_text(encoding="utf-8"))
    for field in (
        "queried_feature_count",
        "accepted_feature_count",
        "derived_feature_count",
    ):
        stale["outcomes"][0].pop(field)
    state_path.write_text(json.dumps(stale), encoding="utf-8")

    refreshed = run_runtime_worker(
        request=request,
        input_mode="fixture",
        cache_root=cache_root,
        runtime_root=tmp_path,
    )

    assert refreshed["request_result"] == "refresh"
    assert refreshed["outcomes"][0]["accepted_feature_count"] is None


def test_non_osm_contexts_remain_source_labelled_and_non_vector() -> None:
    contexts = context_outcomes(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["water", "gas"],
        }
    )
    assert {record["source_registry_id"] for record in contexts} >= {
        "prg_wfs",
        "bdot10k",
        "kiut_gesut_wms",
        "geoportal_orthophoto",
        "nmt_nmpt",
    }
    assert (
        next(record for record in contexts if record["source_registry_id"] == "kiut_gesut_wms")[
            "status"
        ]
        == "reference_only"
    )
    assert all(record["output_kind"] != "analytical_vector" for record in contexts)


def test_telecom_runtime_profile_has_reference_only_kiut_context() -> None:
    request = {"aoi": point_radius(), "profiles": ["telecom"]}
    outcome = profile_outcomes(request)[0]
    contexts = context_outcomes(request)

    assert outcome["status"] == "ready"
    assert outcome["query_version"] == TELECOM_OSM_QUERY.query_version
    assert outcome["tags"] == TELECOM_OSM_QUERY.tags
    assert any(
        context["source_registry_id"] == "kiut_gesut_wms" and context["status"] == "reference_only"
        for context in contexts
    )


def test_district_heating_runtime_profile_has_reference_only_kiut_context() -> None:
    request = {"aoi": point_radius(), "profiles": ["district_heating"]}
    outcome = profile_outcomes(request)[0]
    contexts = context_outcomes(request)

    assert outcome["status"] == "ready"
    assert outcome["query_version"] == DISTRICT_HEATING_OSM_QUERY.query_version
    assert outcome["tags"] == DISTRICT_HEATING_OSM_QUERY.tags
    assert any(
        context["source_registry_id"] == "kiut_gesut_wms" and context["status"] == "reference_only"
        for context in contexts
    )


def test_runtime_power_publication_builds_a_valid_pmtiles_domain_pack(tmp_path) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["power"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "ss_power_category": "line",
                    "power": "line",
                    "voltage": "110000",
                    "name": "fixture line",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.45, 50.05], [18.55, 50.15]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "ss_power_category": "substation",
                    "power": "substation",
                    "name": "fixture substation",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
        ],
    }

    result = publish_runtime_osm_collection(
        aoi=aoi,
        domain="power",
        source=source,
        query_version="power-osm/v1",
        root=tmp_path,
    )

    assert result == {
        "status": "ready",
        "detail": "A bounded OpenStreetMap runtime artifact was acquired, validated and cached for this AOI.",
        "artifact_aoi_id": aoi["aoi_id"],
        "cache_status": "fresh",
        "queried_feature_count": 2,
        "accepted_feature_count": 2,
        "derived_feature_count": 0,
    }
    assert [
        artifact["id"]
        for artifact in read_domain_pack(aoi["aoi_id"], "power", root=tmp_path)["artifacts"]
    ] == ["power.lines", "power.assets", "power.osm_relation_evidence"]


def test_runtime_power_publication_keeps_only_delivered_osm_circuit_members(
    tmp_path,
) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["power"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "ss_power_category": "line",
                    "power": "line",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.45, 50.05], [18.55, 50.15]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "ss_power_category": "substation",
                    "power": "substation",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 4,
                    "ss_power_category": "line",
                    "power": "line",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.46, 50.06], [18.56, 50.16]],
                },
            },
        ],
    }
    relation_elements = [
        {
            "type": "relation",
            "id": 33,
            "tags": {"power": "circuit", "name": "Fixture circuit"},
            "members": [
                {"type": "node", "ref": 2, "role": "substation"},
                {"type": "way", "ref": 1, "role": "section"},
                {"type": "way", "ref": 3, "role": "section"},
            ],
        },
        {"type": "way", "id": 1, "nodes": [10, 11]},
        {"type": "way", "id": 3, "nodes": [12, 13]},
    ]

    publish_runtime_osm_collection(
        aoi=aoi,
        domain="power",
        source=source,
        query_version="power-osm/v1",
        root=tmp_path,
        relation_elements=relation_elements,
    )

    pack = read_domain_pack(aoi["aoi_id"], "power", root=tmp_path)
    relation_artifact = next(
        artifact
        for artifact in pack["artifacts"]
        if artifact["id"] == "power.osm_relation_evidence"
    )
    evidence = json.loads(
        (
            tmp_path / aoi["aoi_id"] / "power" / "domain-pack-v2" / relation_artifact["path"]
        ).read_text()
    )
    assert evidence["relations"][0]["relation_id"] == "relation/33"
    assert [member["source_id"] for member in evidence["relations"][0]["members"]] == [
        "node/2",
        "way/1",
    ]
    assert evidence["relations"][0]["members"][1]["endpoint_evidence"] == {
        "start": "node/10",
        "end": "node/11",
    }
    assert evidence["reverse_member_index"] == {
        "node/2": ["relation/33"],
        "way/1": ["relation/33"],
    }


def test_unavailable_power_relation_evidence_keeps_the_power_snapshot_honest() -> None:
    evidence = _unavailable_power_relation_evidence(
        {
            "type": "Polygon",
            "coordinates": [[[18.4, 50.0], [18.6, 50.0], [18.6, 50.2], [18.4, 50.0]]],
        },
        TimeoutError("Overpass relation endpoint timed out"),
    )

    assert evidence["availability"] == "unavailable"
    assert evidence["relations"] == []
    assert evidence["reverse_member_index"] == {}
    assert "Overpass relation endpoint timed out" in evidence["limitations"][1]


def test_power_relation_evidence_accepts_normalized_delivered_source_ids() -> None:
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"source_id": "way/1"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.49, 50.09], [18.50, 50.10]],
                },
            },
            {
                "type": "Feature",
                "properties": {"source_id": "way/2"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[18.49, 50.09], [18.50, 50.09], [18.50, 50.10], [18.49, 50.09]]
                    ],
                },
            },
        ],
    }
    elements = [
        {
            "type": "relation",
            "id": 8,
            "tags": {"power": "circuit", "name": "fixture circuit"},
            "members": [
                {"type": "way", "ref": 1, "role": "line"},
                {"type": "way", "ref": 2, "role": "substation"},
                {"type": "way", "ref": 3, "role": "line"},
            ],
        }
    ]

    evidence = _power_relation_evidence(
        {
            "type": "Polygon",
            "coordinates": [[[18.48, 50.08], [18.51, 50.08], [18.51, 50.11], [18.48, 50.08]]],
        },
        source,
        elements,
    )

    assert evidence["reverse_member_index"] == {
        "way/1": ["relation/8"],
        "way/2": ["relation/8"],
    }
    assert evidence["relations"][0]["members"][0]["geometry"]["type"] == "LineString"


def test_runtime_public_publication_keeps_semantic_categories_independent(
    tmp_path,
) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["public"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "provider_category": "administration",
                    "amenity": "townhall",
                    "name": "fixture townhall",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [18.49, 50.09],
                            [18.50, 50.09],
                            [18.50, 50.10],
                            [18.49, 50.10],
                            [18.49, 50.09],
                        ]
                    ],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "provider_category": "education",
                    "amenity": "school",
                    "name": "fixture school",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
        ],
    }

    publish_runtime_osm_collection(
        aoi=aoi,
        domain="public",
        source=source,
        query_version="public-osm/v1",
        root=tmp_path,
    )

    pack = read_domain_pack(aoi["aoi_id"], "public", root=tmp_path)
    assert [artifact["id"] for artifact in pack["artifacts"]] == [
        "public.administration",
        "public.education",
        "public.inspection_points",
    ]
    inspection = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "public"
            / "domain-pack-v2"
            / "layers"
            / "public.inspection_points.geojson"
        ).read_text()
    )
    assert inspection["features"][0]["properties"]["origin_artifact"] == "public.administration"


def test_runtime_sewer_publication_keeps_explicit_semantic_categories_independent(
    tmp_path,
) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["sewer"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "provider_category": "pipelines",
                    "pipeline": "sewer",
                    "substance": "sewerage",
                    "name": "fixture sewer",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.49, 50.09], [18.50, 50.10]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "provider_category": "facilities",
                    "man_made": "wastewater_plant",
                    "name": "fixture treatment plant",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
        ],
    }

    publish_runtime_osm_collection(
        aoi=aoi,
        domain="sewer",
        source=source,
        query_version=SEWER_OSM_QUERY.query_version,
        root=tmp_path,
    )

    pack = read_domain_pack(aoi["aoi_id"], "sewer", root=tmp_path)
    assert [artifact["id"] for artifact in pack["artifacts"]] == [
        "sewer.pipelines",
        "sewer.facilities",
        "sewer.inspection_points",
    ]
    inspection = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "sewer"
            / "domain-pack-v2"
            / "layers"
            / "sewer.inspection_points.geojson"
        ).read_text()
    )
    assert inspection["features"][0]["properties"]["origin_artifact"] == "sewer.pipelines"


def test_runtime_telecom_publication_preserves_empty_line_source_gap(tmp_path) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["telecom"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 1,
                    "provider_category": "towers",
                    "man_made": "mast",
                    "tower:type": "communication",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "provider_category": "facilities",
                    "telecom": "exchange",
                },
                "geometry": {"type": "Point", "coordinates": [18.51, 50.11]},
            },
        ],
    }

    result = publish_runtime_osm_collection(
        aoi=aoi,
        domain="telecom",
        source=source,
        query_version=TELECOM_OSM_QUERY.query_version,
        root=tmp_path,
    )
    pack = read_domain_pack(aoi["aoi_id"], "telecom", root=tmp_path)
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    lines = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "telecom"
            / "domain-pack-v2"
            / artifacts["telecom.lines"]["path"]
        ).read_text()
    )

    assert result["status"] == "ready"
    assert result["accepted_feature_count"] == 2
    assert lines["features"] == []
    assert lines["metadata"]["readiness"] == "needs_source"


def test_runtime_district_heating_publication_preserves_empty_line_source_gap(
    tmp_path,
) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["district_heating"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "provider_category": "plants",
                    "industrial": "heating_station",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [[18.49, 50.09], [18.50, 50.09], [18.50, 50.10], [18.49, 50.09]]
                    ],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "provider_category": "facilities",
                    "man_made": "heat_exchanger",
                },
                "geometry": {"type": "Point", "coordinates": [18.51, 50.11]},
            },
        ],
    }

    result = publish_runtime_osm_collection(
        aoi=aoi,
        domain="district_heating",
        source=source,
        query_version=DISTRICT_HEATING_OSM_QUERY.query_version,
        root=tmp_path,
    )
    pack = read_domain_pack(aoi["aoi_id"], "district_heating", root=tmp_path)
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    lines = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "district_heating"
            / "domain-pack-v2"
            / artifacts["district_heating.lines"]["path"]
        ).read_text()
    )
    inspection = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "district_heating"
            / "domain-pack-v2"
            / artifacts["district_heating.inspection_points"]["path"]
        ).read_text()
    )

    assert result["status"] == "ready"
    assert result["accepted_feature_count"] == 2
    assert lines["features"] == []
    assert lines["metadata"]["readiness"] == "needs_source"
    assert inspection["features"][0]["properties"]["origin_artifact"] == "district_heating.plants"


def test_runtime_transport_publication_keeps_semantic_categories_independent(
    tmp_path,
) -> None:
    aoi = resolve_runtime_request(
        {
            "aoi": {
                "type": "administrative_selection",
                "unit_ids": ["county_rybnik_city"],
            },
            "profiles": ["transport"],
        }
    )["aoi"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "provider_category": "roads",
                    "road_class": "major",
                    "highway": "primary",
                    "name": "fixture major road",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.49, 50.09], [18.50, 50.10]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 3,
                    "provider_category": "roads",
                    "road_class": "secondary",
                    "highway": "tertiary",
                    "name": "fixture secondary road",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.50, 50.10], [18.51, 50.11]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 4,
                    "provider_category": "roads",
                    "road_class": "local",
                    "highway": "residential",
                    "name": "fixture local road",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.51, 50.11], [18.52, 50.12]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 5,
                    "provider_category": "roads",
                    "road_class": "service",
                    "highway": "service",
                    "name": "fixture service road",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.52, 50.12], [18.53, 50.13]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "element": "node",
                    "id": 2,
                    "provider_category": "stations",
                    "railway": "station",
                    "name": "fixture station",
                },
                "geometry": {"type": "Point", "coordinates": [18.5, 50.1]},
            },
        ],
    }

    publish_runtime_osm_collection(
        aoi=aoi,
        domain="transport",
        source=source,
        query_version="transport-osm/v4",
        root=tmp_path,
    )

    pack = read_domain_pack(aoi["aoi_id"], "transport", root=tmp_path)
    assert [artifact["id"] for artifact in pack["artifacts"]] == [
        "transport.roads",
        "transport.stations",
        "transport.inspection_points",
    ]
    roads = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "transport"
            / "domain-pack-v2"
            / "layers"
            / "transport.roads.geojson"
        ).read_text()
    )
    assert {feature["properties"]["road_class"] for feature in roads["features"]} == {
        "major",
        "secondary",
        "local",
        "service",
    }
    inspection = json.loads(
        (
            tmp_path
            / aoi["aoi_id"]
            / "transport"
            / "domain-pack-v2"
            / "layers"
            / "transport.inspection_points.geojson"
        ).read_text()
    )
    assert inspection["features"][0]["properties"]["origin_artifact"] == "transport.roads"


@pytest.mark.parametrize(
    "runtime_payload",
    [
        {
            "aoi": {
                "type": "point_radius",
                "longitude": 2.35,
                "latitude": 48.85,
                "radius_m": 1_000,
            },
            "profiles": ["power"],
        },
        {
            "aoi": {
                "type": "point_radius",
                "longitude": 14.1,
                "latitude": 50.0,
                "radius_m": 50_000,
            },
            "profiles": ["power"],
        },
        {
            "aoi": {"type": "administrative_selection", "unit_ids": []},
            "profiles": ["power"],
        },
        {
            "aoi": {"type": "administrative_selection", "unit_ids": ["unknown"]},
            "profiles": ["power"],
        },
        {"aoi": point_radius(), "profiles": ["unknown"]},
    ],
)
def test_invalid_runtime_requests_do_not_resolve_a_cache_identity(
    runtime_payload: dict[str, object],
) -> None:
    with pytest.raises(RuntimeRequestError):
        resolve_runtime_request(runtime_payload)


def test_live_worker_refreshes_transport_profile_for_non_demo_aoi(tmp_path, monkeypatch) -> None:
    request = {
        "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]},
        "profiles": ["transport"],
    }
    calls = []
    validated = []

    def mock_refresh(*, aoi, domain, root):
        calls.append((aoi["aoi_id"], domain))
        return {
            "status": "ready",
            "detail": "Bounded OpenStreetMap transport artifact acquired.",
            "artifact_aoi_id": aoi["aoi_id"],
            "cache_status": "fresh",
            "queried_feature_count": 4,
            "accepted_feature_count": 3,
            "derived_feature_count": 2,
        }

    import geo_pipeline.worker as worker_module

    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(
        worker_module,
        "read_domain_pack",
        lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)),
    )

    response = run_runtime_worker(
        request=request,
        input_mode="live",
        cache_root=tmp_path / "cache",
        runtime_root=tmp_path,
        executor_type=ThreadPoolExecutor,
    )

    assert response["request_result"] == "refresh"
    assert response["job_state"] == "ready"
    assert response["outcomes"][0]["domain"] == "transport"
    assert response["outcomes"][0]["status"] == "ready"
    assert len(calls) == 1
    assert calls[0][1] == "transport"
    assert validated == [(response["aoi"]["aoi_id"], "transport", tmp_path / "cache")]


def test_live_worker_refreshes_gas_profile_for_non_demo_aoi(tmp_path, monkeypatch) -> None:
    request = {
        "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]},
        "profiles": ["gas"],
    }
    calls = []
    validated = []

    def mock_refresh(*, aoi, domain, root):
        calls.append((aoi["aoi_id"], domain))
        return {
            "status": "ready",
            "detail": "Bounded OpenStreetMap gas artifact acquired.",
            "artifact_aoi_id": aoi["aoi_id"],
            "cache_status": "fresh",
            "queried_feature_count": 4,
            "accepted_feature_count": 3,
            "derived_feature_count": 2,
        }

    import geo_pipeline.worker as worker_module

    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(
        worker_module,
        "read_domain_pack",
        lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)),
    )

    response = run_runtime_worker(
        request=request,
        input_mode="live",
        cache_root=tmp_path / "cache",
        runtime_root=tmp_path,
        executor_type=ThreadPoolExecutor,
    )

    assert response["outcomes"][0]["domain"] == "gas"
    assert response["outcomes"][0]["status"] == "ready"
    assert calls and calls[0][1] == "gas"
    assert validated == [(response["aoi"]["aoi_id"], "gas", tmp_path / "cache")]


def test_live_worker_refreshes_sewer_profile_for_non_demo_aoi(tmp_path, monkeypatch) -> None:
    request = {
        "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]},
        "profiles": ["sewer"],
    }
    calls = []
    validated = []

    def mock_refresh(*, aoi, domain, root):
        calls.append((aoi["aoi_id"], domain))
        return {
            "status": "ready",
            "detail": "Bounded OpenStreetMap sewer artifact acquired.",
            "artifact_aoi_id": aoi["aoi_id"],
            "cache_status": "fresh",
            "queried_feature_count": 4,
            "accepted_feature_count": 2,
            "derived_feature_count": 1,
        }

    import geo_pipeline.worker as worker_module

    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(
        worker_module,
        "read_domain_pack",
        lambda aoi_id, domain, *, root: validated.append((aoi_id, domain, root)),
    )

    response = run_runtime_worker(
        request=request,
        input_mode="live",
        cache_root=tmp_path / "cache",
        runtime_root=tmp_path,
        executor_type=ThreadPoolExecutor,
    )

    assert response["outcomes"][0]["domain"] == "sewer"
    assert response["outcomes"][0]["status"] == "ready"
    assert calls and calls[0][1] == "sewer"
    assert validated == [(response["aoi"]["aoi_id"], "sewer", tmp_path / "cache")]


def test_live_worker_with_thread_pool_executor_isolates_from_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    request = {
        "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnicki"]},
        "profiles": ["water"],
    }
    called = False

    def mock_refresh(*, aoi: dict, domain: str, root: Path) -> dict:
        nonlocal called
        called = True
        return {
            "status": "ready",
            "detail": "Hermetic in-memory mock acquisition.",
            "artifact_aoi_id": aoi["aoi_id"],
            "cache_status": "fresh",
            "queried_feature_count": 10,
            "accepted_feature_count": 8,
            "derived_feature_count": 2,
        }

    import geo_pipeline.worker as worker_module

    monkeypatch.setattr(worker_module, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(worker_module, "read_domain_pack", lambda *args, **kwargs: None)

    result = run_runtime_worker(
        request=request,
        input_mode="live",
        cache_root=tmp_path / "cache",
        runtime_root=tmp_path,
        executor_type=ThreadPoolExecutor,
    )
    assert called is True
    assert result["outcomes"][0]["status"] == "ready"
    assert result["outcomes"][0]["detail"] == "Hermetic in-memory mock acquisition."
