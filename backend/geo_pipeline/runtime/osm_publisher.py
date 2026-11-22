"""Runtime OSM domain pack assembly, publication, and timed acquisition orchestration."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.domain_pack import (
    build_map_presentation,
    domain_pack_root,
    read_domain_pack,
    write_domain_pack,
)
from geo_pipeline.extract import (
    configure_osmnx,
    fetch_osm_features_geometry_with_endpoint,
    sanitize_for_geojson,
)
from geo_pipeline.runtime.osm_categories import (
    QUERY_BY_DOMAIN,
    categorize_domain_frame,
    clip_to_aoi,
    domain_layers,
    geojson_collection,
)
from geo_pipeline.runtime.power_circuits import (
    digest,
    fetch_power_circuit_relation_elements,
    power_relation_evidence,
    unavailable_power_relation_evidence,
)

RUNTIME_PIPELINE_VERSION = "geo_pipeline/runtime-osm/v6"


def refresh_runtime_osm_domain(
    *,
    aoi: dict[str, Any],
    domain: str,
    root: Path,
    build_pmtiles: bool = True,
    geometry_fetcher: Callable[..., Any] | None = None,
    relation_elements_fetcher: Callable[[dict[str, Any]], list[dict[str, Any]]] | None = None,
    presentation_builder: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Acquire one qualified OSM profile, clip it to the true AOI and publish atomically."""
    query = QUERY_BY_DOMAIN.get(domain)
    if query is None:
        raise ValueError(f"Runtime OSM acquisition is not enabled for domain: {domain}")
    fetch_geometry = geometry_fetcher or fetch_osm_features_geometry_with_endpoint
    fetch_relations = relation_elements_fetcher or fetch_power_circuit_relation_elements
    started = time.monotonic()
    configure_osmnx()
    raw_frame, overpass_endpoint = fetch_geometry(aoi["geometry"], query.tags)
    acquired_at = time.monotonic()
    raw = sanitize_for_geojson(raw_frame)
    queried_feature_count = len(raw)
    raw = categorize_domain_frame(domain, raw)
    source = clip_to_aoi(geojson_collection(raw), aoi["geometry"])
    relation_elements = None
    relation_evidence = None
    relation_started = time.monotonic()
    if domain == "power":
        try:
            relation_elements = fetch_relations(aoi["geometry"])
        except Exception as error:
            # Relation membership enriches power inspection, but it must not
            # discard a validated bounded power snapshot that is already ready.
            relation_evidence = unavailable_power_relation_evidence(aoi["geometry"], error)
    processed_at = time.monotonic()
    result = publish_runtime_osm_collection(
        aoi=aoi,
        domain=domain,
        source=source,
        query_version=query.query_version,
        root=root,
        queried_feature_count=queried_feature_count,
        relation_elements=relation_elements,
        relation_evidence=relation_evidence,
        overpass_endpoint=overpass_endpoint,
        build_pmtiles=build_pmtiles,
        presentation_builder=presentation_builder,
    )
    published_at = time.monotonic()
    return {
        **result,
        "stage_durations_ms": {
            "acquisition": int(
                ((acquired_at - started) + (processed_at - relation_started)) * 1000
            ),
            "processing": int((relation_started - acquired_at) * 1000),
            "pack_publication": int((published_at - processed_at) * 1000),
        },
    }


def publish_runtime_osm_collection(
    *,
    aoi: dict[str, Any],
    domain: str,
    source: dict[str, Any],
    query_version: str,
    root: Path,
    queried_feature_count: int | None = None,
    relation_elements: list[dict[str, Any]] | None = None,
    relation_evidence: dict[str, Any] | None = None,
    overpass_endpoint: str | None = None,
    build_pmtiles: bool = True,
    presentation_builder: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Publish already-acquired OSM GeoJSON; kept separate for offline contract tests."""
    builder = presentation_builder or build_map_presentation
    layers = domain_layers(domain, source)
    if not layers:
        return {
            "status": "needs_source",
            "detail": "The qualified OpenStreetMap query returned no renderable features inside this AOI.",
            "artifact_aoi_id": None,
            "cache_status": "missing",
            "queried_feature_count": queried_feature_count
            if queried_feature_count is not None
            else len(source["features"]),
            "accepted_feature_count": 0,
            "derived_feature_count": 0,
        }
    snapshot_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    relation_evidence = (
        relation_evidence
        if relation_evidence is not None
        else power_relation_evidence(aoi["geometry"], source, relation_elements or [])
        if domain == "power"
        else None
    )
    manifest, files = pack_payload(
        aoi=aoi,
        domain=domain,
        query_version=query_version,
        snapshot_at=snapshot_at,
        layers=layers,
        relation_evidence=relation_evidence,
        overpass_endpoint=overpass_endpoint,
    )
    pack = write_domain_pack(aoi["aoi_id"], domain, root=root, manifest=manifest, files=files)
    if build_pmtiles:
        builder(pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack)
    read_domain_pack(aoi["aoi_id"], domain, root=root)
    derived_feature_count = len(layers.get(f"{domain}.inspection_points", []))
    accepted_feature_count = sum(
        len(features)
        for layer_id, features in layers.items()
        if layer_id != f"{domain}.inspection_points"
    )
    return {
        "status": "ready",
        "detail": "A bounded OpenStreetMap runtime artifact was acquired, validated and cached for this AOI.",
        "artifact_aoi_id": aoi["aoi_id"],
        "cache_status": "fresh",
        "queried_feature_count": queried_feature_count
        if queried_feature_count is not None
        else accepted_feature_count,
        "accepted_feature_count": accepted_feature_count,
        "derived_feature_count": derived_feature_count,
        "overpass_endpoint": overpass_endpoint,
    }


def pack_payload(
    *,
    aoi: dict[str, Any],
    domain: str,
    query_version: str,
    snapshot_at: str,
    layers: dict[str, list[dict[str, Any]]],
    relation_evidence: dict[str, Any] | None = None,
    overpass_endpoint: str | None = None,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Build manifest and serialized artifact bytes for a runtime OSM domain pack."""
    limitations = [
        "OSM completeness varies by area and object type.",
        "A passed provider validation does not prove complete real-world infrastructure coverage.",
        "This is an on-demand bounded snapshot; refresh after 24 hours to obtain a new source response.",
    ]
    provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    files: dict[str, bytes] = {}
    artifacts = []
    first_metadata: dict[str, Any] | None = None
    for layer_id, features in layers.items():
        layer_readiness = (
            "needs_source"
            if layer_id in {"telecom.lines", "district_heating.lines"} and not features
            else "usable_with_limitations"
        )
        metadata = {
            "cache_layout_version": "provider_cache/v1",
            "geojson_contract_version": "provider_geojson/v1",
            "aoi_id": aoi["aoi_id"],
            "domain": domain,
            "layer_id": layer_id,
            "source": "OpenStreetMap",
            "source_type": "analytical_vector",
            "source_registry_id": "openstreetmap",
            "source_url": overpass_endpoint or "https://overpass-api.de/api/interpreter",
            "source_query": f"On-demand bounded OSM query for {domain} inside resolved provider AOI.",
            "snapshot_at": snapshot_at,
            "pipeline_version": RUNTIME_PIPELINE_VERSION,
            "query_version": query_version,
            "validation_status_raw": "warning",
            "quality_status": "warning",
            "confidence": "medium",
            "limitations": limitations,
            "eligible_for_analysis": True,
            "readiness": layer_readiness,
        }
        layer = normalize_analytical_vector_layer(
            {"type": "FeatureCollection", "features": features}, metadata=metadata
        )
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode("utf-8")
        relative = f"layers/{layer_id}.geojson"
        files[relative] = payload
        artifacts.append(
            {
                "id": layer_id,
                "kind": "processed_vector",
                "format": "geojson",
                "path": relative,
                "sha256": digest(payload),
                "feature_count": len(layer["features"]),
                "source_provenance": provenance,
                "public_export": True,
            }
        )
        first_metadata = layer["metadata"]
    assert first_metadata is not None
    if relation_evidence is not None:
        relation_bytes = json.dumps(relation_evidence, ensure_ascii=False, indent=2).encode("utf-8")
        relation_path = "native/osm-relation-evidence.json"
        files[relation_path] = relation_bytes
        artifacts.append(
            {
                "id": "power.osm_relation_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": relation_path,
                "sha256": digest(relation_bytes),
                "source_provenance": provenance,
                "public_export": False,
            }
        )
    readiness = {
        "cache_layout_version": "provider_cache/v1",
        "aoi_id": aoi["aoi_id"],
        "domain": domain,
        "layer_id": first_metadata["layer_id"],
        "readiness": "usable_with_limitations",
        "quality_status": "warning",
        "highest_issue_severity": "medium",
        "feature_count": first_metadata["feature_count"],
        "evaluated_at": snapshot_at,
    }
    files["validation/metadata.json"] = json.dumps(
        first_metadata, ensure_ascii=False, indent=2
    ).encode("utf-8")
    files["readiness/readiness.json"] = json.dumps(readiness, ensure_ascii=False, indent=2).encode(
        "utf-8"
    )
    return (
        {
            "domain_pack_version": "provider_domain_pack/v2",
            "aoi_id": aoi["aoi_id"],
            "domain": domain,
            "source_provenance": provenance,
            "artifacts": artifacts,
            "validation": {"path": "validation/metadata.json"},
            "readiness": {"path": "readiness/readiness.json"},
        },
        files,
    )
