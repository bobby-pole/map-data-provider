import copy
import json
from pathlib import Path

import pytest

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.source_registry import (
    is_public_export_eligible,
    load_source_registry,
    validate_ordered_provenance,
    validate_source_registry,
)


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "source_registry"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def test_source_registry_v2_registers_required_source_families_and_dimensions() -> None:
    registry = load_source_registry()
    sources = {source["id"]: source for source in registry["sources"]}

    assert registry["registry_version"] == "source_registry/v2"
    assert {"openstreetmap", "prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"} <= set(sources)
    assert sources["openstreetmap"]["data_kind"] == "vector"
    assert sources["prg_wfs"]["format"] == "wfs_gml"
    assert sources["bdot10k"]["format"] == "gpkg_geoparquet"
    assert sources["kiut_gesut_wms"]["data_kind"] == "rendered_imagery"
    assert sources["geoportal_orthophoto"]["usage_role"] == "reference"
    assert sources["nmt_nmpt"]["data_kind"] == "raster"
    assert is_public_export_eligible(sources["openstreetmap"])
    assert not is_public_export_eligible(sources["kiut_gesut_wms"])
    assert is_public_export_eligible(sources["prg_wfs"])
    assert is_public_export_eligible(sources["bdot10k"])


def test_source_registry_accepts_v1_fixture_for_migration_only() -> None:
    validate_source_registry(_fixture("registry-v1.json"))


def test_source_registry_rejects_extra_v2_fields_like_the_typescript_schema() -> None:
    registry = copy.deepcopy(_fixture("registry-v2.json"))
    registry["sources"][0]["unexpected"] = True

    with pytest.raises(ValueError, match="missing required fields"):
        validate_source_registry(registry)


@pytest.mark.parametrize(
    ("fixture_name", "message"),
    [
        ("invalid-incomplete-v2.json", "missing required fields"),
        ("invalid-contradictory-v2.json", "cannot use rendered imagery"),
    ],
)
def test_source_registry_rejects_incomplete_or_contradictory_v2_fixtures(fixture_name: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_source_registry(_fixture(fixture_name))


def test_public_export_provenance_rejects_reference_and_duplicate_sources() -> None:
    registry = load_source_registry()
    validate_ordered_provenance([{ "source_id": "openstreetmap", "contribution_role": "primary" }], registry, public_export=True)

    with pytest.raises(ValueError, match="not eligible for public export"):
        validate_ordered_provenance([{ "source_id": "kiut_gesut_wms", "contribution_role": "validation_reference" }], registry, public_export=True)
    validate_ordered_provenance([{ "source_id": "prg_wfs", "contribution_role": "primary" }], registry, public_export=True)
    with pytest.raises(ValueError, match="must be unique"):
        validate_ordered_provenance(
            [
                { "source_id": "openstreetmap", "contribution_role": "primary" },
                { "source_id": "openstreetmap", "contribution_role": "supplementary" },
            ],
            registry,
        )


def test_cache_reader_keeps_v1_power_provenance_readable_through_v2_registry(tmp_path: Path) -> None:
    source_paths = cache_paths("rybnik_60km", "power")
    target_paths = cache_paths("fixture_aoi", "power", root=tmp_path)
    target_paths.root.mkdir(parents=True)
    for source, target in (
        (source_paths.layer, target_paths.layer),
        (source_paths.metadata, target_paths.metadata),
        (source_paths.readiness, target_paths.readiness),
    ):
        target.write_bytes(source.read_bytes())

    metadata = json.loads(target_paths.metadata.read_text(encoding="utf-8"))
    metadata["aoi_id"] = "fixture_aoi"
    target_paths.metadata.write_text(json.dumps(metadata), encoding="utf-8")
    layer = json.loads(target_paths.layer.read_text(encoding="utf-8"))
    layer["metadata"]["aoi_id"] = "fixture_aoi"
    target_paths.layer.write_text(json.dumps(layer), encoding="utf-8")
    readiness = json.loads(target_paths.readiness.read_text(encoding="utf-8"))
    readiness["aoi_id"] = "fixture_aoi"
    target_paths.readiness.write_text(json.dumps(readiness), encoding="utf-8")

    assert read_cached_layer(target_paths)["metadata"]["source_registry_id"] == "openstreetmap"


def test_cache_reader_rejects_missing_legacy_analytical_source_provenance(tmp_path: Path) -> None:
    source_paths = cache_paths("rybnik_60km", "power")
    target_paths = cache_paths("fixture_aoi", "power", root=tmp_path)
    target_paths.root.mkdir(parents=True)
    for source, target in (
        (source_paths.layer, target_paths.layer),
        (source_paths.metadata, target_paths.metadata),
        (source_paths.readiness, target_paths.readiness),
    ):
        target.write_bytes(source.read_bytes())

    metadata = json.loads(target_paths.metadata.read_text(encoding="utf-8"))
    metadata["aoi_id"] = "fixture_aoi"
    metadata.pop("query_version")
    target_paths.metadata.write_text(json.dumps(metadata), encoding="utf-8")
    layer = json.loads(target_paths.layer.read_text(encoding="utf-8"))
    layer["metadata"]["aoi_id"] = "fixture_aoi"
    target_paths.layer.write_text(json.dumps(layer), encoding="utf-8")
    readiness = json.loads(target_paths.readiness.read_text(encoding="utf-8"))
    readiness["aoi_id"] = "fixture_aoi"
    target_paths.readiness.write_text(json.dumps(readiness), encoding="utf-8")

    with pytest.raises(ValueError, match="provenance fields: query_version"):
        read_cached_layer(target_paths)
