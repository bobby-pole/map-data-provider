import json
import shutil
from pathlib import Path

import pytest

from geo_pipeline.cache import build_rybnik_emergency_cache, build_rybnik_gas_cache, build_rybnik_public_cache, build_rybnik_transport_cache, cache_paths
from geo_pipeline.domain_pack import (
    build_rybnik_emergency_domain_pack,
    build_rybnik_gas_domain_pack,
    build_rybnik_power_domain_pack,
    build_rybnik_public_domain_pack,
    build_rybnik_transport_domain_pack,
    read_domain_pack,
    validate_domain_pack,
)
from geo_pipeline.public_services import category_for_osm_feature


def _legacy_power(root: Path) -> None:
    source = cache_paths("rybnik_60km", "power")
    target = cache_paths("rybnik_60km", "power", root=root)
    target.root.mkdir(parents=True)
    for old, new in ((source.layer, target.layer), (source.metadata, target.metadata), (source.readiness, target.readiness)):
        shutil.copyfile(old, new)


def test_power_domain_pack_v2_preserves_v1_cache_compatibility(tmp_path: Path) -> None:
    _legacy_power(tmp_path)
    pack = build_rybnik_power_domain_pack(root=tmp_path)
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    pack_root = tmp_path / "rybnik_60km" / "power" / "domain-pack-v2"
    representative_points = json.loads((pack_root / artifacts["power.representative_points"]["path"]).read_text())

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert pack["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"},
        {"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"},
    ]
    assert {"power.lines", "power.assets", "power.supports", "power.representative_points", "power.osm_source_evidence", "power.osm_relation_evidence", "power.kiut_reference"} == set(artifacts)
    assert artifacts["power.kiut_reference"]["public_export"] is False and "path" not in artifacts["power.kiut_reference"]
    assert artifacts["power.osm_source_evidence"]["format"] == "json"
    assert representative_points["features"][0]["properties"]["source_id"] == "way/32043840"
    assert representative_points["features"][0]["properties"]["source_geometry_type"] == "LineString"
    presentation = json.loads((pack_root / "presentation" / "manifest.json").read_text())
    assert presentation["presentation_version"] == "provider_map_presentation/v1"
    assert presentation["archive"]["format"] == "pmtiles"
    assert {layer["artifact_id"] for layer in presentation["layers"]} == {"power.lines", "power.assets", "power.supports"}
    public = read_domain_pack("rybnik_60km", "power", root=tmp_path, public_export=True)["artifacts"]
    assert [artifact["id"] for artifact in public] == ["power.lines", "power.assets", "power.supports"]


def test_domain_pack_rejects_escape_checksum_and_count_mismatch(tmp_path: Path) -> None:
    _legacy_power(tmp_path)
    build_rybnik_power_domain_pack(root=tmp_path)
    manifest_path = tmp_path / "rybnik_60km" / "power" / "domain-pack-v2" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["artifacts"][0]["path"] = "../layer.geojson"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="escapes"):
        read_domain_pack("rybnik_60km", "power", root=tmp_path)


def test_domain_pack_keeps_native_raster_private_and_rejects_reference_public_export(tmp_path: Path) -> None:
    pack_root = tmp_path / "fixture_aoi" / "water" / "domain-pack-v2"
    (pack_root / "rasters").mkdir(parents=True)
    (pack_root / "rasters" / "terrain.tif").write_bytes(b"fixture-raster")
    (pack_root / "validation.json").write_text("{}")
    (pack_root / "readiness.json").write_text("{}")
    manifest = {
        "domain_pack_version": "provider_domain_pack/v2", "aoi_id": "fixture_aoi", "domain": "water",
        "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}],
        "artifacts": [
            {"id": "water.terrain", "kind": "native_raster", "format": "geotiff", "path": "rasters/terrain.tif", "sha256": "b06649195b8f4332ac1430d51d9fba43f94acd5189b47a4d875e8e1a4a9479dd", "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}], "public_export": False},
            {"id": "water.kiut", "kind": "remote_service", "format": "wms", "source_provenance": [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}], "public_export": False},
        ], "validation": {"path": "validation.json"}, "readiness": {"path": "readiness.json"},
    }
    validate_domain_pack(manifest, pack_root=pack_root)
    manifest["artifacts"][0]["public_export"] = True
    with pytest.raises(ValueError, match="Native raster"):
        validate_domain_pack(manifest, pack_root=pack_root)
    manifest["artifacts"][0]["public_export"] = False
    manifest["artifacts"][1]["public_export"] = True
    with pytest.raises(ValueError, match="public_export"):
        validate_domain_pack(manifest, pack_root=pack_root)


def test_emergency_pack_retains_original_osm_geometry_and_distinct_prg_representative_points(tmp_path: Path) -> None:
    build_rybnik_emergency_cache(root=tmp_path)
    pack = build_rybnik_emergency_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_60km" / "emergency" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    hospital = json.loads((pack_root / artifacts["emergency.hospital"]["path"]).read_text())
    inspection = json.loads((pack_root / artifacts["emergency.inspection_points"]["path"]).read_text())
    official_police = json.loads((pack_root / artifacts["emergency.official_police"]["path"]).read_text())

    assert hospital["features"][0]["geometry"]["type"] == "Polygon"
    assert inspection["features"][0]["properties"]["source_geometry_type"] == "Polygon"
    assert official_police["features"][0]["properties"] == {
        "source": "PRG (official unit-area evidence)", "source_id": "prg_k02/1350186", "domain": "emergency",
        "asset_type": "police", "confidence": "medium", "missing_fields": [], "limitations": official_police["metadata"]["limitations"],
        "eligible_for_analysis": True, "source_geometry_type": "MultiSurface", "geometry_role": "representative_point_from_official_unit_area",
        "source_response_sha256": "cd3e2eb355292207aa72b71cc5c3e29328fd7d48261c17288e5d87e7264f5266", "source_attributes": {
            "name": "Komenda Miejska Policji w Żorach", "official_type": "K02_Komenda_powiatowa_policji", "iip_identifier": "beaf5604-b69f-40f9-bfd9-cdfd23fb30b4",
            "jpt_id": "1350186", "version_from": "2025-07-17",
        },
    }
    assert official_police["features"][0]["geometry"]["type"] == "Point"
    assert read_domain_pack("rybnik_60km", "emergency", root=tmp_path, public_export=True)["artifacts"][-1]["id"] == "emergency.inspection_points"


def test_public_pack_keeps_facility_semantics_separate_from_buildings_and_publishes_comparison_evidence(tmp_path: Path) -> None:
    assert category_for_osm_feature({"building": "yes", "name": "Unlabelled building"}) is None
    build_rybnik_public_cache(root=tmp_path)
    pack = build_rybnik_public_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_60km" / "public" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    administration = json.loads((pack_root / artifacts["public.administration"]["path"]).read_text())
    inspection = json.loads((pack_root / artifacts["public.inspection_points"]["path"]).read_text())
    context = json.loads((pack_root / artifacts["public.context_and_comparison"]["path"]).read_text())

    assert administration["features"][0]["geometry"]["type"] == "Polygon"
    assert inspection["features"][0]["properties"]["origin_artifact"] == "public.administration"
    assert inspection["features"][0]["properties"]["source_geometry_type"] == "Polygon"
    assert context["bdot10k"]["status"] == "context_only"
    assert context["comparison"][0]["outcome"] == "ambiguous"
    assert {artifact["id"] for artifact in read_domain_pack("rybnik_60km", "public", root=tmp_path, public_export=True)["artifacts"]} == {
        "public.administration", "public.education", "public.post", "public.community_social", "public.inspection_points",
    }


def test_transport_pack_keeps_semantics_separate_and_publishes_comparison_evidence(tmp_path: Path) -> None:
    build_rybnik_transport_cache(root=tmp_path)
    pack = build_rybnik_transport_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_60km" / "transport" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    roads = json.loads((pack_root / artifacts["transport.roads"]["path"]).read_text())
    inspection = json.loads((pack_root / artifacts["transport.inspection_points"]["path"]).read_text())

    assert roads["features"][0]["geometry"]["type"] == "LineString"
    assert inspection["features"][0]["properties"]["origin_artifact"] == "transport.roads"
    assert {artifact["id"] for artifact in read_domain_pack("rybnik_60km", "transport", root=tmp_path, public_export=True)["artifacts"]} == {
        "transport.roads", "transport.railways", "transport.stations", "transport.aviation", "transport.inspection_points",
    }


def test_gas_pack_keeps_semantics_separate_and_publishes_comparison_evidence(tmp_path: Path) -> None:
    build_rybnik_gas_cache(root=tmp_path)
    pack = build_rybnik_gas_domain_pack(root=tmp_path)
    pack_root = tmp_path / "rybnik_60km" / "gas" / "domain-pack-v2"
    artifacts = {artifact["id"]: artifact for artifact in pack["artifacts"]}
    pipelines = json.loads((pack_root / artifacts["gas.pipelines"]["path"]).read_text())
    inspection = json.loads((pack_root / artifacts["gas.inspection_points"]["path"]).read_text())

    assert pipelines["features"][0]["geometry"]["type"] in ("LineString", "MultiLineString")
    assert inspection["features"][0]["properties"]["origin_artifact"] == "gas.pipelines"
    assert {artifact["id"] for artifact in read_domain_pack("rybnik_60km", "gas", root=tmp_path, public_export=True)["artifacts"]} == {
        "gas.facilities", "gas.pipelines", "gas.inspection_points",
    }
