import hashlib
import json
from pathlib import Path

import mapbox_vector_tile
import pytest
from pmtiles.reader import MemorySource, Reader
from pmtiles.tile import TileType

from geo_pipeline.vector_tiles import build_map_presentation, read_map_presentation


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _layer(layer_id: str, feature: dict) -> dict:
    return {
        "type": "FeatureCollection",
        "metadata": {
            "aoi_id": "fixture_aoi", "domain": "power", "layer_id": layer_id,
            "source": "OpenStreetMap", "confidence": "medium", "readiness": "usable_with_limitations",
            "limitations": ["Fixture-only MVT evidence."], "feature_count": 1,
        },
        "features": [feature],
    }


def _fixture_pack(tmp_path: Path) -> tuple[Path, dict]:
    pack_root = tmp_path / "fixture_aoi" / "power" / "domain-pack-v2"
    layers_root = pack_root / "layers"
    layers_root.mkdir(parents=True)
    lines = _layer("power.lines", {
        "type": "Feature", "properties": {"source": "OpenStreetMap", "source_id": "way/1", "domain": "power", "asset_type": "line", "confidence": "medium", "limitations": ["Fixture-only MVT evidence."]},
        "geometry": {"type": "LineString", "coordinates": [[18.45, 50.1], [18.55, 50.2]]},
    })
    assets = _layer("power.assets", {
        "type": "Feature", "properties": {"source": "OpenStreetMap", "source_id": "node/1", "domain": "power", "asset_type": "substation", "confidence": "medium", "limitations": ["Fixture-only MVT evidence."]},
        "geometry": {"type": "Point", "coordinates": [18.5, 50.15]},
    })
    manifest = {
        "domain_pack_version": "provider_domain_pack/v2", "aoi_id": "fixture_aoi", "domain": "power",
        "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}],
        "artifacts": [], "validation": {"path": "validation/metadata.json"}, "readiness": {"path": "readiness/readiness.json"},
    }
    for identifier, payload in (("power.lines", lines), ("power.assets", assets)):
        encoded = json.dumps(payload, sort_keys=True).encode()
        relative_path = f"layers/{identifier}.geojson"
        (pack_root / relative_path).write_bytes(encoded)
        manifest["artifacts"].append({
            "id": identifier, "kind": "processed_vector", "format": "geojson", "path": relative_path,
            "sha256": _digest(encoded), "feature_count": 1,
            "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}], "public_export": True,
        })
    manifest["artifacts"].append({
        "id": "power.kiut_reference", "kind": "remote_service", "format": "wms",
        "source_provenance": [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}], "public_export": False,
    })
    return pack_root, manifest


def test_public_layers_build_deterministic_mvt_pmtiles_with_compact_properties(tmp_path: Path) -> None:
    pack_root, manifest = _fixture_pack(tmp_path)
    first = build_map_presentation(pack_root=pack_root, manifest=manifest)
    archive_path = pack_root / "presentation" / "power.pmtiles"
    first_bytes = archive_path.read_bytes()
    second = build_map_presentation(pack_root=pack_root, manifest=manifest)

    assert first["archive"]["sha256"] == second["archive"]["sha256"] == _digest(first_bytes)
    assert {layer["artifact_id"] for layer in first["layers"]} == {"power.lines", "power.assets"}
    assert "power.kiut_reference" not in json.dumps(first)
    reader = Reader(MemorySource(first_bytes))
    assert reader.header()["tile_type"] is TileType.MVT
    assert reader.header()["clustered"] is True
    assert reader.metadata()["vector_layers"][0]["id"] in {"power_lines", "power_assets"}
    tile = reader.get(7, 70, 43)
    assert tile is not None
    decoded = mapbox_vector_tile.decode(tile)
    properties = next(iter(decoded.values()))["features"][0]["properties"]
    assert properties["source_id"] in {"way/1", "node/1"}
    assert "osm_tags" not in properties
    assert read_map_presentation(pack_root=pack_root, manifest=manifest)["archive"]["size_bytes"] == len(first_bytes)


def test_presentation_rejects_reference_only_or_stale_inputs(tmp_path: Path) -> None:
    pack_root, manifest = _fixture_pack(tmp_path)
    manifest["artifacts"][0]["source_provenance"] = [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}]
    with pytest.raises(ValueError, match="rejected for public_export"):
        build_map_presentation(pack_root=pack_root, manifest=manifest)

    pack_root, manifest = _fixture_pack(tmp_path / "stale")
    build_map_presentation(pack_root=pack_root, manifest=manifest)
    manifest["artifacts"][0]["feature_count"] = 2
    with pytest.raises(ValueError, match="stale"):
        read_map_presentation(pack_root=pack_root, manifest=manifest)
