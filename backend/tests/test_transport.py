import json
from pathlib import Path

from geo_pipeline.cache import build_rybnik_transport_cache
from geo_pipeline.domain_pack import (
    build_rybnik_transport_domain_pack,
    read_domain_pack,
)
from geo_pipeline.transport import category_for_osm_feature, road_class_for_osm_feature


def test_category_for_osm_feature_normalizes_transport_tags_and_rejects_unmapped() -> None:
    assert category_for_osm_feature({"highway": "primary", "name": "Main Street"}) == "roads"
    assert category_for_osm_feature({"highway": "secondary"}) == "roads"
    assert category_for_osm_feature({"highway": "tertiary"}) == "roads"
    assert category_for_osm_feature({"highway": "residential"}) is None
    assert category_for_osm_feature({"highway": "service"}) is None
    assert category_for_osm_feature({"railway": "rail"}) == "railways"
    assert category_for_osm_feature({"railway": "station", "name": "Central Station"}) == "stations"
    assert category_for_osm_feature({"aeroway": "helipad"}) == "aviation"
    assert category_for_osm_feature({"building": "yes", "name": "Generic Building"}) is None
    assert category_for_osm_feature({"highway": "footway"}) is None


def test_road_class_for_osm_feature_classifies_major_and_secondary() -> None:
    assert road_class_for_osm_feature({"highway": "primary"}) == "major"
    assert road_class_for_osm_feature({"highway": "secondary"}) == "secondary"
    assert road_class_for_osm_feature({"highway": "tertiary"}) == "secondary"
    assert road_class_for_osm_feature({"highway": "residential"}) is None
    assert road_class_for_osm_feature({"highway": "service"}) is None
    assert road_class_for_osm_feature({"highway": "footway"}) is None


def test_transport_domain_pack_builds_independent_categories_and_inspection_points(
    tmp_path: Path,
) -> None:
    build_rybnik_transport_cache(root=tmp_path)
    pack = build_rybnik_transport_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_35km" / "transport" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}

    roads = json.loads(
        (pack_root / artifacts["transport.roads"]["path"]).read_text(encoding="utf-8")
    )
    railways = json.loads(
        (pack_root / artifacts["transport.railways"]["path"]).read_text(encoding="utf-8")
    )
    stations = json.loads(
        (pack_root / artifacts["transport.stations"]["path"]).read_text(encoding="utf-8")
    )
    aviation = json.loads(
        (pack_root / artifacts["transport.aviation"]["path"]).read_text(encoding="utf-8")
    )
    inspection = json.loads(
        (pack_root / artifacts["transport.inspection_points"]["path"]).read_text(encoding="utf-8")
    )
    context = json.loads(
        (pack_root / artifacts["transport.context_and_comparison"]["path"]).read_text(
            encoding="utf-8"
        )
    )

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    road_classes = {f["properties"]["road_class"] for f in roads["features"]}
    assert road_classes == {"major", "secondary"}
    assert railways["features"][0]["properties"]["asset_type"] == "railways"
    assert stations["features"][0]["properties"]["asset_type"] == "stations"
    assert aviation["features"][0]["properties"]["asset_type"] == "aviation"

    assert inspection["features"][0]["properties"]["origin_artifact"].startswith("transport.")
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"

    public = read_domain_pack("rybnik_35km", "transport", root=tmp_path, public_export=True)[
        "artifacts"
    ]
    assert {artifact["id"] for artifact in public} == {
        "transport.roads",
        "transport.railways",
        "transport.stations",
        "transport.aviation",
        "transport.inspection_points",
    }
