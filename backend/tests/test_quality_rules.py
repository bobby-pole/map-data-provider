from geo_pipeline.quality_rules import (
    evaluate_data_quality_rules,
    highest_issue_severity,
    triggered_issues,
)


def _layer(source_type: str = "analytical_vector", **overrides: object) -> dict[str, object]:
    layer: dict[str, object] = {
        "id": "power.lines",
        "label": "Power lines",
        "domain": "power",
        "source": "OpenStreetMap",
        "source_type": source_type,
        "confidence": "medium",
        "limitations": ["OSM completeness varies by area and asset type."],
        "not_authoritative": False,
        "feature_count": 1,
        "quality_status": "passed",
        "validation_status_raw": "pass",
        "invalid_geometry_count": 0,
        "missing_required_attributes": [],
        "duplicate_count": 0,
        "unsupported_geometry_types": [],
    }
    layer.update(overrides)
    return layer


def test_analytical_vector_rules_can_pass_without_issues() -> None:
    outcomes = {result.rule_id: result.outcome for result in evaluate_data_quality_rules(_layer())}

    assert outcomes["layer.empty"] == "passed"
    assert outcomes["geometry.invalid"] == "passed"
    assert outcomes["attributes.missing_required"] == "passed"
    assert outcomes["features.duplicates"] == "passed"
    assert outcomes["manual.non_authoritative"] == "not_applicable"
    assert outcomes["reference.overlay"] == "not_applicable"
    assert triggered_issues(_layer()) == []


def test_analytical_vector_rules_report_structured_triggered_evidence() -> None:
    layer = _layer(
        quality_status="warning",
        validation_status_raw="warn",
        invalid_geometry_count=2,
        missing_required_attributes=["voltage"],
        duplicate_count=1,
        unsupported_geometry_types=["GeometryCollection"],
    )
    issues = {issue["rule_id"]: issue for issue in triggered_issues(layer)}

    assert set(issues) == {
        "geometry.invalid",
        "attributes.missing_required",
        "features.duplicates",
        "geometry.unsupported",
        "validation.status",
    }
    invalid = issues["geometry.invalid"]
    assert invalid["rule_version"] == "1.0"
    assert invalid["severity"] == "high"
    assert invalid["source_type"] == "analytical_vector"
    assert invalid["affected_object"] == {"type": "layer", "id": "power.lines"}
    assert highest_issue_severity(list(issues.values())) == "high"


def test_manual_seed_skips_analytical_rules_but_remains_explicit() -> None:
    layer = _layer(
        source_type="manual_seed",
        source="manual_seed",
        confidence="low",
        not_authoritative=True,
        missing_required_attributes=["voltage"],
        duplicate_count=2,
    )
    outcomes = {result.rule_id: result.outcome for result in evaluate_data_quality_rules(layer)}
    issues = triggered_issues(layer)

    assert outcomes["attributes.missing_required"] == "not_applicable"
    assert outcomes["features.duplicates"] == "not_applicable"
    assert outcomes["manual.non_authoritative"] == "triggered"
    assert [issue["rule_id"] for issue in issues] == ["manual.non_authoritative"]


def test_reference_overlay_is_not_judged_as_empty_vector_data() -> None:
    layer = _layer(
        source_type="reference_overlay",
        source="KIUT/GESUT WMS",
        confidence="not_applicable",
        not_authoritative=True,
        feature_count=0,
        quality_status="unknown",
        validation_status_raw=None,
    )
    outcomes = {result.rule_id: result.outcome for result in evaluate_data_quality_rules(layer)}
    issues = triggered_issues(layer)

    assert outcomes["layer.empty"] == "not_applicable"
    assert outcomes["geometry.invalid"] == "not_applicable"
    assert outcomes["validation.status"] == "not_applicable"
    assert outcomes["reference.overlay"] == "triggered"
    assert [issue["rule_id"] for issue in issues] == ["reference.overlay"]


def test_source_metadata_rule_applies_even_when_source_type_is_unknown() -> None:
    issues = triggered_issues(_layer(source_type="unregistered_source", feature_count=True))

    assert [issue["rule_id"] for issue in issues] == ["source.inconsistent"]
    assert issues[0]["severity"] == "high"
