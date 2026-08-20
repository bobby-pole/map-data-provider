import copy
import json
import os
from pathlib import Path

import pytest

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.source_registry import (
    SourceEligibilityError,
    evaluate_source_eligibility,
    guard_source_access,
    is_public_export_eligible,
    load_source_registry,
    validate_analytical_cache_provenance,
    validate_ordered_provenance,
    validate_source_registry,
)


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "source_registry"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def _eligibility_candidates() -> dict[str, dict]:
    return {candidate["id"]: candidate for candidate in _fixture("eligibility-candidates.json")}


def test_source_registry_v2_registers_required_source_families_and_dimensions() -> None:
    registry = load_source_registry()
    sources = {source["id"]: source for source in registry["sources"]}

    assert registry["registry_version"] == "source_registry/v2"
    assert {"openstreetmap", "prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"} <= set(sources)
    assert sources["openstreetmap"]["data_kind"] == "vector"
    assert sources["prg_wfs"]["format"] == "wfs_gml"
    assert sources["bdot10k"]["format"] == "gpkg_geoparquet"
    assert sources["kiut_gesut_wms"]["data_kind"] == "rendered_imagery"
    assert sources["geoportal_orthophoto"]["usage_role"] == "reference"
    assert sources["nmt_nmpt"]["data_kind"] == "raster"
    assert is_public_export_eligible(sources["openstreetmap"])
    assert not is_public_export_eligible(sources["kiut_gesut_wms"])
    assert is_public_export_eligible(sources["prg_wfs"])
    assert is_public_export_eligible(sources["bdot10k"])


def test_source_registry_accepts_v1_fixture_for_migration_only() -> None:
    validate_source_registry(_fixture("registry-v1.json"))


def test_source_registry_rejects_extra_v2_fields_like_the_typescript_schema() -> None:
    registry = copy.deepcopy(_fixture("registry-v2.json"))
    registry["sources"][0]["unexpected"] = True

    with pytest.raises(ValueError, match="missing required fields"):
        validate_source_registry(registry)


def test_source_registry_rejects_restricted_access_claiming_to_be_qualified_free() -> None:
    registry = copy.deepcopy(_fixture("registry-v2.json"))
    registry["sources"][0]["access_method"] = "paid"

    with pytest.raises(ValueError, match="cannot be qualified free"):
        validate_source_registry(registry)


@pytest.mark.parametrize(
    ("fixture_name", "message"),
    [
        ("invalid-incomplete-v2.json", "missing required fields"),
        ("invalid-contradictory-v2.json", "cannot use rendered imagery"),
    ],
)
def test_source_registry_rejects_incomplete_or_contradictory_v2_fixtures(fixture_name: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        validate_source_registry(_fixture(fixture_name))


def test_public_export_provenance_rejects_reference_and_duplicate_sources() -> None:
    registry = load_source_registry()
    validate_ordered_provenance([{ "source_id": "openstreetmap", "contribution_role": "primary" }], registry, public_export=True)

    with pytest.raises(SourceEligibilityError, match="public_export"):
        validate_ordered_provenance([{ "source_id": "kiut_gesut_wms", "contribution_role": "validation_reference" }], registry, public_export=True)
    validate_ordered_provenance([{ "source_id": "prg_wfs", "contribution_role": "primary" }], registry, public_export=True)
    with pytest.raises(ValueError, match="must be unique"):
        validate_ordered_provenance(
            [
                { "source_id": "openstreetmap", "contribution_role": "primary" },
                { "source_id": "openstreetmap", "contribution_role": "supplementary" },
            ],
            registry,
        )


@pytest.mark.parametrize(
    ("source_id", "requested_use", "outcome", "reason_code"),
    [
        ("free_analytical_vector", "acquisition", "allowed", "qualified_free"),
        ("free_analytical_vector", "analytical_processing", "allowed", "qualified_free_analytical"),
        ("free_analytical_vector", "comparison", "allowed", "qualified_free_analytical_vector"),
        ("free_analytical_vector", "public_export", "allowed", "qualified_free_public_export"),
        ("free_registration_vector", "acquisition", "allowed", "qualified_free"),
        ("free_registration_vector", "public_export", "rejected", "public_export_prohibited"),
        ("free_reference_wms", "reference", "allowed", "qualified_free_reference"),
        ("free_reference_wms", "analytical_processing", "rejected", "not_analytical_source"),
        ("free_reference_wms", "comparison", "not_comparable", "reference_or_review_only"),
        ("free_reference_wms", "public_export", "rejected", "public_export_prohibited"),
        ("paid_source", "acquisition", "rejected", "not_qualified_free"),
        ("agreement_only_source", "local_import", "rejected", "not_qualified_free"),
        ("legally_unclear_source", "acquisition", "rejected", "not_qualified_free"),
    ],
)
def test_source_eligibility_decisions_are_deterministic(
    source_id: str,
    requested_use: str,
    outcome: str,
    reason_code: str,
) -> None:
    decision = evaluate_source_eligibility(_eligibility_candidates()[source_id], requested_use)  # type: ignore[arg-type]

    assert decision.outcome == outcome
    assert decision.reason_code == reason_code


def test_rejected_candidate_never_invokes_remote_or_local_access_callback() -> None:
    candidates = _eligibility_candidates()
    registry = {"registry_version": "source_registry/v2", "sources": [candidates["paid_source"]]}
    calls = 0

    def access() -> str:
        nonlocal calls
        calls += 1
        return "should not run"

    with pytest.raises(SourceEligibilityError, match="not_qualified_free"):
        guard_source_access("paid_source", "acquisition", access, registry)
    with pytest.raises(SourceEligibilityError, match="not_qualified_free"):
        guard_source_access("paid_source", "local_import", access, registry)
    assert calls == 0


def test_analytical_cache_rejects_non_free_provenance_before_reading_fields() -> None:
    source = _eligibility_candidates()["legally_unclear_source"]
    registry = {"registry_version": "source_registry/v2", "sources": [source]}
    metadata = {
        "source_type": "analytical_vector",
        "source_registry_id": "legally_unclear_source",
        "source_url": "fixture",
        "source_query": "fixture",
        "snapshot_at": "2026-08-02T00:00:00Z",
        "pipeline_version": "fixture/v1",
        "query_version": "fixture/v1",
    }

    with pytest.raises(ValueError, match="eligible analytical source"):
        validate_analytical_cache_provenance(metadata, registry)


def test_cache_reader_keeps_v1_power_provenance_readable_through_v2_registry(tmp_path: Path) -> None:
    source_paths = cache_paths("rybnik_35km", "power")
    target_paths = cache_paths("fixture_aoi", "power", root=tmp_path)
    target_paths.root.mkdir(parents=True)
    for source, target in (
        (source_paths.layer, target_paths.layer),
        (source_paths.metadata, target_paths.metadata),
        (source_paths.readiness, target_paths.readiness),
    ):
        target.write_bytes(source.read_bytes())

    metadata = json.loads(target_paths.metadata.read_text(encoding="utf-8"))
    metadata["aoi_id"] = "fixture_aoi"
    target_paths.metadata.write_text(json.dumps(metadata), encoding="utf-8")
    layer = json.loads(target_paths.layer.read_text(encoding="utf-8"))
    layer["metadata"]["aoi_id"] = "fixture_aoi"
    target_paths.layer.write_text(json.dumps(layer), encoding="utf-8")
    readiness = json.loads(target_paths.readiness.read_text(encoding="utf-8"))
    readiness["aoi_id"] = "fixture_aoi"
    target_paths.readiness.write_text(json.dumps(readiness), encoding="utf-8")

    assert read_cached_layer(target_paths)["metadata"]["source_registry_id"] == "openstreetmap"


def test_cache_reader_rejects_missing_legacy_analytical_source_provenance(tmp_path: Path) -> None:
    source_paths = cache_paths("rybnik_35km", "power")
    target_paths = cache_paths("fixture_aoi", "power", root=tmp_path)
    target_paths.root.mkdir(parents=True)
    for source, target in (
        (source_paths.layer, target_paths.layer),
        (source_paths.metadata, target_paths.metadata),
        (source_paths.readiness, target_paths.readiness),
    ):
        target.write_bytes(source.read_bytes())

    metadata = json.loads(target_paths.metadata.read_text(encoding="utf-8"))
    metadata["aoi_id"] = "fixture_aoi"
    metadata.pop("query_version")
    target_paths.metadata.write_text(json.dumps(metadata), encoding="utf-8")
    layer = json.loads(target_paths.layer.read_text(encoding="utf-8"))
    layer["metadata"]["aoi_id"] = "fixture_aoi"
    target_paths.layer.write_text(json.dumps(layer), encoding="utf-8")
    readiness = json.loads(target_paths.readiness.read_text(encoding="utf-8"))
    readiness["aoi_id"] = "fixture_aoi"
    target_paths.readiness.write_text(json.dumps(readiness), encoding="utf-8")

    with pytest.raises(ValueError, match="provenance fields: query_version"):
        read_cached_layer(target_paths)


if os.environ.get("MDQ_REJECT_NONFREE_PROBE") == "1":
    def test_probe_nonfree_source_rejection_failure() -> None:
        paid_source = {
            "id": "paid_analytical_vector",
            "access_method": "paid",
            "qualification_status": "qualified_free",
            "usage_role": "analytical",
            "data_kind": "vector",
        }
        res = evaluate_source_eligibility(paid_source, "analytical_processing")
        assert res["allowed"], "Probe intentionally failed: paid source must be rejected."


if os.environ.get("MDQ_REJECT_WMS_VECTOR_PROBE") == "1":
    def test_probe_wms_vector_export_rejection_failure() -> None:
        wms_source = {
            "id": "kiut_gesut_wms",
            "access_method": "api",
            "qualification_status": "qualified_free",
            "usage_role": "reference",
            "data_kind": "rendered_imagery",
        }
        res = evaluate_source_eligibility(wms_source, "public_export")
        assert res["allowed"], "Probe intentionally failed: WMS source must not be allowed for public vector export."


if os.environ.get("MDQ_REJECT_STALE_EVIDENCE_PROBE") == "1":
    def test_probe_stale_evidence_rejection_failure() -> None:
        source_paths = cache_paths("rybnik_35km", "power")
        metadata = json.loads(source_paths.metadata.read_text(encoding="utf-8"))
        has_valid_query = "query_version" in metadata and metadata["query_version"] == "stale_query_v0"
        assert has_valid_query, "Probe intentionally failed: stale or invalid query_version evidence must be rejected."


