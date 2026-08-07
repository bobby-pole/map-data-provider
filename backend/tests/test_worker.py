import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest

import geo_pipeline.worker as worker
from geo_pipeline.adapters import resolve_adapter
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.worker import EXIT_INVALID_REQUEST, EXIT_WORKER_FAILURE, run_worker


def test_fixture_worker_creates_complete_cache_without_network(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="power", input_mode="fixture", cache_root=tmp_path)

    assert result["status"] == "ok"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "power-osmnx/v1"
    assert result["feature_count"] == 16_505
    assert read_cached_layer(cache_paths("rybnik_60km", "power", root=tmp_path))["readiness"]["readiness"] == "usable_with_limitations"
    manifest = read_domain_pack("rybnik_60km", "power", root=tmp_path)
    assert manifest["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"},
        {"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"},
    ]
    assert [artifact["id"] for artifact in manifest["artifacts"]] == [
        "power.lines",
        "power.assets",
        "power.supports",
        "power.representative_points",
        "power.osm_source_evidence",
        "power.osm_relation_evidence",
        "power.kiut_reference",
    ]


def test_emergency_fixture_worker_keeps_official_and_community_evidence_separate(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="emergency", input_mode="fixture", cache_root=tmp_path)
    manifest = read_domain_pack("rybnik_60km", "emergency", root=tmp_path)
    artifacts = {artifact["id"]: artifact for artifact in manifest["artifacts"]}

    assert result == {
        "status": "ok", "aoi_id": "rybnik_60km", "domain": "emergency", "input": "fixture", "refreshed": True,
        "source_registry_id": "openstreetmap", "query_version": "emergency-osm/v1", "feature_count": 4,
        "readiness": "usable_with_limitations",
    }
    assert manifest["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"},
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
    ]
    assert artifacts["emergency.police"]["source_provenance"] == [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    assert artifacts["emergency.official_police"]["source_provenance"] == [{"source_id": "prg_wfs", "contribution_role": "supplementary"}]
    assert artifacts["emergency.prg_police_fire_source_evidence"]["public_export"] is False


def test_public_fixture_worker_publishes_independent_semantic_categories(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="public", input_mode="fixture", cache_root=tmp_path)
    manifest = read_domain_pack("rybnik_60km", "public", root=tmp_path)

    assert result["query_version"] == "public-osm/v1"
    assert result["feature_count"] == 4
    assert [artifact["id"] for artifact in manifest["artifacts"][:4]] == [
        "public.administration", "public.education", "public.post", "public.community_social",
    ]


def test_gas_fixture_worker_publishes_the_versioned_explicit_semantics_profile(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="gas", input_mode="fixture", cache_root=tmp_path)
    manifest = read_domain_pack("rybnik_60km", "gas", root=tmp_path)

    assert result == {
        "status": "ok", "aoi_id": "rybnik_60km", "domain": "gas", "input": "fixture", "refreshed": True,
        "source_registry_id": "openstreetmap", "query_version": "gas-osm/v2", "feature_count": 2,
        "readiness": "usable_with_limitations",
    }
    assert [artifact["id"] for artifact in manifest["artifacts"][:3]] == [
        "gas.facilities", "gas.pipelines", "gas.inspection_points",
    ]


def test_sewer_fixture_worker_publishes_the_versioned_explicit_semantics_profile(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="sewer", input_mode="fixture", cache_root=tmp_path)
    manifest = read_domain_pack("rybnik_60km", "sewer", root=tmp_path)

    assert result == {
        "status": "ok", "aoi_id": "rybnik_60km", "domain": "sewer", "input": "fixture", "refreshed": True,
        "source_registry_id": "openstreetmap", "query_version": "sewer-osm/v2", "feature_count": 2,
        "readiness": "usable_with_limitations",
    }
    assert [artifact["id"] for artifact in manifest["artifacts"][:3]] == [
        "sewer.facilities", "sewer.pipelines", "sewer.inspection_points",
    ]


def test_worker_rejects_unsupported_target_without_creating_cache(tmp_path: Path) -> None:
    try:
        run_worker(aoi="unknown", domain="power", input_mode="fixture", cache_root=tmp_path)
    except Exception as error:
        assert error.exit_code == EXIT_INVALID_REQUEST
        assert error.code == "unsupported_target"
    else:
        raise AssertionError("Expected worker failure")
    assert not any(tmp_path.iterdir())


def test_worker_cli_returns_machine_readable_error(tmp_path: Path) -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "geo_pipeline.worker", "--aoi", "bad", "--domain", "power", "--cache-root", str(tmp_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == EXIT_INVALID_REQUEST
    assert json.loads(completed.stderr)["code"] == "unsupported_target"


def test_partial_adapter_output_does_not_replace_a_valid_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    run_worker(aoi="rybnik_60km", domain="power", input_mode="fixture", cache_root=tmp_path)
    target = cache_paths("rybnik_60km", "power", root=tmp_path)
    before = target.layer.read_bytes()

    def fail_pack(_: Path) -> dict:
        raise RuntimeError("simulated partial adapter output")

    monkeypatch.setattr(
        worker,
        "resolve_adapter",
        lambda *_: replace(resolve_adapter("rybnik_60km", "power"), build_domain_pack=fail_pack),
    )
    with pytest.raises(Exception) as error:
        worker.run_worker(aoi="rybnik_60km", domain="power", input_mode="fixture", cache_root=tmp_path)

    assert error.value.exit_code == EXIT_WORKER_FAILURE
    assert error.value.code == "worker_failed"
    assert target.layer.read_bytes() == before
    assert read_domain_pack("rybnik_60km", "power", root=tmp_path)["domain_pack_version"] == "provider_domain_pack/v2"
