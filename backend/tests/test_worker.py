import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest

from geo_pipeline import worker
from geo_pipeline.adapters import resolve_adapter
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.domain_pack import read_domain_pack
from geo_pipeline.worker import EXIT_INVALID_REQUEST, EXIT_WORKER_FAILURE, run_worker


def test_fixture_worker_creates_complete_cache_without_network(tmp_path: Path) -> None:
    result = run_worker(
        aoi="rybnik_35km", domain="power", input_mode="fixture", cache_root=tmp_path
    )

    assert result["status"] == "ok"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "power-osmnx/v1"
    assert result["feature_count"] == 6_796
    assert (
        read_cached_layer(cache_paths("rybnik_35km", "power", root=tmp_path))["readiness"][
            "readiness"
        ]
        == "usable_with_limitations"
    )
    manifest = read_domain_pack("rybnik_35km", "power", root=tmp_path)
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


def test_emergency_fixture_worker_keeps_official_and_community_evidence_separate(
    tmp_path: Path,
) -> None:
    result = run_worker(
        aoi="rybnik_35km", domain="emergency", input_mode="fixture", cache_root=tmp_path
    )
    manifest = read_domain_pack("rybnik_35km", "emergency", root=tmp_path)
    artifacts = {artifact["id"]: artifact for artifact in manifest["artifacts"]}

    assert result["status"] == "ok"
    assert result["aoi_id"] == "rybnik_35km"
    assert result["domain"] == "emergency"
    assert result["input"] == "fixture"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "emergency-osm/v1"
    assert result["feature_count"] > 0
    assert result["readiness"] == "usable_with_limitations"
    assert manifest["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"},
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
    ]
    assert artifacts["emergency.police"]["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"}
    ]
    assert artifacts["emergency.official_police"]["source_provenance"] == [
        {"source_id": "prg_wfs", "contribution_role": "supplementary"}
    ]
    assert artifacts["emergency.official_police"]["public_export"] is False
    assert artifacts["emergency.prg_police_fire_source_evidence"]["public_export"] is False


def test_public_fixture_worker_publishes_independent_semantic_categories(
    tmp_path: Path,
) -> None:
    result = run_worker(
        aoi="rybnik_35km", domain="public", input_mode="fixture", cache_root=tmp_path
    )
    manifest = read_domain_pack("rybnik_35km", "public", root=tmp_path)

    assert result["query_version"] == "public-osm/v1"
    assert result["feature_count"] > 0
    assert [artifact["id"] for artifact in manifest["artifacts"][:4]] == [
        "public.administration",
        "public.education",
        "public.post",
        "public.community_social",
    ]


def test_gas_fixture_worker_publishes_the_versioned_explicit_semantics_profile(
    tmp_path: Path,
) -> None:
    result = run_worker(aoi="rybnik_35km", domain="gas", input_mode="fixture", cache_root=tmp_path)
    manifest = read_domain_pack("rybnik_35km", "gas", root=tmp_path)

    assert result["status"] == "ok"
    assert result["aoi_id"] == "rybnik_35km"
    assert result["domain"] == "gas"
    assert result["input"] == "fixture"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "gas-osm/v2"
    assert result["feature_count"] > 0
    assert result["readiness"] == "usable_with_limitations"
    assert [artifact["id"] for artifact in manifest["artifacts"][:3]] == [
        "gas.facilities",
        "gas.pipelines",
        "gas.inspection_points",
    ]


def test_sewer_fixture_worker_publishes_the_versioned_explicit_semantics_profile(
    tmp_path: Path,
) -> None:
    result = run_worker(
        aoi="rybnik_35km", domain="sewer", input_mode="fixture", cache_root=tmp_path
    )
    manifest = read_domain_pack("rybnik_35km", "sewer", root=tmp_path)

    assert result["status"] == "ok"
    assert result["aoi_id"] == "rybnik_35km"
    assert result["domain"] == "sewer"
    assert result["input"] == "fixture"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "sewer-osm/v2"
    assert result["feature_count"] > 0
    assert result["readiness"] == "usable_with_limitations"
    assert [artifact["id"] for artifact in manifest["artifacts"][:3]] == [
        "sewer.facilities",
        "sewer.pipelines",
        "sewer.inspection_points",
    ]


def test_telecom_fixture_worker_keeps_kiut_reference_only_and_publishes_line_gap(
    tmp_path: Path,
) -> None:
    result = run_worker(
        aoi="rybnik_35km", domain="telecom", input_mode="fixture", cache_root=tmp_path
    )
    manifest = read_domain_pack("rybnik_35km", "telecom", root=tmp_path)

    assert result["status"] == "ok"
    assert result["aoi_id"] == "rybnik_35km"
    assert result["domain"] == "telecom"
    assert result["input"] == "fixture"
    assert result["refreshed"] is True
    assert result["source_registry_id"] == "openstreetmap"
    assert result["query_version"] == "telecom-osm/v1"
    assert result["feature_count"] > 0
    assert result["readiness"] == "usable_with_limitations"
    assert manifest["source_provenance"] == [
        {"source_id": "openstreetmap", "contribution_role": "primary"},
        {"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"},
    ]
    assert [artifact["id"] for artifact in manifest["artifacts"][:4]] == [
        "telecom.towers",
        "telecom.facilities",
        "telecom.lines",
        "telecom.inspection_points",
    ]


def test_worker_rejects_unsupported_target_without_creating_cache(
    tmp_path: Path,
) -> None:
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
        [
            sys.executable,
            "-m",
            "geo_pipeline.worker",
            "--aoi",
            "bad",
            "--domain",
            "power",
            "--cache-root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=Path(__file__).resolve().parents[1],
    )

    assert completed.returncode == EXIT_INVALID_REQUEST
    assert json.loads(completed.stderr)["code"] == "unsupported_target"


def test_partial_adapter_output_does_not_replace_a_valid_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_worker(aoi="rybnik_35km", domain="power", input_mode="fixture", cache_root=tmp_path)
    target = cache_paths("rybnik_35km", "power", root=tmp_path)
    before = target.layer.read_bytes()

    def fail_pack(_: Path) -> dict:
        raise RuntimeError("simulated partial adapter output")

    monkeypatch.setattr(
        worker,
        "resolve_adapter",
        lambda *_: replace(resolve_adapter("rybnik_35km", "power"), build_domain_pack=fail_pack),
    )
    with pytest.raises(Exception) as error:
        worker.run_worker(
            aoi="rybnik_35km", domain="power", input_mode="fixture", cache_root=tmp_path
        )

    assert error.value.exit_code == EXIT_WORKER_FAILURE
    assert error.value.code == "worker_failed"
    assert target.layer.read_bytes() == before
    assert (
        read_domain_pack("rybnik_35km", "power", root=tmp_path)["domain_pack_version"]
        == "provider_domain_pack/v2"
    )


def test_refresh_live_runtime_outcomes_isolates_domain_refresh_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resolved = {
        "aoi": {"aoi_id": "custom_aoi"},
    }
    outcomes = [
        {"domain": "power", "artifact_aoi_id": None},
        {"domain": "water", "artifact_aoi_id": None},
    ]

    def mock_refresh(aoi, domain, root, build_pmtiles=False):
        if domain == "water":
            raise RuntimeError("Overpass network timeout")
        return {
            "status": "ready",
            "artifact_aoi_id": "custom_aoi",
            "cache_status": "fresh",
        }

    monkeypatch.setattr(worker, "refresh_runtime_osm_domain", mock_refresh)
    monkeypatch.setattr(worker, "_finish_runtime_domain", lambda aoi, outcome, *args: outcome)

    progress: list[dict] = []
    res = worker._refresh_live_runtime_outcomes(
        resolved,
        outcomes,
        tmp_path,
        progress=progress.append,
        executor_type=ThreadPoolExecutor,
    )

    assert len(res) == 2
    assert [
        (event["event"], event["completed_domains"], event["total_domains"])
        for event in progress[:2]
    ] == [
        ("domain_started", 0, 2),
        ("domain_started", 0, 2),
    ]
    assert [
        event["completed_domains"] for event in progress if event["event"] == "domain_completed"
    ] == [1, 2]
    assert [event["active_domain"] for event in progress[:2]] == ["power", "water"]
    assert res[0]["domain"] == "power"
    assert res[0]["status"] == "ready"
    assert res[1]["domain"] == "water"
    assert res[1]["status"] == "failed"
    assert res[1]["failure_reason"] == "acquisition_error"
    assert "Live acquisition failed: Overpass network timeout" in res[1]["detail"]


def test_runtime_pmtiles_refresh_serializes_memory_heavy_builders(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resolved = {"aoi": {"aoi_id": "custom_aoi"}}
    outcomes = [
        {"domain": "power", "artifact_aoi_id": None},
        {"domain": "water", "artifact_aoi_id": None},
    ]
    seen_workers: list[int] = []

    class RecordingExecutor(ThreadPoolExecutor):
        def __init__(self, *, max_workers: int, **kwargs: object) -> None:
            seen_workers.append(max_workers)
            super().__init__(max_workers=max_workers, **kwargs)

    monkeypatch.setattr(
        worker,
        "refresh_runtime_osm_domain",
        lambda **_kwargs: {
            "status": "ready",
            "artifact_aoi_id": "custom_aoi",
            "cache_status": "fresh",
        },
    )

    worker._refresh_live_runtime_outcomes(
        resolved, outcomes, tmp_path, executor_type=RecordingExecutor, skip_pmtiles=False
    )
    worker._refresh_live_runtime_outcomes(
        resolved, outcomes, tmp_path, executor_type=RecordingExecutor, skip_pmtiles=True
    )

    assert seen_workers == [2, 1, 2, 1]


def test_partial_runtime_snapshot_retries_only_domains_that_failed(tmp_path, monkeypatch) -> None:
    import geopandas as gpd
    from shapely.geometry import Point

    from geo_pipeline import runtime_osm

    request = {
        "aoi": {"type": "point_radius", "longitude": 19.12, "latitude": 50.81, "radius_m": 1000},
        "profiles": ["emergency", "public"],
    }
    calls = []

    def fetch(geometry, tags):
        is_public = "school" in tags.get("amenity", [])
        calls.append("public" if is_public else "emergency")
        if is_public and calls.count("public") == 1:
            raise RuntimeError("Upstream failed")
        return gpd.GeoDataFrame(
            [
                {"element": "node", "id": 1, "amenity": "police", "geometry": Point(19.12, 50.81)},
                {
                    "element": "node",
                    "id": 2,
                    "amenity": "school",
                    "geometry": Point(19.121, 50.811),
                },
            ],
            crs="EPSG:4326",
        ), "https://fixture.invalid/api/interpreter"

    monkeypatch.setattr(runtime_osm, "fetch_osm_features_geometry_with_endpoint", fetch)
    options = {
        "request": request,
        "input_mode": "live",
        "cache_root": tmp_path / "cache",
        "runtime_root": tmp_path / "state",
        "executor_type": ThreadPoolExecutor,
    }
    first = worker.run_runtime_worker(**options)
    assert (
        next(item for item in first["outcomes"] if item["domain"] == "public")["status"] == "failed"
    )
    second = worker.run_runtime_worker(**options)
    assert all(item["status"] == "ready" for item in second["outcomes"])
    assert calls.count("emergency") == 1
    assert calls.count("public") == 2


def test_runtime_validation_rejects_a_corrupt_pack_without_rebuilding_it(tmp_path: Path) -> None:
    run_worker(aoi="rybnik_35km", domain="power", input_mode="fixture", cache_root=tmp_path)
    manifest_path = tmp_path / "rybnik_35km" / "power" / "domain-pack-v2" / "manifest.json"
    manifest_path.write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError, match="missing required fields"):
        worker._validate_ready_runtime_artifacts(
            [{"status": "ready", "domain": "power", "artifact_aoi_id": "rybnik_35km"}],
            tmp_path,
        )

    assert manifest_path.read_text(encoding="utf-8") == "{}"


def test_domain_timeout_scales_with_disconnected_administrative_aoi_parts() -> None:
    polygon = {
        "type": "Polygon",
        "coordinates": [[[18.0, 50.0], [18.1, 50.0], [18.1, 50.1], [18.0, 50.0]]],
    }
    multi_polygon = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[18.0, 50.0], [18.1, 50.0], [18.1, 50.1], [18.0, 50.0]]],
            [[[18.2, 50.0], [18.3, 50.0], [18.3, 50.1], [18.2, 50.0]]],
            [[[18.4, 50.0], [18.5, 50.0], [18.5, 50.1], [18.4, 50.0]]],
        ],
    }

    assert worker._domain_acquisition_timeout({"geometry": polygon}) == 120
    assert worker._domain_acquisition_timeout({"geometry": multi_polygon}) == 150
