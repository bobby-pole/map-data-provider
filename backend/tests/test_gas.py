import json
from pathlib import Path

from geo_pipeline.gas import category_for_osm_feature
from geo_pipeline.cache import build_rybnik_gas_cache
from geo_pipeline.domain_pack import build_rybnik_gas_domain_pack, read_domain_pack
from geo_pipeline.query_catalog import GAS_OSM_QUERY


def test_category_for_osm_feature_normalizes_gas_tags_and_rejects_unmapped() -> None:
    assert category_for_osm_feature({"man_made": "gasometer"}) == "facilities"
    assert category_for_osm_feature({"man_made": "gas_station"}) == "facilities"
    assert category_for_osm_feature({"pipeline": "valve", "substance": "gas"}) == "facilities"
    assert category_for_osm_feature({"pipeline": "gas"}) == "pipelines"
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "gas"}) == "pipelines"
    assert category_for_osm_feature({"pipeline": "valve"}) is None
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "oil"}) is None
    assert category_for_osm_feature({"substance": "gas"}) is None
    assert category_for_osm_feature({"man_made": "pipeline", "pipeline": "water"}) is None
    assert category_for_osm_feature({"pipeline": "sewer"}) is None
    assert category_for_osm_feature({"man_made": "pipeline"}) is None
    assert category_for_osm_feature({"building": "yes", "name": "Generic House"}) is None


def test_gas_query_retrieves_only_the_tags_needed_for_explicit_gas_classification() -> None:
    assert GAS_OSM_QUERY.query_version == "gas-osm/v2"
    assert GAS_OSM_QUERY.tags == {
        "pipeline": ["gas", "valve"],
        "man_made": ["gasometer", "gas_station"],
        "substance": ["gas"],
    }


def test_gas_domain_pack_builds_independent_categories_and_inspection_points(tmp_path: Path) -> None:
    build_rybnik_gas_cache(root=tmp_path)
    pack = build_rybnik_gas_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "gas" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}

    facilities = json.loads((pack_root / artifacts["gas.facilities"]["path"]).read_text(encoding="utf-8"))
    pipelines = json.loads((pack_root / artifacts["gas.pipelines"]["path"]).read_text(encoding="utf-8"))
    inspection = json.loads((pack_root / artifacts["gas.inspection_points"]["path"]).read_text(encoding="utf-8"))
    context = json.loads((pack_root / artifacts["gas.context_and_comparison"]["path"]).read_text(encoding="utf-8"))

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert facilities["features"][0]["properties"]["asset_type"] == "facilities"
    assert pipelines["features"][0]["properties"]["asset_type"] == "pipelines"

    assert inspection["features"][0]["properties"]["origin_artifact"].startswith("gas.")
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"

    evidence = json.loads((pack_root / artifacts["gas.osm_source_evidence"]["path"]).read_text(encoding="utf-8"))
    assert evidence["category_rules"]["gas.facilities"].endswith("substance=gas.")
    assert evidence["category_rules"]["gas.pipelines"].startswith("man_made=pipeline requires substance=gas")

    public = read_domain_pack("rybnik_35km", "gas", root=tmp_path, public_export=True)["artifacts"]
    assert {artifact["id"] for artifact in public} == {
        "gas.facilities", "gas.pipelines", "gas.inspection_points",
    }
