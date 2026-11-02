"""Bounded offline source responses exercise real new-AOI packs and PMTiles."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor

import geopandas as gpd
import pytest
from shapely.geometry import Point

from geo_pipeline import runtime_osm, worker
from geo_pipeline.domain_pack import domain_pack_root, read_domain_pack
from geo_pipeline.vector_tiles import read_map_presentation


def _request(profiles=None):
    return {
        "aoi": {"type": "administrative_selection", "unit_ids": ["county_2464"]},
        "profiles": profiles or ["emergency", "public"],
    }


def _source():
    return gpd.GeoDataFrame(
        [
            {"id": 1, "element": "node", "amenity": "police", "geometry": Point(19.12, 50.81)},
            {"id": 2, "element": "node", "amenity": "school", "geometry": Point(19.121, 50.811)},
        ],
        crs="EPSG:4326",
    )


def test_new_aoi_pipelines_real_packs_publishes_partial_and_hits_cache(tmp_path, monkeypatch):
    barrier = threading.Barrier(2)
    calls = []
    lock = threading.Lock()

    def fetch(geometry, tags):
        with lock:
            calls.append(tags)
        barrier.wait(timeout=10)
        return _source(), "https://fixture.invalid/api/interpreter"

    monkeypatch.setattr(runtime_osm, "fetch_osm_features_geometry_with_endpoint", fetch)
    builders = 0
    peak_builders = 0
    real_build = worker.build_map_presentation

    def build(**kwargs):
        nonlocal builders, peak_builders
        with lock:
            builders += 1
            peak_builders = max(peak_builders, builders)
        try:
            return real_build(**kwargs)
        finally:
            with lock:
                builders -= 1

    monkeypatch.setattr(worker, "build_map_presentation", build)
    events = []
    cache = tmp_path / "cache"

    def progress(event):
        events.append(event)
        if "partial_result" in event:
            result = event["partial_result"]
            root = cache / result["aoi"]["aoi_id"]
            manifest = json.loads((root / "snapshot_manifest.json").read_text())
            evidence = json.loads((root / "acquisition_evidence.json").read_text())
            if event["completed_domains"] == 1:
                assert manifest["state"] == "partial"
                assert any(item["status"] == "pending_qualification" for item in result["outcomes"])
            for outcome in result["outcomes"]:
                if outcome["status"] == "ready":
                    pack = read_domain_pack(
                        outcome["artifact_aoi_id"], outcome["domain"], root=cache
                    )
                    read_map_presentation(
                        pack_root=domain_pack_root(
                            outcome["artifact_aoi_id"], outcome["domain"], root=cache
                        ),
                        manifest=pack,
                    )
            assert any(item.get("stage_durations_ms") for item in evidence["domains"])

    first = worker.run_runtime_worker(
        request=_request(),
        input_mode="live",
        cache_root=cache,
        runtime_root=tmp_path / "state",
        progress=progress,
        executor_type=ThreadPoolExecutor,
    )
    assert len(calls) == 2
    assert peak_builders == 1, [item["detail"] for item in first["outcomes"]]
    assert all(item["status"] == "ready" for item in first["outcomes"])
    assert first["pipeline_version"].endswith("v19")
    assert [event["completed_domains"] for event in events if "partial_result" in event] == [1, 2]
    for outcome in first["outcomes"]:
        assert set(outcome["stage_durations_ms"]) == {
            "acquisition",
            "processing",
            "pack_publication",
            "pmtiles",
        }
    second = worker.run_runtime_worker(
        request=_request(["public", "emergency"]),
        input_mode="live",
        cache_root=cache,
        runtime_root=tmp_path / "state",
        executor_type=ThreadPoolExecutor,
    )
    assert second["request_result"] == "cache"
    assert len(calls) == 2
    assert not list(cache.glob(".runtime-stage-*"))


def test_interrupted_job_resumes_completed_domain_even_with_changed_profiles(tmp_path, monkeypatch):
    calls = []

    def fetch(geometry, tags):
        calls.append(tags)
        return _source(), "https://fixture.invalid/api/interpreter"

    monkeypatch.setattr(runtime_osm, "fetch_osm_features_geometry_with_endpoint", fetch)
    cache = tmp_path / "cache"
    state = tmp_path / "state"

    class Interrupted(BaseException):
        pass

    def interrupt(event):
        if event.get("partial_result"):
            raise Interrupted()

    with pytest.raises(Interrupted):
        worker.run_runtime_worker(
            request=_request(["emergency"]),
            input_mode="live",
            cache_root=cache,
            runtime_root=state,
            progress=interrupt,
            executor_type=ThreadPoolExecutor,
        )
    assert len(calls) == 1
    resumed = worker.run_runtime_worker(
        request=_request(),
        input_mode="live",
        cache_root=cache,
        runtime_root=state,
        executor_type=ThreadPoolExecutor,
    )
    assert len(calls) == 2
    assert all(item["status"] == "ready" for item in resumed["outcomes"])
    aoi_id = resumed["aoi"]["aoi_id"]
    presentation = domain_pack_root(aoi_id, "public", root=cache) / "presentation" / "manifest.json"
    presentation.unlink()
    repaired = worker.run_runtime_worker(
        request=_request(),
        input_mode="live",
        cache_root=cache,
        runtime_root=state,
        executor_type=ThreadPoolExecutor,
    )
    assert len(calls) == 3
    assert all(item["status"] == "ready" for item in repaired["outcomes"])


def _fixture_endpoint(endpoint):
    from geo_pipeline import extract

    extract.OVERPASS_ENDPOINTS[:] = [endpoint]


def test_real_process_pools_use_fixture_http_and_reuse_new_aoi(tmp_path):
    from concurrent.futures import ProcessPoolExecutor
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    count = 0
    barrier = threading.Barrier(2)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            nonlocal count
            self.rfile.read(int(self.headers["Content-Length"]))
            count += 1
            barrier.wait(timeout=20)
            body = json.dumps(
                {
                    "elements": [
                        {
                            "type": "node",
                            "id": 1,
                            "lat": 50.81,
                            "lon": 19.12,
                            "tags": {"amenity": "police"},
                        },
                        {
                            "type": "node",
                            "id": 2,
                            "lat": 50.811,
                            "lon": 19.121,
                            "tags": {"amenity": "school"},
                        },
                    ]
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}/api/interpreter"

    class FixtureExecutor(ProcessPoolExecutor):
        def __init__(self, *, max_workers):
            super().__init__(
                max_workers=max_workers, initializer=_fixture_endpoint, initargs=(endpoint,)
            )

    try:
        options = {
            "request": _request(),
            "input_mode": "live",
            "cache_root": tmp_path / "cache",
            "runtime_root": tmp_path / "state",
            "executor_type": FixtureExecutor,
        }
        first = worker.run_runtime_worker(**options)
        assert all(item["status"] == "ready" for item in first["outcomes"]), [
            item["detail"] for item in first["outcomes"]
        ]
        assert count == 2
        second = worker.run_runtime_worker(**options)
        assert second["request_result"] == "cache"
        assert count == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_failed_builder_keeps_existing_published_pack(tmp_path, monkeypatch):
    monkeypatch.setattr(
        runtime_osm,
        "fetch_osm_features_geometry_with_endpoint",
        lambda *_: (_source(), "https://fixture.invalid/api/interpreter"),
    )
    options = {
        "request": _request(["emergency"]),
        "input_mode": "live",
        "cache_root": tmp_path / "cache",
        "runtime_root": tmp_path / "state",
        "executor_type": ThreadPoolExecutor,
    }
    first = worker.run_runtime_worker(**options)
    root = domain_pack_root(first["aoi"]["aoi_id"], "emergency", root=options["cache_root"])
    before = {
        str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()
    }
    checkpoint = next(
        (options["runtime_root"] / "provider-runtime-v1" / "domains").rglob("emergency.json")
    )
    saved = json.loads(checkpoint.read_text())
    saved["cached_at"] = "2000-01-01T00:00:00Z"
    checkpoint.write_text(json.dumps(saved))

    def fail_build(**kwargs):
        raise RuntimeError("PMTiles fixture failure")

    monkeypatch.setattr(worker, "build_map_presentation", fail_build)
    second = worker.run_runtime_worker(**options)
    assert second["outcomes"][0]["status"] == "failed"
    assert "PMTiles fixture failure" in second["outcomes"][0]["detail"]
    assert {
        str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()
    } == before
    assert not list(options["cache_root"].glob(".runtime-stage-*"))


def test_reusing_domain_preserves_checkpoint_age(tmp_path, monkeypatch):
    monkeypatch.setattr(
        runtime_osm,
        "fetch_osm_features_geometry_with_endpoint",
        lambda *_: (_source(), "https://fixture.invalid/api/interpreter"),
    )
    options = {
        "input_mode": "live",
        "cache_root": tmp_path / "cache",
        "runtime_root": tmp_path / "state",
        "executor_type": ThreadPoolExecutor,
    }
    worker.run_runtime_worker(request=_request(), **options)
    checkpoint = next(
        (options["runtime_root"] / "provider-runtime-v1" / "domains").rglob("emergency.json")
    )
    before = checkpoint.read_bytes()
    worker.run_runtime_worker(request=_request(["emergency"]), **options)
    assert checkpoint.read_bytes() == before


def test_staging_and_publication_stay_on_the_same_prepared_bind_mount(tmp_path, monkeypatch):
    import errno

    monkeypatch.setattr(
        runtime_osm,
        "fetch_osm_features_geometry_with_endpoint",
        lambda *_: (_source(), "https://fixture.invalid/api/interpreter"),
    )
    cache = tmp_path / "mounted-prepared"
    real_replace = worker._replace_cache
    promoted = []

    def replace(target, staged):
        # Simulate the production bind-mount boundary: cross-volume promotion is invalid.
        if not staged.is_relative_to(cache) or not target.is_relative_to(cache):
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        promoted.append(target)
        return real_replace(target, staged)

    monkeypatch.setattr(worker, "_replace_cache", replace)
    result = worker.run_runtime_worker(
        request=_request(["emergency"]),
        input_mode="live",
        cache_root=cache,
        runtime_root=tmp_path / "runtime",
        executor_type=ThreadPoolExecutor,
    )
    assert result["outcomes"][0]["status"] == "ready", result["outcomes"][0]["detail"]
    assert len(promoted) == 1
    assert not list(cache.glob(".runtime-stage-*"))
