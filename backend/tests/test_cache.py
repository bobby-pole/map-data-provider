import json
from pathlib import Path

import pytest

from geo_pipeline.cache import CACHE_LAYOUT_VERSION, cache_paths, read_cached_layer
from geo_pipeline.contracts import CONTRACT_VERSION, normalize_analytical_vector_layer


def _write_valid_cache(root: Path) -> Path:
    paths = cache_paths("fixture_aoi", "power", root=root)
    paths.root.mkdir(parents=True)
    layer = normalize_analytical_vector_layer(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"element": "way", "id": 1, "power": "line", "voltage": "220000"},
                    "geometry": {"type": "LineString", "coordinates": [[18.5, 50.1], [18.6, 50.2]]},
                }
            ],
        },
        metadata={
            "aoi_id": "fixture_aoi",
            "domain": "power",
            "layer_id": "power.lines",
            "source": "OpenStreetMap",
            "snapshot_at": "2026-07-22T00:00:00Z",
            "readiness": "ready",
            "confidence": "medium",
            "limitations": ["Fixture only."],
            "usable_for_simulation": True,
        },
    )
    metadata = {
        "cache_layout_version": CACHE_LAYOUT_VERSION,
        "geojson_contract_version": CONTRACT_VERSION,
        "aoi_id": "fixture_aoi",
        "domain": "power",
        "layer_id": "power.lines",
        "source": "OpenStreetMap",
        "source_type": "analytical_vector",
        "source_query": "fixture query",
        "snapshot_at": "2026-07-22T00:00:00Z",
        "feature_count": 1,
        "validation_status_raw": "pass",
        "quality_status": "passed",
        "confidence": "medium",
        "limitations": ["Fixture only."],
        "usable_for_simulation": True,
        "readiness": "ready",
    }
    readiness = {
        "cache_layout_version": CACHE_LAYOUT_VERSION,
        "aoi_id": "fixture_aoi",
        "domain": "power",
        "layer_id": "power.lines",
        "readiness": "ready",
        "quality_status": "passed",
        "highest_issue_severity": None,
        "feature_count": 1,
        "evaluated_at": "2026-07-22T00:00:00Z",
    }
    for path, payload in ((paths.layer, layer), (paths.metadata, metadata), (paths.readiness, readiness)):
        path.write_text(json.dumps(payload), encoding="utf-8")
    return paths.root


def test_cache_reader_returns_complete_valid_layout_without_extraction(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_valid_cache(tmp_path)
    paths = cache_paths("fixture_aoi", "power", root=tmp_path)

    import geo_pipeline.extract as extract

    monkeypatch.setattr(extract, "fetch_osm_features", lambda *args, **kwargs: pytest.fail("cache read extracted data"))
    result = read_cached_layer(paths)

    assert result["metadata"]["source_type"] == "analytical_vector"
    assert result["readiness"]["readiness"] == "ready"
    assert result["layer"]["metadata"]["feature_count"] == 1


def test_cache_reader_rejects_incomplete_layout(tmp_path: Path) -> None:
    root = _write_valid_cache(tmp_path)
    (root / "readiness.json").unlink()

    with pytest.raises(FileNotFoundError, match="readiness.json"):
        read_cached_layer(cache_paths("fixture_aoi", "power", root=tmp_path))


def test_cache_reader_rejects_mismatched_provenance_counts(tmp_path: Path) -> None:
    root = _write_valid_cache(tmp_path)
    metadata_path = root / "metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["feature_count"] = 2
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

    with pytest.raises(ValueError, match="feature count"):
        read_cached_layer(cache_paths("fixture_aoi", "power", root=tmp_path))


def test_cache_reader_rejects_mismatched_readiness_records(tmp_path: Path) -> None:
    root = _write_valid_cache(tmp_path)
    readiness_path = root / "readiness.json"
    readiness = json.loads(readiness_path.read_text(encoding="utf-8"))
    readiness["readiness"] = "not_usable"
    readiness_path.write_text(json.dumps(readiness), encoding="utf-8")

    with pytest.raises(ValueError, match="readiness values"):
        read_cached_layer(cache_paths("fixture_aoi", "power", root=tmp_path))


def test_committed_rybnik_power_cache_is_complete_and_source_aware() -> None:
    cache = read_cached_layer(cache_paths("rybnik_60km", "power"))

    assert cache["metadata"]["source"] == "OpenStreetMap"
    assert cache["metadata"]["source_type"] == "analytical_vector"
    assert cache["metadata"]["source_query"]
    assert cache["metadata"]["feature_count"] == 16_505
    assert cache["readiness"]["readiness"] == "usable_with_limitations"
    assert cache["readiness"]["highest_issue_severity"] == "medium"
