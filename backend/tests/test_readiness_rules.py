from __future__ import annotations

import pytest

from geo_pipeline.quality_rules import (
    evaluate_data_quality_rules,
    highest_issue_severity,
    triggered_issues,
)
from geo_pipeline.readiness import (
    derive_readiness,
    normalize_validation_status,
)


@pytest.mark.parametrize(
    ("raw_status", "normalized_status"),
    [
        ("pass", "passed"),
        ("ok", "passed"),
        ("success", "passed"),
        ("valid", "passed"),
        ("warning", "warning"),
        ("invalid", "failed"),
        (None, "unknown"),
    ],
)
def test_validation_statuses_are_normalized(
    raw_status: object | None, normalized_status: str
) -> None:
    assert normalize_validation_status(raw_status) == normalized_status


@pytest.mark.parametrize(
    ("quality_status", "feature_count", "source_type", "expected"),
    [
        ("failed", 1, "analytical_vector", "not_usable"),
        ("passed", 0, "analytical_vector", "not_usable"),
        ("warning", 1, "analytical_vector", "usable_with_limitations"),
        ("passed", 1, "manual_seed", "usable_with_limitations"),
        ("passed", 0, "reference_overlay", "needs_source"),
        ("unknown", 1, "analytical_vector", "needs_source"),
    ],
)
def test_readiness_is_derived_conservatively(
    quality_status: str, feature_count: int, source_type: str, expected: str
) -> None:
    assert (
        derive_readiness(
            quality_status=quality_status,
            feature_count=feature_count,
            source_type=source_type,
        )
        == expected
    )


def test_readiness_consumes_structured_issue_severity() -> None:
    assert (
        derive_readiness(
            quality_status="passed",
            feature_count=1,
            source_type="analytical_vector",
            issue_severity="medium",
        )
        == "usable_with_limitations"
    )
    assert (
        derive_readiness(
            quality_status="passed",
            feature_count=1,
            source_type="analytical_vector",
            issue_severity="high",
        )
        == "not_usable"
    )


def test_rules_generate_structured_issues() -> None:
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
    assert highest_issue_severity(issues) in {None, "low", "medium", "high"}

    outcomes = evaluate_data_quality_rules(sample_layer)
    assert all(r.outcome in {"passed", "triggered", "not_applicable"} for r in outcomes)
