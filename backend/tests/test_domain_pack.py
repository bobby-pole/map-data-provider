import json
import shutil
from pathlib import Path

import pytest

from geo_pipeline.cache import cache_paths
from geo_pipeline.domain_pack import build_rybnik_power_domain_pack, read_domain_pack, validate_domain_pack


def _legacy_power(root: Path) -> None:
    source = cache_paths("rybnik_60km", "power")
    target = cache_paths("rybnik_60km", "power", root=root)
    target.root.mkdir(parents=True)
    for old, new in ((source.layer, target.layer), (source.metadata, target.metadata), (source.readiness, target.readiness)):
        shutil.copyfile(old, new)


def test_power_domain_pack_v2_preserves_v1_cache_compatibility(tmp_path: Path) -> None:
    _legacy_power(tmp_path)
    pack = build_rybnik_power_domain_pack(root=tmp_path)

    assert pack["domain_pack_version"] == "provider_domain_pack/v2"
    assert pack["artifacts"][0]["id"] == "power.lines"
    assert read_domain_pack("rybnik_60km", "power", root=tmp_path, public_export=True)["artifacts"] == [pack["artifacts"][0]]


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
