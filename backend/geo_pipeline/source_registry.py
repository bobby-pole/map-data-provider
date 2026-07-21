"""Provider-owned source registry and analytical cache provenance validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from geo_pipeline.readiness import SOURCE_TYPES

SOURCE_REGISTRY_VERSION = "source_registry/v1"
REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "sources" / "registry.json"
REQUIRED_SOURCE_FIELDS = frozenset(
    {
        "id",
        "name",
        "source_type",
        "role",
        "access",
        "not_authoritative",
        "usable_for_simulation",
        "source_url",
        "attribution",
        "license",
        "distribution_guidance",
        "availability_caveats",
        "limitations",
    }
)


def load_source_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    """Load and validate the local, portable source-registry contract."""
    registry = json.loads(path.read_text(encoding="utf-8"))
    validate_source_registry(registry)
    return registry


def validate_source_registry(registry: dict[str, Any]) -> None:
    if registry.get("registry_version") != SOURCE_REGISTRY_VERSION:
        raise ValueError("Unsupported source registry version")
    sources = registry.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Source registry must contain sources")

    source_ids: set[str] = set()
    source_types: set[str] = set()
    for source in sources:
        if not isinstance(source, dict) or not REQUIRED_SOURCE_FIELDS <= set(source):
            raise ValueError("Source registry entry is missing required fields")
        source_id = source["id"]
        if not isinstance(source_id, str) or not source_id or source_id in source_ids:
            raise ValueError("Source registry IDs must be unique non-empty strings")
        source_ids.add(source_id)
        source_type = source["source_type"]
        if source_type not in SOURCE_TYPES:
            raise ValueError(f"Unsupported source type for {source_id}: {source_type}")
        if source_id == "kiut_gesut_wms" and source_type != "reference_overlay":
            raise ValueError("KIUT/GESUT WMS must remain a non-simulation reference overlay")
        source_types.add(source_type)
        if not isinstance(source["availability_caveats"], list) or not isinstance(source["limitations"], list):
            raise ValueError(f"Source {source_id} must provide availability caveats and limitations")

        if source_type == "analytical_vector":
            _validate_analytical_source(source)
        elif source.get("usable_for_simulation"):
            raise ValueError(f"Only analytical vector sources may be simulation inputs: {source_id}")

    if source_types != set(SOURCE_TYPES):
        raise ValueError("Source registry must contain analytical, manual and reference source classes")

    overlay = _source_by_id(registry, "kiut_gesut_wms")
    if overlay["source_type"] != "reference_overlay" or overlay["usable_for_simulation"]:
        raise ValueError("KIUT/GESUT WMS must remain a non-simulation reference overlay")
    if overlay.get("service_type") != "OGC WMS":
        raise ValueError("KIUT/GESUT registry entry must identify the WMS service")


def validate_analytical_cache_provenance(metadata: dict[str, Any], registry: dict[str, Any] | None = None) -> None:
    """Require a cache snapshot to retain the registry and query provenance it came from."""
    if metadata.get("source_type") != "analytical_vector":
        return
    registry = registry or load_source_registry()
    source_id = metadata.get("source_registry_id")
    if not isinstance(source_id, str):
        raise ValueError("Analytical cache metadata is missing source_registry_id")
    source = _source_by_id(registry, source_id)
    if source["source_type"] != "analytical_vector":
        raise ValueError("Analytical cache provenance must reference an analytical vector source")
    required_fields = source["analytical_cache_provenance"]["required_fields"]
    missing = [field for field in required_fields if not metadata.get(field)]
    if missing:
        raise ValueError(f"Analytical cache metadata is missing provenance fields: {', '.join(missing)}")
    if metadata["source_url"] != source["source_url"]:
        raise ValueError("Analytical cache source URL does not match the source registry")


def _validate_analytical_source(source: dict[str, Any]) -> None:
    provenance = source.get("analytical_cache_provenance")
    if not isinstance(provenance, dict) or not provenance.get("required_fields"):
        raise ValueError(f"Analytical source {source['id']} must define cache provenance")


def _source_by_id(registry: dict[str, Any], source_id: str) -> dict[str, Any]:
    for source in registry["sources"]:
        if source["id"] == source_id:
            return source
    raise ValueError(f"Unknown source registry ID: {source_id}")
