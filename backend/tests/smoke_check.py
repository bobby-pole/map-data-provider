from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from geo_pipeline.quality_rules import triggered_issues
from geo_pipeline.readiness import derive_readiness, normalize_validation_status
from geo_pipeline.source_registry import load_source_registry

# 1. Verify source registry loads
registry = load_source_registry()
sources = (
    registry.get("sources") if isinstance(registry, dict) else getattr(registry, "sources", [])
)
assert sources, "Source registry should have registered sources"

# 2. Verify readiness and normalization
assert normalize_validation_status("pass") == "passed"
assert normalize_validation_status("invalid") == "failed"
assert (
    derive_readiness(quality_status="passed", feature_count=10, source_type="analytical_vector")
    == "ready"
)

# 3. Verify quality rules evaluation
sample_layer = {
    "id": "power.lines",
    "domain": "power",
    "source_type": "analytical_vector",
    "quality_status": "passed",
    "feature_count": 100,
    "confidence": "medium",
    "limitations": ["OSM completeness varies."],
    "not_authoritative": False,
    "eligible_for_analysis": True,
}
issues = triggered_issues(sample_layer)
assert isinstance(issues, list)

# 4. Verify baseline issue snapshot file
snapshot_file = BACKEND_DIR / "data" / "issues" / "rybnik_35km.json"
assert snapshot_file.exists(), f"Issue snapshot {snapshot_file} must exist"
snapshot_data = json.loads(snapshot_file.read_text(encoding="utf-8"))
assert snapshot_data["issue_snapshot_version"] == "provider_issues/v1"
assert len(snapshot_data["issues"]) > 0

# 5. Verify source availability report
avail_file = BACKEND_DIR / "data" / "source-availability" / "rybnik_35km.json"
if avail_file.exists():
    avail_data = json.loads(avail_file.read_text(encoding="utf-8"))
    assert avail_data["report_version"] == "provider_source_availability/v1"
    assert len(avail_data["sources"]) > 0

print("Geospatial pipeline smoke check passed successfully.")
print(f"sources={len(sources)} snapshot_issues={len(snapshot_data['issues'])}")
