import json
import subprocess
import sys
from pathlib import Path

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.worker import EXIT_INVALID_REQUEST, run_worker


def test_fixture_worker_creates_complete_cache_without_network(tmp_path: Path) -> None:
    result = run_worker(aoi="rybnik_60km", domain="power", input_mode="fixture", cache_root=tmp_path)

    assert result["status"] == "ok"
    assert result["refreshed"] is True
    assert result["feature_count"] == 16_505
    assert read_cached_layer(cache_paths("rybnik_60km", "power", root=tmp_path))["readiness"]["readiness"] == "usable_with_limitations"


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
