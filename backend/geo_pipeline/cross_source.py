"""Deterministic, non-conflating comparison evidence for analytical vectors."""

from __future__ import annotations

from typing import Any

from shapely.geometry import shape

from geo_pipeline.source_registry import evaluate_source_eligibility, load_source_registry

COMPARISON_VERSION = "cross_source_comparison/v1"
POWER_RULE_VERSION = "power_match/v1"
COMPARISON_OUTCOMES = frozenset({"matched", "conflicting", "source_only", "ambiguous", "not_comparable"})


def comparison_validation(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Turn comparison records into validation and issue-ready evidence.

    This boundary deliberately keeps the original feature records outside the
    summary. Consumers receive stable outcome enums, not parsed prose.
    """
    counts = {outcome: 0 for outcome in sorted(COMPARISON_OUTCOMES)}
    issues: list[dict[str, Any]] = []
    for result in results:
        outcome = result.get("outcome")
        if outcome not in COMPARISON_OUTCOMES:
            raise ValueError("Unsupported comparison outcome")
        counts[outcome] += 1
        if outcome in {"conflicting", "source_only", "ambiguous"}:
            issues.append(
                {
                    "rule_id": f"cross_source.power.{outcome}",
                    "rule_version": result["rule_version"],
                    "severity": "medium" if outcome != "ambiguous" else "low",
                    "outcome": outcome,
                    "evidence": result["evidence"],
                    "left": result["left"],
                    "right": result["right"],
                }
            )
    return {
        "comparison_version": COMPARISON_VERSION,
        "domain": "power",
        "quality_status": "warning" if issues else "passed",
        "outcome_counts": counts,
        "issues": issues,
    }


def compare_power_features(left: dict[str, Any], right: dict[str, Any] | None) -> dict[str, Any]:
    """Compare two preserved features; never merge, replace or mutate them."""
    if right is None:
        return _result("source_only", left, {}, "no_candidate_in_other_source")
    left_source, right_source = _source(left), _source(right)
    registry = {item["id"]: item for item in load_source_registry()["sources"]}
    if any(source not in registry or evaluate_source_eligibility(registry[source], "comparison").outcome != "allowed" for source in (left_source, right_source)):
        return _result("not_comparable", left, right, "reference_or_rejected_source")
    left_id, right_id = _feature_id(left), _feature_id(right)
    if left_id and left_id == right_id:
        return _result("matched", left, right, "stable_source_id")
    left_type, right_type = left.get("properties", {}).get("asset_type"), right.get("properties", {}).get("asset_type")
    if not isinstance(left_type, str) or not isinstance(right_type, str) or not left.get("geometry") or not right.get("geometry"):
        return _result("ambiguous", left, right, "missing_comparable_id_geometry_or_attribute")
    if left_type != right_type:
        return _result("conflicting", left, right, "asset_type_mismatch")
    distance = shape(left["geometry"]).distance(shape(right["geometry"]))
    return _result("matched" if distance <= 0.0001 else "source_only", left, right, "bounded_geometry_distance", distance=round(distance, 8))


def _source(feature: dict[str, Any]) -> str:
    value = feature.get("properties", {}).get("source_registry_id")
    return value if isinstance(value, str) else ""


def _feature_id(feature: dict[str, Any]) -> str | None:
    value = feature.get("properties", {}).get("source_feature_id")
    return value if isinstance(value, str) and value else None


def _result(outcome: str, left: dict[str, Any], right: dict[str, Any], evidence: str, **extra: Any) -> dict[str, Any]:
    return {"comparison_version": COMPARISON_VERSION, "rule_version": POWER_RULE_VERSION, "domain": "power", "outcome": outcome, "left": {"source_id": _source(left), "feature_id": _feature_id(left)}, "right": {"source_id": _source(right), "feature_id": _feature_id(right)}, "evidence": evidence, **extra}
