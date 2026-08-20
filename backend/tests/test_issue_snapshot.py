from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


def test_provider_issue_snapshot_matches_generated_rule_evidence() -> None:
    """Node serves a cached snapshot, but it must not silently drift from Python rules."""
    snapshot_path = Path(__file__).resolve().parents[1] / "data" / "issues" / "rybnik_35km.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if os.environ.get("MDQ_CONTRACT_FAILURE_PROBE") == "1":
        snapshot["issue_snapshot_version"] = "invalid-contract-probe"
    generated = TestClient(app).get("/api/data-quality/issues")

    assert generated.status_code == 200
    assert snapshot["issue_snapshot_version"] == "provider_issues/v1"
    assert snapshot["aoi_id"] == "rybnik_35km"
    assert snapshot["issues"] == [
        {key: value for key, value in issue.items() if key != "status"}
        for issue in generated.json()
    ]
