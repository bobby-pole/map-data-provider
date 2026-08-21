import json
from pathlib import Path

from geo_pipeline.source_registry import load_source_registry

STRATEGY_PATH = Path(__file__).resolve().parents[1] / "data" / "sources" / "source_strategy.json"
REQUIRED_DOMAINS = {
    "emergency",
    "public_services",
    "transport",
    "bridges",
    "water",
    "gas",
    "sewer",
    "industrial",
    "telecom",
    "district_heating",
}


def _strategy() -> dict:
    return json.loads(STRATEGY_PATH.read_text(encoding="utf-8"))


def test_source_strategy_has_dated_primary_evidence_and_explicit_decisions() -> None:
    strategy = _strategy()
    assert strategy["strategy_version"] == "source_strategy/v1"
    assert strategy["verified_at"] == "2026-08-01"
    for candidate in strategy["candidates"]:
        assert candidate["decision"] in {"adopt", "reference_only", "reject"}
        if candidate["decision"] != "reject":
            assert candidate["evidence"]
            assert all(
                item["url"].startswith("https://") and item["checked_at"] == strategy["verified_at"]
                for item in candidate["evidence"]
            )


def test_every_planned_domain_has_an_adopted_strategy_or_explicit_gap() -> None:
    strategy = _strategy()
    candidates = {candidate["id"]: candidate for candidate in strategy["candidates"]}
    domains = {domain["id"]: domain for domain in strategy["domains"]}
    assert set(domains) == REQUIRED_DOMAINS
    for domain in domains.values():
        assert domain["analytical_sources"] or domain["source_gaps"]
        assert all(
            candidates[source]["decision"] == "adopt" for source in domain["analytical_sources"]
        )
        assert all(
            candidates[source]["decision"] == "reference_only"
            for source in domain["reference_sources"]
        )


def test_only_qualified_adopted_candidates_are_enabled_in_registry_and_imagery_is_not_exported() -> (
    None
):
    strategy = _strategy()
    registry = {source["id"]: source for source in load_source_registry()["sources"]}
    for candidate in strategy["candidates"]:
        if candidate["id"] not in registry:
            assert candidate["decision"] == "reject"
            continue
        source = registry[candidate["id"]]
        if candidate["decision"] == "adopt":
            assert source["qualification"] == "qualified_free"
        if candidate["decision"] == "reference_only":
            assert source["usage_role"] == "reference"
            assert source["distribution"]["public_export"] == "prohibited"
