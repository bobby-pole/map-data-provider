from datetime import datetime, timezone
from pathlib import Path

from geo_pipeline.source_availability import build_runtime_source_availability, load_report, optional_live_probe


def test_report_distinguishes_available_uncovered_reference_and_not_eligible() -> None:
    report = load_report(Path(__file__).resolve().parents[1] / "data/fixtures/source_availability/rybnik_35km.json", now=datetime(2026, 8, 2, tzinfo=timezone.utc))
    sources = {entry["source_id"]: entry for entry in report["sources"]}
    assert sources["openstreetmap"]["feature_state"] == "available"
    assert sources["prg_wfs"]["availability"] == "available" and sources["prg_wfs"]["feature_state"] == "available"
    assert sources["bdot10k"]["aoi_coverage"] == "uncovered" and sources["bdot10k"]["freshness"] == "stale"
    assert sources["kiut_gesut_wms"]["availability"] == "reference_only" and not sources["kiut_gesut_wms"]["actionable_gap"]
    assert sources["manual_power_seed"]["availability"] == "not_eligible"


def test_build_runtime_source_availability_creates_valid_report(tmp_path: Path) -> None:
    out_file = tmp_path / "custom_aoi.json"
    now = datetime(2026, 8, 21, 10, 0, tzinfo=timezone.utc)
    report = build_runtime_source_availability("custom_aoi_123", now=now, out_path=out_file)
    assert report["aoi_id"] == "custom_aoi_123"
    assert report["report_version"] == "provider_source_availability/v1"
    assert out_file.exists()
    sources = {entry["source_id"]: entry for entry in report["sources"]}
    assert sources["openstreetmap"]["availability"] == "available"
    assert sources["openstreetmap"]["freshness"] == "fresh"
    assert sources["bdot10k"]["actionable_gap"] is True
    assert sources["kiut_gesut_wms"]["availability"] == "reference_only"


def test_optional_probe_fails_safely() -> None:
    assert optional_live_probe("prg_wfs", lambda: (_ for _ in ()).throw(RuntimeError("offline")))["status"] == "unavailable"

