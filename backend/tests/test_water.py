import json
from pathlib import Path

from geo_pipeline.cache import build_rybnik_water_cache
from geo_pipeline.domain_pack import build_rybnik_water_domain_pack, read_domain_pack
from geo_pipeline.query_catalog import WATER_OSM_QUERY
from geo_pipeline.water import category_for_osm_feature


def test_category_for_osm_feature_normalizes_water_tags_and_rejects_unmapped() -> None:
    assert category_for_osm_feature({"man_made": "water_works", "name": "SUW Gzel"}) == "facilities"
    assert category_for_osm_feature({"man_made": "water_tower"}) == "facilities"
    assert (
        category_for_osm_feature({"man_made": "pumping_station", "pumping": "water"})
        == "facilities"
    )
    assert (
        category_for_osm_feature({"man_made": "pumping_station", "substance": "water"})
        == "facilities"
    )
    assert category_for_osm_feature({"amenity": "water_point"}) == "facilities"
    assert category_for_osm_feature({"pipeline": "water", "substance": "water"}) == "pipelines"
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "water"}) == "pipelines"
    assert category_for_osm_feature({"waterway": "river", "name": "Ruda"}) == "waterways"
    assert category_for_osm_feature({"waterway": "stream"}) == "waterways"
    assert category_for_osm_feature({"building": "yes", "name": "Generic House"}) is None
    assert category_for_osm_feature({"highway": "footway"}) is None
    assert category_for_osm_feature({"man_made": "pipeline", "substance": "gas"}) is None
    assert category_for_osm_feature({"man_made": "pipeline"}) is None
    assert category_for_osm_feature({"man_made": "pumping_station", "pumping": "sewage"}) is None
    assert category_for_osm_feature({"man_made": "pumping_station"}) is None


def test_water_query_retrieves_only_explicit_water_semantics() -> None:
    assert WATER_OSM_QUERY.query_version == "water-osm/v2"
    assert WATER_OSM_QUERY.tags == {
        "waterway": ["river", "stream", "canal", "drain", "ditch"],
        "pipeline": ["water"],
        "man_made": ["water_works", "water_tower"],
        "amenity": ["water_point"],
        "pumping": ["water"],
        "substance": ["water"],
    }


def test_water_domain_pack_builds_independent_categories_and_inspection_points(
    tmp_path: Path,
) -> None:
    build_rybnik_water_cache(root=tmp_path)
    pack = build_rybnik_water_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "water" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}

    facilities = json.loads(
        (pack_root / artifacts["water.facilities"]["path"]).read_text(encoding="utf-8")
    )
    pipelines = json.loads(
        (pack_root / artifacts["water.pipelines"]["path"]).read_text(encoding="utf-8")
    )
    waterways = json.loads(
        (pack_root / artifacts["water.waterways"]["path"]).read_text(encoding="utf-8")
    )
    inspection = json.loads(
        (pack_root / artifacts["water.inspection_points"]["path"]).read_text(encoding="utf-8")
    )
    context = json.loads(
        (pack_root / artifacts["water.context_and_comparison"]["path"]).read_text(encoding="utf-8")
    )

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert facilities["features"][0]["properties"]["asset_type"] == "facilities"
    assert pipelines["features"][0]["properties"]["asset_type"] == "pipelines"
    assert waterways["features"][0]["properties"]["asset_type"] == "waterways"

    assert inspection["features"][0]["properties"]["origin_artifact"].startswith("water.")
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"

    public = read_domain_pack("rybnik_35km", "water", root=tmp_path, public_export=True)[
        "artifacts"
    ]
    assert {artifact["id"] for artifact in public} == {
        "water.facilities",
        "water.pipelines",
        "water.waterways",
        "water.inspection_points",
    }
