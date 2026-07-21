import copy
import json

import pytest

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.source_registry import load_source_registry, validate_source_registry


def test_source_registry_contains_the_three_provider_source_classes() -> None:
    registry = load_source_registry()
    sources = {source["id"]: source for source in registry["sources"]}

    assert set(sources) == {"openstreetmap", "manual_power_seed", "kiut_gesut_wms"}
    assert sources["openstreetmap"]["source_type"] == "analytical_vector"
    assert sources["manual_power_seed"]["source_type"] == "manual_seed"
    assert sources["kiut_gesut_wms"]["source_type"] == "reference_overlay"
    assert sources["kiut_gesut_wms"]["service_type"] == "OGC WMS"
    assert sources["kiut_gesut_wms"]["usable_for_simulation"] is False


def test_source_registry_rejects_kiut_gesut_as_an_analytical_vector() -> None:
    registry = copy.deepcopy(load_source_registry())
    overlay = next(source for source in registry["sources"] if source["id"] == "kiut_gesut_wms")
    overlay["source_type"] = "analytical_vector"
    overlay["usable_for_simulation"] = True
    overlay["analytical_cache_provenance"] = {"required_fields": ["source_registry_id"]}

    with pytest.raises(ValueError, match="KIUT/GESUT WMS"):
        validate_source_registry(registry)


def test_cache_reader_rejects_missing_analytical_source_provenance(tmp_path) -> None:
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
