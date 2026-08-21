import json
from pathlib import Path

from geo_pipeline.cache import build_rybnik_telecom_cache
from geo_pipeline.domain_pack import build_rybnik_telecom_domain_pack, read_domain_pack
from geo_pipeline.query_catalog import TELECOM_OSM_QUERY
from geo_pipeline.telecom import category_for_osm_feature


def test_category_for_osm_feature_requires_explicit_telecom_semantics() -> None:
    assert category_for_osm_feature({"man_made": "communications_tower"}) == "towers"
    assert category_for_osm_feature({"man_made": "mast", "tower:type": "communication"}) == "towers"
    assert (
        category_for_osm_feature({"man_made": "tower", "communication:mobile_phone": "yes"})
        == "towers"
    )
    assert category_for_osm_feature({"telecom": "exchange"}) == "facilities"
    assert (
        category_for_osm_feature({"man_made": "antenna", "communication:radio": "yes"})
        == "facilities"
    )
    assert category_for_osm_feature({"communication": "line"}) == "lines"
    assert category_for_osm_feature({"cable": "communication"}) == "lines"
    assert category_for_osm_feature({"man_made": "mast"}) is None
    assert category_for_osm_feature({"man_made": "tower"}) is None
    assert category_for_osm_feature({"man_made": "utility_pole"}) is None
    assert category_for_osm_feature({"building": "yes", "utility": "telecom"}) is None
    assert category_for_osm_feature({"communication:mobile_phone": "yes"}) is None


def test_telecom_query_is_bounded_to_explicit_candidates() -> None:
    assert TELECOM_OSM_QUERY.query_version == "telecom-osm/v1"
    assert TELECOM_OSM_QUERY.tags["tower:type"] == ["communication"]
    assert TELECOM_OSM_QUERY.tags["communication"] == ["line"]
    assert TELECOM_OSM_QUERY.tags["cable"] == ["communication"]
    assert "pole" not in TELECOM_OSM_QUERY.tags["man_made"]


def test_telecom_domain_pack_keeps_missing_lines_as_visible_source_gap(
    tmp_path: Path,
) -> None:
    build_rybnik_telecom_cache(root=tmp_path)
    pack = build_rybnik_telecom_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "telecom" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    towers = json.loads(
        (pack_root / artifacts["telecom.towers"]["path"]).read_text(encoding="utf-8")
    )
    facilities = json.loads(
        (pack_root / artifacts["telecom.facilities"]["path"]).read_text(encoding="utf-8")
    )
    lines = json.loads((pack_root / artifacts["telecom.lines"]["path"]).read_text(encoding="utf-8"))
    evidence = json.loads(
        (pack_root / artifacts["telecom.osm_source_evidence"]["path"]).read_text(encoding="utf-8")
    )

    assert towers["features"][0]["properties"]["asset_type"] == "towers"
    assert facilities["features"][0]["properties"]["asset_type"] == "facilities"
    assert lines["metadata"]["readiness"] in {
        "available",
        "usable_with_limitations",
        "needs_source",
    }
    if not lines["features"]:
        assert "zero-feature telecom.lines" in evidence["source_gap"]
    assert artifacts["telecom.kiut_reference"]["public_export"] is False
    public = read_domain_pack("rybnik_35km", "telecom", root=tmp_path, public_export=True)[
        "artifacts"
    ]
    assert {artifact["id"] for artifact in public} == {
        "telecom.towers",
        "telecom.facilities",
        "telecom.lines",
        "telecom.inspection_points",
    }
