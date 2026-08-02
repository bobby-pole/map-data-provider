from datetime import datetime, timezone
from pathlib import Path

from geo_pipeline.source_availability import load_report, optional_live_probe


def test_report_distinguishes_empty_unavailable_uncovered_reference_and_not_eligible() -> None:
    report = load_report(Path(__file__).resolve().parents[1] / "data/fixtures/source_availability/rybnik_60km.json", now=datetime(2026, 8, 2, tzinfo=timezone.utc))
    sources = {entry["source_id"]: entry for entry in report["sources"]}
    assert sources["openstreetmap"]["feature_state"] == "empty"
    assert sources["prg_wfs"]["availability"] == "unavailable"
    assert sources["bdot10k"]["aoi_coverage"] == "uncovered" and sources["bdot10k"]["freshness"] == "stale"
    assert sources["kiut_gesut_wms"]["availability"] == "reference_only" and not sources["kiut_gesut_wms"]["actionable_gap"]
    assert sources["manual_power_seed"]["availability"] == "not_eligible"


def test_optional_probe_fails_safely() -> None:
    assert optional_live_probe("prg_wfs", lambda: (_ for _ in ()).throw(RuntimeError("offline")))["status"] == "unavailable"
