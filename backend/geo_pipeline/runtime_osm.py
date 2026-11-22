"""On-demand, bounded OSM domain packs for selected runtime AOIs (public facade)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import requests

from geo_pipeline.domain_pack import build_map_presentation
from geo_pipeline.extract import (
    OVERPASS_ENDPOINTS,
    fetch_osm_features_geometry_with_endpoint,
)
from geo_pipeline.runtime.osm_categories import (
    QUERY_BY_DOMAIN as _QUERY_BY_DOMAIN,
)
from geo_pipeline.runtime.osm_categories import (
    clip_to_aoi as _clip_to_aoi,
)
from geo_pipeline.runtime.osm_categories import (
    domain_layers as _domain_layers,
)
from geo_pipeline.runtime.osm_categories import (
    geojson_collection as _geojson_collection,
)
from geo_pipeline.runtime.osm_publisher import (
    RUNTIME_PIPELINE_VERSION,
)
from geo_pipeline.runtime.osm_publisher import (
    pack_payload as _pack_payload,
)
from geo_pipeline.runtime.osm_publisher import (
    publish_runtime_osm_collection as _publish_runtime_osm_collection,
)
from geo_pipeline.runtime.osm_publisher import (
    refresh_runtime_osm_domain as _refresh_runtime_osm_domain,
)
from geo_pipeline.runtime.power_circuits import (
    backfill_power_circuit_evidence_for_member as _backfill_power_circuit_evidence_for_member,
)
from geo_pipeline.runtime.power_circuits import (
    digest as _digest,
)
from geo_pipeline.runtime.power_circuits import (
    fetch_power_circuit_relation_elements as _impl_fetch_power_circuit_relation_elements,
)
from geo_pipeline.runtime.power_circuits import (
    fetch_power_circuit_relation_elements_from_osm as _impl_fetch_relation_elements_from_osm,
)
from geo_pipeline.runtime.power_circuits import (
    fetch_power_circuit_relations_for_member as _impl_fetch_power_circuit_relations_for_member,
)
from geo_pipeline.runtime.power_circuits import (
    fetch_power_circuit_relations_for_member_from_osm as _impl_fetch_relations_for_member_from_osm,
)
from geo_pipeline.runtime.power_circuits import (
    overpass_polygon as _overpass_polygon,
)
from geo_pipeline.runtime.power_circuits import (
    power_relation_evidence as _power_relation_evidence,
)
from geo_pipeline.runtime.power_circuits import (
    unavailable_power_relation_evidence as _unavailable_power_relation_evidence,
)


def refresh_runtime_osm_domain(
    *, aoi: dict[str, Any], domain: str, root: Path, build_pmtiles: bool = True
) -> dict[str, Any]:
    """Acquire one qualified OSM profile, clip it to the true AOI and publish atomically."""
    return _refresh_runtime_osm_domain(
        aoi=aoi,
        domain=domain,
        root=root,
        build_pmtiles=build_pmtiles,
        geometry_fetcher=fetch_osm_features_geometry_with_endpoint,
        relation_elements_fetcher=_fetch_power_circuit_relation_elements,
        presentation_builder=build_map_presentation,
    )


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
) -> dict[str, Any]:
    """Publish already-acquired OSM GeoJSON; kept separate for offline contract tests."""
    return _publish_runtime_osm_collection(
        aoi=aoi,
        domain=domain,
        source=source,
        query_version=query_version,
        root=root,
        queried_feature_count=queried_feature_count,
        relation_elements=relation_elements,
        relation_evidence=relation_evidence,
        overpass_endpoint=overpass_endpoint,
        build_pmtiles=build_pmtiles,
        presentation_builder=build_map_presentation,
    )


def _fetch_power_circuit_relation_elements(
    geometry: dict[str, Any],
) -> list[dict[str, Any]]:
    """Read bounded OSM relation membership separately from OSMnx feature geometry."""
    return _impl_fetch_power_circuit_relation_elements(geometry, requests_post=requests.post)


def fetch_power_circuit_relations_for_member(source_id: str) -> list[dict[str, Any]]:
    """Read parent power-circuit relations for one delivered OSM member."""
    return _impl_fetch_power_circuit_relations_for_member(source_id, requests_get=requests.get)


def backfill_power_circuit_evidence_for_member(
    *, aoi: dict[str, Any], source_id: str, root: Path
) -> dict[str, Any]:
    """Attach narrow, source-backed circuit evidence to an existing power pack."""
    return _backfill_power_circuit_evidence_for_member(
        aoi=aoi,
        source_id=source_id,
        root=root,
        relations_fetcher=fetch_power_circuit_relations_for_member,
        presentation_builder=build_map_presentation,
    )


def _fetch_power_circuit_relations_for_member_from_osm(
    source_id: str,
) -> list[dict[str, Any]]:
    return _impl_fetch_relations_for_member_from_osm(source_id, requests_get=requests.get)


def _fetch_power_circuit_relation_elements_from_osm(
    geometry: dict[str, Any],
) -> list[dict[str, Any]]:
    return _impl_fetch_relation_elements_from_osm(geometry, requests_post=requests.post)


__all__ = [
    "OVERPASS_ENDPOINTS",
    "RUNTIME_PIPELINE_VERSION",
    "_QUERY_BY_DOMAIN",
    "_clip_to_aoi",
    "_digest",
    "_domain_layers",
    "_fetch_power_circuit_relation_elements",
    "_fetch_power_circuit_relation_elements_from_osm",
    "_fetch_power_circuit_relations_for_member_from_osm",
    "_geojson_collection",
    "_overpass_polygon",
    "_pack_payload",
    "_power_relation_evidence",
    "_unavailable_power_relation_evidence",
    "backfill_power_circuit_evidence_for_member",
    "build_map_presentation",
    "fetch_osm_features_geometry_with_endpoint",
    "fetch_power_circuit_relations_for_member",
    "publish_runtime_osm_collection",
    "refresh_runtime_osm_domain",
    "requests",
]
