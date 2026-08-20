import json
from pathlib import Path

from geo_pipeline.bridges import category_for_osm_feature
from geo_pipeline.cache import build_rybnik_bridges_cache
from geo_pipeline.domain_pack import build_rybnik_bridges_domain_pack, read_domain_pack


def test_category_for_osm_feature_normalizes_bridge_tags_and_rejects_unmapped() -> None:
    assert category_for_osm_feature({"bridge": "yes", "name": "Castle Bridge"}) == "bridges"
    assert category_for_osm_feature({"man_made": "bridge"}) == "bridges"
    assert category_for_osm_feature({"bridge": "aqueduct"}) == "bridges"
    assert category_for_osm_feature({"bridge": "viaduct"}) == "viaducts"
    assert category_for_osm_feature({"highway": "viaduct"}) == "viaducts"
    assert category_for_osm_feature({"railway": "level_crossing"}) == "crossings"
    assert category_for_osm_feature({"railway": "crossing"}) == "crossings"
    assert category_for_osm_feature({"building": "yes", "name": "Generic Building"}) is None
    assert category_for_osm_feature({"highway": "footway"}) is None


def test_bridges_domain_pack_builds_independent_categories_and_inspection_points(tmp_path: Path) -> None:
    build_rybnik_bridges_cache(root=tmp_path)
    pack = build_rybnik_bridges_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "bridges" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}

    bridges = json.loads((pack_root / artifacts["bridges.bridges"]["path"]).read_text(encoding="utf-8"))
    viaducts = json.loads((pack_root / artifacts["bridges.viaducts"]["path"]).read_text(encoding="utf-8"))
    crossings = json.loads((pack_root / artifacts["bridges.crossings"]["path"]).read_text(encoding="utf-8"))
    inspection = json.loads((pack_root / artifacts["bridges.inspection_points"]["path"]).read_text(encoding="utf-8"))
    context = json.loads((pack_root / artifacts["bridges.context_and_comparison"]["path"]).read_text(encoding="utf-8"))

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert bridges["features"][0]["properties"]["asset_type"] == "bridges"
    assert viaducts["features"][0]["properties"]["asset_type"] == "viaducts"
    assert crossings["features"][0]["properties"]["asset_type"] == "crossings"

    assert inspection["features"][0]["properties"]["origin_artifact"].startswith("bridges.")
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"

    public = read_domain_pack("rybnik_35km", "bridges", root=tmp_path, public_export=True)["artifacts"]
    assert {artifact["id"] for artifact in public} == {
        "bridges.bridges", "bridges.viaducts", "bridges.crossings", "bridges.inspection_points",
    }
