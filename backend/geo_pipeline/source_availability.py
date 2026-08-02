"""Versioned, cache-safe source availability and AOI coverage reports."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from geo_pipeline.source_registry import evaluate_source_eligibility, load_source_registry

SOURCE_AVAILABILITY_VERSION = "provider_source_availability/v1"
STATES = {"available", "unavailable", "not_eligible", "reference_only"}
COVERAGE = {"covered", "uncovered", "not_applicable"}
FEATURES = {"available", "empty", "not_applicable"}


class SourceAvailabilityError(ValueError):
    pass


def load_report(path: Path, *, now: datetime) -> dict[str, Any]:
    """Load a committed report; this path never performs a remote probe."""
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SourceAvailabilityError("Source availability report is unreadable") from error
    return validate_report(report, now=now)


def validate_report(report: dict[str, Any], *, now: datetime) -> dict[str, Any]:
    if not isinstance(report, dict) or report.get("report_version") != SOURCE_AVAILABILITY_VERSION:
        raise SourceAvailabilityError("Unsupported source availability report")
    if not isinstance(report.get("aoi_id"), str) or not isinstance(report.get("evidence_timestamp"), str):
        raise SourceAvailabilityError("Source availability report is missing AOI/evidence timestamp")
    registry = {source["id"]: source for source in load_source_registry()["sources"]}
    entries = report.get("sources")
    if not isinstance(entries, list) or {entry.get("source_id") for entry in entries if isinstance(entry, dict)} != set(registry):
        raise SourceAvailabilityError("Source availability report must contain every registered source once")
    parsed_entries = [_validate_entry(entry, registry[entry["source_id"]], now) for entry in entries]
    return {**report, "sources": parsed_entries}


def _validate_entry(entry: Any, source: dict[str, Any], now: datetime) -> dict[str, Any]:
    required = {"source_id", "availability", "aoi_coverage", "feature_state", "evidence_timestamp", "fresh_after_days", "evidence"}
    if not isinstance(entry, dict) or set(entry) != required:
        raise SourceAvailabilityError("Source availability entry has unsupported fields")
    if entry["availability"] not in STATES or entry["aoi_coverage"] not in COVERAGE or entry["feature_state"] not in FEATURES:
        raise SourceAvailabilityError("Source availability entry has unsupported state")
    if not isinstance(entry["fresh_after_days"], int) or entry["fresh_after_days"] <= 0 or not isinstance(entry["evidence"], str):
        raise SourceAvailabilityError("Source availability freshness evidence is invalid")
    try:
        timestamp = datetime.fromisoformat(entry["evidence_timestamp"].replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise SourceAvailabilityError("Source availability evidence timestamp is invalid") from error
    if timestamp.tzinfo is None:
        raise SourceAvailabilityError("Source availability evidence timestamp requires timezone")
    eligibility = evaluate_source_eligibility(source, "analytical_processing")
    freshness = "fresh" if now.astimezone(timezone.utc) <= timestamp.astimezone(timezone.utc) + timedelta(days=entry["fresh_after_days"]) else "stale"
    if entry["availability"] == "not_eligible" and eligibility.outcome == "allowed":
        raise SourceAvailabilityError("Eligible analytical source cannot be reported not_eligible")
    actionable_gap = entry["availability"] in {"unavailable", "not_eligible"} or (entry["aoi_coverage"] == "uncovered" and source["usage_role"] == "analytical")
    return {**entry, "freshness": freshness, "eligibility": eligibility.outcome, "actionable_gap": actionable_gap}


def optional_live_probe(source_id: str, probe: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Diagnostic-only probe wrapper; callers keep it off cached read paths."""
    try:
        return {"source_id": source_id, "status": "available", "diagnostic": probe()}
    except Exception:
        return {"source_id": source_id, "status": "unavailable", "diagnostic": None}
