"""Pure, source-aware data-quality rule evaluation for provider layers."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

RULE_VERSION = "1.0"
SOURCE_TYPES = frozenset({"analytical_vector", "manual_seed", "reference_overlay"})
CONFIDENCE_LEVELS = frozenset({"high", "medium", "low", "not_applicable"})
QUALITY_STATUSES = frozenset({"passed", "warning", "failed", "unknown"})
SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3}


@dataclass(frozen=True)
class RuleEvaluation:
    """One deterministic rule result, including explicit non-applicability."""

    rule_id: str
    outcome: str
    issue: dict[str, Any] | None = None


@dataclass(frozen=True)
class RuleDefinition:
    rule_id: str
    source_types: frozenset[str]
    severity: str
    category: str
    title: str
    recommendation: str
    trigger: Callable[[Mapping[str, Any]], str | None]


def evaluate_data_quality_rules(layer: Mapping[str, Any]) -> list[RuleEvaluation]:
    """Evaluate all initial rules without filesystem or network dependencies."""
    context = _normalized_layer(layer)
    evaluations: list[RuleEvaluation] = []
    for rule in _RULES:
        if rule.source_types and context["source_type"] not in rule.source_types:
            evaluations.append(RuleEvaluation(rule_id=rule.rule_id, outcome="not_applicable"))
            continue
        evidence = rule.trigger(context)
        if evidence is None:
            evaluations.append(RuleEvaluation(rule_id=rule.rule_id, outcome="passed"))
            continue
        evaluations.append(
            RuleEvaluation(
                rule_id=rule.rule_id,
                outcome="triggered",
                issue=_issue_from_rule(context, rule=rule, evidence=evidence),
            )
        )
    return evaluations


def triggered_issues(layer: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return API-ready issues only for triggered outcomes."""
    return [
        evaluation.issue
        for evaluation in evaluate_data_quality_rules(layer)
        if evaluation.issue is not None
    ]


def highest_issue_severity(issues: list[Mapping[str, Any]]) -> str | None:
    """Return the worst structured severity without reading human-facing text."""
    severities = [
        str(issue.get("severity")) for issue in issues if issue.get("severity") in SEVERITY_RANK
    ]
    return max(severities, key=SEVERITY_RANK.__getitem__) if severities else None


def _normalized_layer(layer: Mapping[str, Any]) -> dict[str, Any]:
    source_type = str(layer.get("source_type") or "unknown")
    feature_count = layer.get("feature_count", 0)
    return {
        "layer_id": str(layer.get("id") or layer.get("layer_id") or "unknown.layer"),
        "label": str(layer.get("label") or layer.get("id") or "Unknown layer"),
        "domain": str(layer.get("domain") or "unknown"),
        "source": layer.get("source"),
        "source_type": source_type,
        "confidence": layer.get("confidence"),
        "limitations": layer.get("limitations"),
        "not_authoritative": layer.get("not_authoritative"),
        "feature_count": _non_negative_int(feature_count),
        "quality_status": str(layer.get("quality_status") or "unknown"),
        "validation_status_raw": layer.get("validation_status_raw"),
        "invalid_geometry_count": _non_negative_int(layer.get("invalid_geometry_count")),
        "missing_required_attributes": _string_list(layer.get("missing_required_attributes")),
        "duplicate_count": _non_negative_int(layer.get("duplicate_count")),
        "unsupported_geometry_types": _string_list(layer.get("unsupported_geometry_types")),
        "source_metadata_valid": _source_metadata_valid(layer, source_type=source_type),
    }


def _source_metadata_valid(layer: Mapping[str, Any], *, source_type: str) -> bool:
    if "source_metadata_valid" in layer:
        return bool(layer["source_metadata_valid"])
    return (
        source_type in SOURCE_TYPES
        and isinstance(layer.get("source"), str)
        and bool(layer["source"].strip())
        and layer.get("confidence") in CONFIDENCE_LEVELS
        and isinstance(layer.get("limitations"), list)
        and all(isinstance(item, str) for item in layer["limitations"])
        and isinstance(layer.get("not_authoritative"), bool)
    )


def _non_negative_int(value: object) -> int:
    return value if type(value) is int and value >= 0 else 0


def _string_list(value: object) -> list[str]:
    return value if isinstance(value, list) and all(isinstance(item, str) for item in value) else []


def _issue_from_rule(
    context: Mapping[str, Any], *, rule: RuleDefinition, evidence: str
) -> dict[str, Any]:
    layer_id = context["layer_id"]
    return {
        "id": _issue_id(layer_id, rule.rule_id),
        "rule_id": rule.rule_id,
        "rule_version": RULE_VERSION,
        "severity": rule.severity,
        "source_type": context["source_type"],
        "domain": context["domain"],
        "layer_id": layer_id,
        "affected_object": {"type": "layer", "id": layer_id},
        "category": rule.category,
        "title": rule.title.format(
            label=context["label"], quality_status=context["quality_status"]
        ),
        "evidence": evidence,
        "recommendation": rule.recommendation,
        "status": "open",
    }


def _issue_id(layer_id: str, rule_id: str) -> str:
    legacy_ids = {
        (
            "manual.power.seeds",
            "manual.non_authoritative",
        ): "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE",
        ("external.kiut_wms", "reference.overlay"): "DQ-KIUT-WMS-REFERENCE-ONLY",
    }
    if (layer_id, rule_id) in legacy_ids:
        return legacy_ids[(layer_id, rule_id)]
    layer_code = layer_id.replace(".", "-").upper()
    rule_code = {
        "layer.empty": "EMPTY",
        "validation.status": "QUALITY",
        "geometry.invalid": "INVALID-GEOMETRY",
        "attributes.missing_required": "MISSING-ATTRIBUTES",
        "features.duplicates": "DUPLICATES",
        "geometry.unsupported": "UNSUPPORTED-GEOMETRY",
        "source.inconsistent": "SOURCE-METADATA",
        "manual.non_authoritative": "NON-AUTHORITATIVE",
        "reference.overlay": "REFERENCE-ONLY",
    }[rule_id]
    return f"DQ-{layer_code}-{rule_code}"


def _empty_layer(context: Mapping[str, Any]) -> str | None:
    if context["feature_count"] == 0:
        return "Layer artifact exists but contains zero GeoJSON features."
    return None


def _invalid_geometry(context: Mapping[str, Any]) -> str | None:
    count = context["invalid_geometry_count"]
    return f"Validation found {count} invalid geometries." if count else None


def _missing_required_attributes(context: Mapping[str, Any]) -> str | None:
    fields = context["missing_required_attributes"]
    return f"Required attributes missing: {', '.join(fields)}." if fields else None


def _suspicious_duplicates(context: Mapping[str, Any]) -> str | None:
    count = context["duplicate_count"]
    return f"Validation found {count} suspicious duplicate features." if count else None


def _unsupported_geometry(context: Mapping[str, Any]) -> str | None:
    geometry_types = context["unsupported_geometry_types"]
    return f"Unsupported geometry types: {', '.join(geometry_types)}." if geometry_types else None


def _inconsistent_source(context: Mapping[str, Any]) -> str | None:
    return (
        None
        if context["source_metadata_valid"]
        else "Source metadata does not match the provider source contract."
    )


def _validation_status(context: Mapping[str, Any]) -> str | None:
    quality_status = context["quality_status"]
    if quality_status == "passed":
        return None
    raw_status = context["validation_status_raw"] or "missing"
    return f"Validation report status: {raw_status} (normalized: {quality_status})."


def _manual_non_authoritative(context: Mapping[str, Any]) -> str | None:
    if context["feature_count"] == 0:
        return None
    return "Manual seed layer is intended for review and synthetic topology experiments only."


def _reference_overlay(context: Mapping[str, Any]) -> str | None:
    return "Reference overlay is not analytical vector geometry and cannot be used as a simulation source."


_RULES = (
    RuleDefinition(
        "layer.empty",
        frozenset({"analytical_vector", "manual_seed"}),
        "high",
        "empty_layer",
        "{label} has no features",
        "Verify extraction, AOI clipping and source availability.",
        _empty_layer,
    ),
    RuleDefinition(
        "geometry.invalid",
        frozenset({"analytical_vector", "manual_seed"}),
        "high",
        "invalid_geometry",
        "{label} contains invalid geometry",
        "Repair or exclude invalid features before analytical use.",
        _invalid_geometry,
    ),
    RuleDefinition(
        "attributes.missing_required",
        frozenset({"analytical_vector"}),
        "medium",
        "missing_required_attributes",
        "{label} is missing required analytical attributes",
        "Inspect normalization and source tags before analytical use.",
        _missing_required_attributes,
    ),
    RuleDefinition(
        "features.duplicates",
        frozenset({"analytical_vector"}),
        "medium",
        "suspicious_duplicates",
        "{label} has suspicious duplicate features",
        "Inspect duplicate source IDs or geometries before analytical use.",
        _suspicious_duplicates,
    ),
    RuleDefinition(
        "geometry.unsupported",
        frozenset({"analytical_vector", "manual_seed"}),
        "medium",
        "unsupported_geometry",
        "{label} has unsupported geometry types",
        "Normalize supported geometry before serving the layer.",
        _unsupported_geometry,
    ),
    RuleDefinition(
        "source.inconsistent",
        frozenset(),
        "high",
        "source_metadata",
        "{label} has inconsistent source metadata",
        "Correct source classification, confidence, limitations and authority metadata.",
        _inconsistent_source,
    ),
    RuleDefinition(
        "validation.status",
        frozenset({"analytical_vector", "manual_seed"}),
        "medium",
        "quality_status",
        "{label} quality status is {quality_status}",
        "Inspect validation evidence and document limitations before analytical use.",
        _validation_status,
    ),
    RuleDefinition(
        "manual.non_authoritative",
        frozenset({"manual_seed"}),
        "medium",
        "manual_source",
        "{label} is not authoritative infrastructure data",
        "Keep manual seeds visually distinct and exclude them from source-of-truth analytics.",
        _manual_non_authoritative,
    ),
    RuleDefinition(
        "reference.overlay",
        frozenset({"reference_overlay"}),
        "medium",
        "wms_reference_only",
        "{label} must remain visual reference only",
        "Use analytical vectors for analytics and keep this overlay as visual comparison only.",
        _reference_overlay,
    ),
)
