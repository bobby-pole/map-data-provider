"""Shared provider readiness derivation from source, validation and issue severity."""

from __future__ import annotations

QUALITY_STATUSES = frozenset({"passed", "warning", "failed", "unknown"})
SOURCE_TYPES = frozenset({"analytical_vector", "manual_seed", "reference_overlay"})


def derive_readiness(
    *,
    quality_status: str,
    feature_count: int,
    source_type: str,
    issue_severity: str | None = None,
    comparison_outcomes: tuple[str, ...] = (),
) -> str:
    if quality_status not in QUALITY_STATUSES:
        quality_status = "unknown"
    if source_type not in SOURCE_TYPES:
        source_type = "reference_overlay"
    if source_type == "reference_overlay":
        return "needs_source"
    if issue_severity == "high" or feature_count == 0 or quality_status == "failed":
        return "not_usable"
    if quality_status == "unknown":
        return "needs_source"
    if (
        source_type == "manual_seed"
        or quality_status == "warning"
        or issue_severity in {"low", "medium"}
        or any(outcome in {"conflicting", "source_only", "ambiguous"} for outcome in comparison_outcomes)
    ):
        return "usable_with_limitations"
    return "ready"
