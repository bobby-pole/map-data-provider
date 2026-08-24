from __future__ import annotations

import json
import os
from pathlib import Path


def test_provider_issue_snapshot_schema_and_contract() -> None:
    """Verifies that the committed issue snapshot has valid structure and schema."""
    snapshot_path = Path(__file__).resolve().parents[1] / "data" / "issues" / "rybnik_35km.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if os.environ.get("MDQ_CONTRACT_FAILURE_PROBE") == "1":
        snapshot["issue_snapshot_version"] = "invalid-contract-probe"

    assert snapshot["issue_snapshot_version"] == "provider_issues/v1"
    assert snapshot["aoi_id"] == "rybnik_35km"
    assert isinstance(snapshot["issues"], list)
    assert len(snapshot["issues"]) > 0

    required_fields = {
        "id",
        "rule_id",
        "rule_version",
        "severity",
        "source_type",
        "domain",
        "layer_id",
        "affected_object",
        "evidence",
        "recommendation",
    }
    for issue in snapshot["issues"]:
        assert required_fields <= set(issue)
        assert issue["severity"] in {"low", "medium", "high"}
        assert issue["source_type"] in {"analytical_vector", "manual_seed", "reference_overlay"}
