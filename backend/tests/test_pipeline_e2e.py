from pathlib import Path

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.contracts import validate_provider_geojson
from geo_pipeline.source_registry import load_source_registry
from geo_pipeline.worker import run_worker


def test_offline_fixture_pipeline_produces_a_complete_provider_contract(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_35km", domain="power", input_mode="fixture", cache_root=tmp_path)
    cache = read_cached_layer(cache_paths("rybnik_35km", "power", root=tmp_path))
    sources = load_source_registry()["sources"]

    assert result["status"] == "ok"
    assert validate_provider_geojson(cache["layer"]) == []
    assert cache["metadata"]["feature_count"] == cache["readiness"]["feature_count"]
    assert cache["metadata"]["source_type"] == "analytical_vector"
    assert any(source["usage_role"] == "review" and source["data_kind"] == "vector" for source in sources)
    assert any(source["usage_role"] == "reference" and source["format"] == "wms" for source in sources)
