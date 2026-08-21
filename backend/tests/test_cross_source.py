import pytest

from geo_pipeline.cross_source import compare_power_features, comparison_validation
from geo_pipeline.readiness import derive_readiness


def _feature(
    source: str, identifier: str | None, asset: str | None = "line", x: float = 18.5
) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "source_registry_id": source,
            **({"source_feature_id": identifier} if identifier else {}),
            **({"asset_type": asset} if asset else {}),
        },
        "geometry": {"type": "Point", "coordinates": [x, 50.1]},
    }


def test_deterministic_agreement_conflict_and_source_only_preserve_identities() -> None:
    assert (
        compare_power_features(_feature("openstreetmap", "same"), _feature("bdot10k", "same"))[
            "outcome"
        ]
        == "matched"
    )
    assert (
        compare_power_features(
            _feature("openstreetmap", None, "line"),
            _feature("bdot10k", None, "station"),
        )["outcome"]
        == "conflicting"
    )
    result = compare_power_features(_feature("openstreetmap", None), None)
    assert result["outcome"] == "source_only" and result["left"]["source_id"] == "openstreetmap"


def test_ambiguous_and_reference_only_evidence_never_conflate() -> None:
    assert (
        compare_power_features(_feature("openstreetmap", None, None), _feature("bdot10k", None))[
            "outcome"
        ]
        == "ambiguous"
    )
    assert (
        compare_power_features(_feature("openstreetmap", "x"), _feature("kiut_gesut_wms", "x"))[
            "outcome"
        ]
        == "not_comparable"
    )


def test_comparison_outcomes_drive_structured_validation_issues_and_readiness() -> None:
    conflict = compare_power_features(
        _feature("openstreetmap", None, "line"), _feature("bdot10k", None, "station")
    )
    validation = comparison_validation([conflict])
    assert validation["quality_status"] == "warning"
    assert validation["issues"] == [
        {
            "rule_id": "cross_source.power.conflicting",
            "rule_version": "power_match/v1",
            "severity": "medium",
            "outcome": "conflicting",
            "evidence": "asset_type_mismatch",
            "left": {"source_id": "openstreetmap", "feature_id": None},
            "right": {"source_id": "bdot10k", "feature_id": None},
        }
    ]
    assert (
        derive_readiness(
            quality_status="passed",
            feature_count=1,
            source_type="analytical_vector",
            comparison_outcomes=(conflict["outcome"],),
        )
        == "usable_with_limitations"
    )


def test_unknown_comparison_outcome_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported comparison outcome"):
        comparison_validation([{"outcome": "invented"}])
