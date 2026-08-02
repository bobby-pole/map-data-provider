"""Provider-owned multi-source registry and provenance validation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal, TypeVar

SOURCE_REGISTRY_V1 = "source_registry/v1"
SOURCE_REGISTRY_VERSION = "source_registry/v2"
REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "sources" / "registry.json"

DATA_KINDS = frozenset({"vector", "raster", "rendered_imagery"})
FORMATS = frozenset({"geojson", "osm_query", "wfs_gml", "gpkg_geoparquet", "wms", "wmts", "geotiff_ascii_grid"})
AUTHORITIES = frozenset({"community", "official", "project_local"})
ACCESS_METHODS = frozenset({
    "public_query",
    "public_service",
    "public_download",
    "free_registration",
    "local_review_input",
    "paid",
    "agreement_only",
    "private_partner",
})
USAGE_ROLES = frozenset({"analytical", "reference", "review"})
QUALIFICATION_STATUSES = frozenset({"qualified_free", "pending_qualification", "rejected"})
DISTRIBUTION_DECISIONS = frozenset({"allowed", "prohibited"})
CONTRIBUTION_ROLES = frozenset({"primary", "supplementary", "validation_reference", "derived_context"})
ELIGIBILITY_USES = frozenset({"acquisition", "local_import", "analytical_processing", "reference", "comparison", "public_export"})

EligibilityUse = Literal["acquisition", "local_import", "analytical_processing", "reference", "comparison", "public_export"]
EligibilityOutcome = Literal["allowed", "rejected", "not_comparable"]
AccessResult = TypeVar("AccessResult")


@dataclass(frozen=True)
class SourceEligibilityDecision:
    """Stable source-governance outcome for one requested use."""

    source_id: str
    requested_use: EligibilityUse
    outcome: EligibilityOutcome
    reason_code: str

    @property
    def allowed(self) -> bool:
        return self.outcome == "allowed"


class SourceEligibilityError(ValueError):
    """Raised before source access when a requested use is not allowed."""

    def __init__(self, decision: SourceEligibilityDecision) -> None:
        self.decision = decision
        super().__init__(
            f"Source {decision.source_id} is {decision.outcome} for "
            f"{decision.requested_use}: {decision.reason_code}"
        )

V2_REQUIRED_SOURCE_FIELDS = frozenset(
    {
        "id",
        "name",
        "data_kind",
        "format",
        "authority",
        "access_method",
        "usage_role",
        "qualification",
        "distribution",
        "not_authoritative",
        "eligible_for_analysis",
        "source_url",
        "attribution",
        "license",
        "license_url",
        "availability_caveats",
        "limitations",
    }
)
V2_ALLOWED_SOURCE_FIELDS = V2_REQUIRED_SOURCE_FIELDS | {"cache_provenance"}
V1_REQUIRED_SOURCE_FIELDS = frozenset(
    {
        "id",
        "name",
        "source_type",
        "role",
        "access",
        "not_authoritative",
        "eligible_for_analysis",
        "source_url",
        "attribution",
        "license",
        "distribution_guidance",
        "availability_caveats",
        "limitations",
    }
)


def load_source_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    """Load and validate the portable v2 source-registry contract."""
    registry = json.loads(path.read_text(encoding="utf-8"))
    validate_source_registry(registry)
    if registry["registry_version"] != SOURCE_REGISTRY_VERSION:
        raise ValueError("Runtime source registry must use source_registry/v2")
    return registry


def validate_source_registry(registry: dict[str, Any]) -> None:
    """Validate v2 records or the narrow v1 migration fixture contract."""
    version = registry.get("registry_version")
    if version == SOURCE_REGISTRY_VERSION:
        _validate_v2_registry(registry)
    elif version == SOURCE_REGISTRY_V1:
        _validate_v1_registry(registry)
    else:
        raise ValueError("Unsupported source registry version")


def validate_ordered_provenance(
    provenance: list[dict[str, Any]],
    registry: dict[str, Any] | None = None,
    *,
    public_export: bool = False,
) -> None:
    """Validate ordered, non-conflated source provenance for a future layer or domain pack."""
    registry = registry or load_source_registry()
    if registry.get("registry_version") != SOURCE_REGISTRY_VERSION:
        raise ValueError("Ordered provenance requires source_registry/v2")
    if not isinstance(provenance, list) or not provenance:
        raise ValueError("Ordered provenance must contain at least one source")

    source_ids: set[str] = set()
    for record in provenance:
        if not isinstance(record, dict) or set(record) != {"source_id", "contribution_role"}:
            raise ValueError("Provenance records require source_id and contribution_role")
        source_id = record["source_id"]
        contribution_role = record["contribution_role"]
        if not isinstance(source_id, str) or source_id in source_ids:
            raise ValueError("Ordered provenance source IDs must be unique non-empty strings")
        if contribution_role not in CONTRIBUTION_ROLES:
            raise ValueError("Unsupported provenance contribution role")
        source = _source_by_id(registry, source_id)
        if public_export:
            require_source_eligibility(source, "public_export")
        source_ids.add(source_id)


def is_public_export_eligible(source: dict[str, Any]) -> bool:
    """Return whether one v2 source can contribute an analytical public export."""
    distribution = source.get("distribution")
    return bool(
        isinstance(distribution, dict)
        and distribution.get("public_export") == "allowed"
        and source.get("qualification") == "qualified_free"
        and source.get("usage_role") == "analytical"
        and source.get("data_kind") != "rendered_imagery"
    )


def evaluate_source_eligibility(source: dict[str, Any], requested_use: EligibilityUse) -> SourceEligibilityDecision:
    """Evaluate a source before access, processing, comparison or export.

    The decision deliberately uses registry evidence only. It never makes a live
    licence, availability or completeness claim, and callers must enforce a
    non-allowed result before opening a remote connection or local import.
    """
    if requested_use not in ELIGIBILITY_USES:
        raise ValueError(f"Unsupported source eligibility use: {requested_use}")

    source_id = source.get("id")
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("Eligibility source requires a non-empty id")

    if source.get("qualification") != "qualified_free":
        return _decision(source_id, requested_use, "rejected", "not_qualified_free")

    if requested_use in {"acquisition", "local_import"}:
        return _decision(source_id, requested_use, "allowed", "qualified_free")

    if requested_use == "reference":
        if source.get("usage_role") == "reference":
            return _decision(source_id, requested_use, "allowed", "qualified_free_reference")
        return _decision(source_id, requested_use, "rejected", "not_reference_source")

    if requested_use == "analytical_processing":
        if source.get("usage_role") != "analytical" or source.get("eligible_for_analysis") is not True:
            return _decision(source_id, requested_use, "rejected", "not_analytical_source")
        if source.get("data_kind") == "rendered_imagery":
            return _decision(source_id, requested_use, "rejected", "rendered_imagery_not_analytical")
        return _decision(source_id, requested_use, "allowed", "qualified_free_analytical")

    if requested_use == "comparison":
        if source.get("usage_role") != "analytical" or source.get("eligible_for_analysis") is not True:
            return _decision(source_id, requested_use, "not_comparable", "reference_or_review_only")
        if source.get("data_kind") != "vector":
            return _decision(source_id, requested_use, "not_comparable", "not_analytical_vector")
        return _decision(source_id, requested_use, "allowed", "qualified_free_analytical_vector")

    if is_public_export_eligible(source):
        return _decision(source_id, requested_use, "allowed", "qualified_free_public_export")
    return _decision(source_id, requested_use, "rejected", "public_export_prohibited")


def require_source_eligibility(source: dict[str, Any], requested_use: EligibilityUse) -> SourceEligibilityDecision:
    """Raise before an ineligible source is acquired, imported or processed."""
    decision = evaluate_source_eligibility(source, requested_use)
    if not decision.allowed:
        raise SourceEligibilityError(decision)
    return decision


def guard_source_access(
    source_id: str,
    requested_use: EligibilityUse,
    action: Callable[[], AccessResult],
    registry: dict[str, Any] | None = None,
) -> AccessResult:
    """Run a fetch/import action only after the registry eligibility check."""
    registry = registry or load_source_registry()
    source = _source_by_id(registry, source_id)
    require_source_eligibility(source, requested_use)
    return action()


def validate_analytical_cache_provenance(metadata: dict[str, Any], registry: dict[str, Any] | None = None) -> None:
    """Keep v1 cache metadata readable while resolving its source ID through v2."""
    if metadata.get("source_type") != "analytical_vector":
        return
    registry = registry or load_source_registry()
    source_id = metadata.get("source_registry_id")
    if not isinstance(source_id, str):
        raise ValueError("Analytical cache metadata is missing source_registry_id")
    source = _source_by_id(registry, source_id)
    try:
        require_source_eligibility(source, "analytical_processing")
    except SourceEligibilityError as error:
        raise ValueError("Analytical cache provenance must reference an eligible analytical source") from error
    if not _is_analytical_vector(source):
        raise ValueError("Analytical cache provenance must reference an analytical vector source")
    required_fields = _cache_provenance_fields(source)
    missing = [field for field in required_fields if not metadata.get(field)]
    if missing:
        raise ValueError(f"Analytical cache metadata is missing provenance fields: {', '.join(missing)}")
    if metadata["source_url"] != source["source_url"]:
        raise ValueError("Analytical cache source URL does not match the source registry")


def _validate_v2_registry(registry: dict[str, Any]) -> None:
    if set(registry) != {"registry_version", "sources"}:
        raise ValueError("Source registry v2 contains unsupported fields")
    sources = _require_sources(registry)
    source_ids: set[str] = set()
    for source in sources:
        if (
            not isinstance(source, dict)
            or not V2_REQUIRED_SOURCE_FIELDS <= set(source)
            or not set(source) <= V2_ALLOWED_SOURCE_FIELDS
        ):
            raise ValueError("Source registry v2 entry is missing required fields")
        source_id = source["id"]
        if not isinstance(source_id, str) or not source_id or source_id in source_ids:
            raise ValueError("Source registry IDs must be unique non-empty strings")
        source_ids.add(source_id)
        _validate_v2_source(source)

    required_families = {"openstreetmap", "prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"}
    missing_families = required_families - source_ids
    if missing_families:
        raise ValueError(f"Source registry v2 is missing required source families: {', '.join(sorted(missing_families))}")


def _validate_v2_source(source: dict[str, Any]) -> None:
    source_id = source["id"]
    if not isinstance(source["name"], str) or not source["name"]:
        raise ValueError(f"Source {source_id} requires a non-empty name")
    _require_enum(source, "data_kind", DATA_KINDS, source_id)
    _require_enum(source, "format", FORMATS, source_id)
    _require_enum(source, "authority", AUTHORITIES, source_id)
    _require_enum(source, "access_method", ACCESS_METHODS, source_id)
    _require_enum(source, "usage_role", USAGE_ROLES, source_id)
    _require_enum(source, "qualification", QUALIFICATION_STATUSES, source_id)
    if source["access_method"] in {"paid", "agreement_only", "private_partner"} and source["qualification"] == "qualified_free":
        raise ValueError(f"Restricted access source {source_id} cannot be qualified free")
    if not isinstance(source["distribution"], dict) or set(source["distribution"]) != {"public_export", "reason"}:
        raise ValueError(f"Source {source_id} requires a complete distribution policy")
    _require_enum(source["distribution"], "public_export", DISTRIBUTION_DECISIONS, source_id)
    if not isinstance(source["distribution"]["reason"], str) or not source["distribution"]["reason"]:
        raise ValueError(f"Source {source_id} requires a distribution reason")
    if not isinstance(source["not_authoritative"], bool) or not isinstance(source["eligible_for_analysis"], bool):
        raise ValueError(f"Source {source_id} must declare authority and analytical-eligibility flags")
    if not isinstance(source["source_url"], str) or not source["source_url"]:
        raise ValueError(f"Source {source_id} requires a source URL or local reference")
    if not isinstance(source["attribution"], str) or not source["attribution"] or not isinstance(source["license"], str) or not source["license"]:
        raise ValueError(f"Source {source_id} requires attribution and licence text")
    if source["license_url"] is not None and not isinstance(source["license_url"], str):
        raise ValueError(f"Source {source_id} license URL must be a string or null")
    if (
        not isinstance(source["availability_caveats"], list)
        or not isinstance(source["limitations"], list)
        or not all(isinstance(value, str) for value in source["availability_caveats"] + source["limitations"])
    ):
        raise ValueError(f"Source {source_id} must provide availability caveats and limitations")

    expected_kind = {
        "geojson": "vector",
        "osm_query": "vector",
        "wfs_gml": "vector",
        "gpkg_geoparquet": "vector",
        "wms": "rendered_imagery",
        "wmts": "rendered_imagery",
        "geotiff_ascii_grid": "raster",
    }[source["format"]]
    if source["data_kind"] != expected_kind:
        raise ValueError(f"Source {source_id} data kind contradicts its format")
    if source["usage_role"] == "analytical" and source["data_kind"] == "rendered_imagery":
        raise ValueError(f"Source {source_id} cannot use rendered imagery as analytical data")
    if source["usage_role"] != "analytical" and source["eligible_for_analysis"]:
        raise ValueError(f"Only analytical sources can be eligible for analysis: {source_id}")
    if source["usage_role"] != "analytical" and source["distribution"]["public_export"] != "prohibited":
        raise ValueError(f"Reference or review source {source_id} cannot enter public analytical export")
    if source["qualification"] != "qualified_free" and source["distribution"]["public_export"] != "prohibited":
        raise ValueError(f"Unqualified source {source_id} cannot enter public export")
    if is_public_export_eligible(source) and source["not_authoritative"]:
        raise ValueError(f"Non-authoritative source {source_id} cannot enter public analytical export")
    if (
        source["usage_role"] == "analytical"
        and source["data_kind"] == "vector"
        and source["qualification"] == "qualified_free"
    ):
        provenance = source.get("cache_provenance")
        if (
            not isinstance(provenance, dict)
            or set(provenance) != {"required_fields"}
            or not isinstance(provenance.get("required_fields"), list)
            or not provenance["required_fields"]
            or not all(isinstance(field, str) and field for field in provenance["required_fields"])
        ):
            raise ValueError(f"Analytical vector source {source_id} must define cache provenance")


def _validate_v1_registry(registry: dict[str, Any]) -> None:
    sources = _require_sources(registry)
    source_ids: set[str] = set()
    source_types: set[str] = set()
    for source in sources:
        if not isinstance(source, dict) or not V1_REQUIRED_SOURCE_FIELDS <= set(source):
            raise ValueError("Source registry v1 entry is missing required fields")
        source_id = source["id"]
        if not isinstance(source_id, str) or not source_id or source_id in source_ids:
            raise ValueError("Source registry IDs must be unique non-empty strings")
        source_ids.add(source_id)
        source_type = source["source_type"]
        if source_type not in {"analytical_vector", "manual_seed", "reference_overlay"}:
            raise ValueError(f"Unsupported v1 source type for {source_id}: {source_type}")
        source_types.add(source_type)
        if source_id == "kiut_gesut_wms" and source_type != "reference_overlay":
            raise ValueError("KIUT/GESUT WMS must remain a non-simulation reference overlay")
        if source_type == "analytical_vector" and not source.get("analytical_cache_provenance", {}).get("required_fields"):
            raise ValueError(f"Analytical source {source_id} must define cache provenance")
    if source_types != {"analytical_vector", "manual_seed", "reference_overlay"}:
        raise ValueError("Source registry v1 must contain analytical, manual and reference source classes")


def _require_sources(registry: dict[str, Any]) -> list[dict[str, Any]]:
    sources = registry.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Source registry must contain sources")
    return sources


def _require_enum(source: dict[str, Any], field: str, allowed: frozenset[str], source_id: str) -> None:
    if source.get(field) not in allowed:
        raise ValueError(f"Unsupported {field} for {source_id}: {source.get(field)}")


def _is_analytical_vector(source: dict[str, Any]) -> bool:
    if "source_type" in source:
        return source["source_type"] == "analytical_vector"
    return source["usage_role"] == "analytical" and source["data_kind"] == "vector"


def _cache_provenance_fields(source: dict[str, Any]) -> list[str]:
    provenance = source.get("cache_provenance") or source.get("analytical_cache_provenance")
    return list(provenance["required_fields"])


def _source_by_id(registry: dict[str, Any], source_id: str) -> dict[str, Any]:
    for source in registry["sources"]:
        if source["id"] == source_id:
            return source
    raise ValueError(f"Unknown source registry ID: {source_id}")


def _decision(
    source_id: str,
    requested_use: EligibilityUse,
    outcome: EligibilityOutcome,
    reason_code: str,
) -> SourceEligibilityDecision:
    return SourceEligibilityDecision(
        source_id=source_id,
        requested_use=requested_use,
        outcome=outcome,
        reason_code=reason_code,
    )
