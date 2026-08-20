import json
from pathlib import Path

from geo_pipeline.sewer import category_for_osm_feature
from geo_pipeline.cache import build_rybnik_sewer_cache
from geo_pipeline.domain_pack import build_rybnik_sewer_domain_pack, read_domain_pack
from geo_pipeline.query_catalog import SEWER_OSM_QUERY


def test_category_for_osm_feature_normalizes_sewer_tags_and_rejects_unmapped() -> None:
    assert category_for_osm_feature({"man_made": "wastewater_plant"}) == "facilities"
    assert category_for_osm_feature({"man_made": "septic_tank"}) == "facilities"
    assert category_for_osm_feature({"man_made": "pumping_station", "pumping": "sewer"}) == "facilities"
    assert category_for_osm_feature({"man_made": "pumping_station", "substance": "wastewater"}) == "facilities"
    assert category_for_osm_feature({"man_made": "manhole", "utility": "sewer"}) == "facilities"
    assert category_for_osm_feature({"pipeline": "sewer"}) == "pipelines"
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "sewerage"}) == "pipelines"
    assert category_for_osm_feature({"pipeline": "water"}) is None
    assert category_for_osm_feature({"pipeline": "gas"}) is None
    assert category_for_osm_feature({"pipeline": "drain"}) is None
    assert category_for_osm_feature({"pipeline": "drain", "substance": "water"}) is None
    assert category_for_osm_feature({"pipeline": "sewer", "substance": "water"}) is None
    assert category_for_osm_feature({"man_made": "manhole", "sewer": "stormwater"}) is None
    assert category_for_osm_feature({"man_made": "pumping_station", "pumping": "water"}) is None
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "gas"}) is None
    assert category_for_osm_feature({"building": "yes", "name": "Generic House"}) is None


def test_sewer_query_retrieves_only_explicit_sewer_or_wastewater_semantics() -> None:
    assert SEWER_OSM_QUERY.query_version == "sewer-osm/v2"
    assert SEWER_OSM_QUERY.tags == {
        "pipeline": ["sewer"],
        "man_made": ["wastewater_plant", "septic_tank"],
        "pumping": ["sewer", "wastewater"],
        "substance": ["sewerage", "wastewater"],
        "utility": ["sewer"],
    }


def test_sewer_domain_pack_builds_independent_categories_and_inspection_points(tmp_path: Path) -> None:
    build_rybnik_sewer_cache(root=tmp_path)
    pack = build_rybnik_sewer_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "sewer" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}

    facilities = json.loads((pack_root / artifacts["sewer.facilities"]["path"]).read_text(encoding="utf-8"))
    pipelines = json.loads((pack_root / artifacts["sewer.pipelines"]["path"]).read_text(encoding="utf-8"))
    inspection = json.loads((pack_root / artifacts["sewer.inspection_points"]["path"]).read_text(encoding="utf-8"))
    context = json.loads((pack_root / artifacts["sewer.context_and_comparison"]["path"]).read_text(encoding="utf-8"))

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert facilities["features"][0]["properties"]["asset_type"] == "facilities"
    assert pipelines["features"][0]["properties"]["asset_type"] == "pipelines"

    assert inspection["features"][0]["properties"]["origin_artifact"].startswith("sewer.")
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"
    evidence = json.loads((pack_root / artifacts["sewer.osm_source_evidence"]["path"]).read_text(encoding="utf-8"))
    assert "stormwater" in evidence["sewer_semantics_rule"]

    public = read_domain_pack("rybnik_35km", "sewer", root=tmp_path, public_export=True)["artifacts"]
    assert {artifact["id"] for artifact in public} == {
        "sewer.facilities", "sewer.pipelines", "sewer.inspection_points",
    }
