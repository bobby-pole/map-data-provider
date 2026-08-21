import json
from pathlib import Path

from geo_pipeline.cache import build_rybnik_district_heating_cache
from geo_pipeline.district_heating import category_for_osm_feature
from geo_pipeline.domain_pack import (
    build_rybnik_district_heating_domain_pack,
    read_domain_pack,
)
from geo_pipeline.query_catalog import DISTRICT_HEATING_OSM_QUERY


def test_district_heating_requires_explicit_semantics() -> None:
    assert category_for_osm_feature({"industrial": "heating_station"}) == "plants"
    assert category_for_osm_feature({"power": "plant", "plant:output:heat": "yes"}) == "plants"
    assert (
        category_for_osm_feature({"power": "generator", "generator:output:heat": "true"})
        == "plants"
    )
    assert category_for_osm_feature({"man_made": "heat_exchanger"}) == "facilities"
    assert category_for_osm_feature({"pipeline": "heating"}) == "lines"
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "steam"}) == "lines"
    assert category_for_osm_feature({"building": "industrial"}) is None
    assert category_for_osm_feature({"man_made": "chimney"}) is None
    assert category_for_osm_feature({"man_made": "pipeline"}) is None
    assert category_for_osm_feature({"power": "plant", "plant:source": "gas"}) is None


def test_district_heating_query_is_bounded_to_explicit_candidates() -> None:
    assert DISTRICT_HEATING_OSM_QUERY.query_version == "district-heating-osm/v1"
    assert DISTRICT_HEATING_OSM_QUERY.tags["industrial"] == ["heating_station"]
    assert DISTRICT_HEATING_OSM_QUERY.tags["plant:output:heat"] == [
        "yes",
        "true",
        "1",
        "heat",
    ]
    assert DISTRICT_HEATING_OSM_QUERY.tags["substance"] == [
        "hot_water",
        "steam",
        "heat",
    ]


def test_district_heating_pack_exposes_missing_lines_and_private_kiut(
    tmp_path: Path,
) -> None:
    build_rybnik_district_heating_cache(root=tmp_path)
    pack = build_rybnik_district_heating_domain_pack(root=tmp_path)
    root = tmp_path / "rybnik_35km" / "district_heating" / "domain-pack-v2"
    artifacts = {item["id"]: item for item in pack["artifacts"]}
    lines = json.loads((root / artifacts["district_heating.lines"]["path"]).read_text())
    assert DISTRICT_HEATING_OSM_QUERY.query_version == "district-heating-osm/v1"
    assert lines["metadata"]["readiness"] in {
        "available",
        "usable_with_limitations",
        "needs_source",
    }
    assert artifacts["district_heating.kiut_reference"]["public_export"] is False
    assert {
        item["id"]
        for item in read_domain_pack(
            "rybnik_35km", "district_heating", root=tmp_path, public_export=True
        )["artifacts"]
    } == {
        "district_heating.plants",
        "district_heating.facilities",
        "district_heating.lines",
        "district_heating.inspection_points",
    }
