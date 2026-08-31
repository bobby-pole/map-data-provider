"""On-demand, bounded OSM domain packs for selected runtime AOIs."""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
import requests
from shapely.geometry import mapping, shape

from geo_pipeline.bridges import (
    category_for_osm_feature as bridges_category_for_osm_feature,
)
from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.district_heating import (
    category_for_osm_feature as district_heating_category_for_osm_feature,
)
from geo_pipeline.domain_pack import (
    build_map_presentation,
    domain_pack_root,
    read_domain_pack,
    write_domain_pack,
)
from geo_pipeline.emergency import category_for_osm_feature
from geo_pipeline.extract import (
    OVERPASS_ENDPOINTS,
    configure_osmnx,
    fetch_osm_features_geometry_with_endpoint,
    sanitize_for_geojson,
)
from geo_pipeline.gas import category_for_osm_feature as gas_category_for_osm_feature
from geo_pipeline.industrial import (
    category_for_osm_feature as industrial_category_for_osm_feature,
)
from geo_pipeline.layers.power import _add_power_categories, _compact_power_properties
from geo_pipeline.public_services import (
    category_for_osm_feature as public_category_for_osm_feature,
)
from geo_pipeline.query_catalog import (
    BRIDGES_OSM_QUERY,
    DISTRICT_HEATING_OSM_QUERY,
    EMERGENCY_OSM_QUERY,
    GAS_OSM_QUERY,
    INDUSTRIAL_OSM_QUERY,
    POWER_OSM_QUERY,
    PUBLIC_OSM_QUERY,
    SEWER_OSM_QUERY,
    TELECOM_OSM_QUERY,
    TRANSPORT_OSM_QUERY,
    WATER_OSM_QUERY,
)
from geo_pipeline.sewer import (
    category_for_osm_feature as sewer_category_for_osm_feature,
)
from geo_pipeline.source_registry import guard_source_access
from geo_pipeline.telecom import (
    category_for_osm_feature as telecom_category_for_osm_feature,
)
from geo_pipeline.transport import (
    category_for_osm_feature as transport_category_for_osm_feature,
)
from geo_pipeline.transport import (
    road_class_for_osm_feature,
)
from geo_pipeline.water import (
    category_for_osm_feature as water_category_for_osm_feature,
)

RUNTIME_PIPELINE_VERSION = "geo_pipeline/runtime-osm/v6"
_QUERY_BY_DOMAIN = {
    "power": POWER_OSM_QUERY,
    "emergency": EMERGENCY_OSM_QUERY,
    "public": PUBLIC_OSM_QUERY,
    "transport": TRANSPORT_OSM_QUERY,
    "bridges": BRIDGES_OSM_QUERY,
    "water": WATER_OSM_QUERY,
    "gas": GAS_OSM_QUERY,
    "sewer": SEWER_OSM_QUERY,
    "industrial": INDUSTRIAL_OSM_QUERY,
    "telecom": TELECOM_OSM_QUERY,
    "district_heating": DISTRICT_HEATING_OSM_QUERY,
}


def refresh_runtime_osm_domain(*, aoi: dict[str, Any], domain: str, root: Path) -> dict[str, Any]:
    """Acquire one qualified OSM profile, clip it to the true AOI and publish PMTiles atomically."""
    query = _QUERY_BY_DOMAIN.get(domain)
    if query is None:
        raise ValueError(f"Runtime OSM acquisition is not enabled for domain: {domain}")
    configure_osmnx()
    raw_frame, overpass_endpoint = fetch_osm_features_geometry_with_endpoint(
        aoi["geometry"], query.tags
    )
    raw = sanitize_for_geojson(raw_frame)
    queried_feature_count = len(raw)
    if domain == "power":
        raw = _compact_power_properties(_add_power_categories(raw))
    elif domain == "emergency":
        raw = _add_emergency_categories(raw)
    elif domain == "public":
        raw = _add_public_categories(raw)
    elif domain == "transport":
        raw = _add_transport_categories(raw)
    elif domain == "bridges":
        raw = _add_bridges_categories(raw)
    elif domain == "water":
        raw = _add_water_categories(raw)
    elif domain == "gas":
        raw = _add_gas_categories(raw)
    elif domain == "sewer":
        raw = _add_sewer_categories(raw)
    elif domain == "telecom":
        raw = _add_telecom_categories(raw)
    elif domain == "district_heating":
        raw = _add_district_heating_categories(raw)
    else:
        raw = _add_industrial_categories(raw)
    source = _clip_to_aoi(_geojson_collection(raw), aoi["geometry"])
    relation_elements = None
    relation_evidence = None
    if domain == "power":
        try:
            relation_elements = _fetch_power_circuit_relation_elements(aoi["geometry"])
        except Exception as error:
            # Relation membership enriches power inspection, but it must not
            # discard a validated bounded power snapshot that is already ready.
            relation_evidence = _unavailable_power_relation_evidence(aoi["geometry"], error)
    return publish_runtime_osm_collection(
        aoi=aoi,
        domain=domain,
        source=source,
        query_version=query.query_version,
        root=root,
        queried_feature_count=queried_feature_count,
        relation_elements=relation_elements,
        relation_evidence=relation_evidence,
        overpass_endpoint=overpass_endpoint,
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
) -> dict[str, Any]:
    """Publish already-acquired OSM GeoJSON; kept separate for offline contract tests."""
    layers = _domain_layers(domain, source)
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
        else _power_relation_evidence(aoi["geometry"], source, relation_elements or [])
        if domain == "power"
        else None
    )
    manifest, files = _pack_payload(
        aoi=aoi,
        domain=domain,
        query_version=query_version,
        snapshot_at=snapshot_at,
        layers=layers,
        relation_evidence=relation_evidence,
        overpass_endpoint=overpass_endpoint,
    )
    pack = write_domain_pack(aoi["aoi_id"], domain, root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack
    )
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


def _add_emergency_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_public_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: public_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_transport_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: transport_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    filtered = enriched[enriched["provider_category"] != "other"].copy()
    if not filtered.empty:
        filtered["road_class"] = filtered.apply(
            lambda row: (
                road_class_for_osm_feature(dict(row))
                if row.get("provider_category") == "roads"
                else None
            ),
            axis=1,
        )
    return filtered


def _add_bridges_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: bridges_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_water_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: water_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_gas_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: gas_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_sewer_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: sewer_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_industrial_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: industrial_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_telecom_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: telecom_category_for_osm_feature(dict(row)) or "other", axis=1
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_district_heating_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(
        lambda row: district_heating_category_for_osm_feature(dict(row)) or "other",
        axis=1,
    )
    return enriched[enriched["provider_category"] != "other"].copy()


def _geojson_collection(frame: gpd.GeoDataFrame) -> dict[str, Any]:
    if frame.empty:
        return {"type": "FeatureCollection", "features": []}
    return json.loads(frame.to_json())


def _clip_to_aoi(collection: dict[str, Any], geometry: dict[str, Any]) -> dict[str, Any]:
    boundary = shape(geometry)
    features = []
    bb = boundary.bounds
    for feature in collection["features"]:
        geom_data = feature.get("geometry")
        if not isinstance(geom_data, dict):
            continue
        candidate = shape(geom_data)
        if candidate.is_empty:
            continue
        cb = candidate.bounds
        if (
            candidate.geom_type == "Point"
            and cb[0] >= bb[0]
            and cb[1] >= bb[1]
            and cb[2] <= bb[2]
            and cb[3] <= bb[3]
        ):
            features.append(feature)
            continue
        clipped = candidate.intersection(boundary)
        if clipped.is_empty or clipped.geom_type not in {
            "Point",
            "MultiPoint",
            "LineString",
            "MultiLineString",
            "Polygon",
            "MultiPolygon",
        }:
            continue
        features.append({**feature, "geometry": mapping(clipped)})
    return {"type": "FeatureCollection", "features": features}


def _domain_layers(domain: str, collection: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    if domain == "power":
        lines = [
            feature
            for feature in collection["features"]
            if feature["geometry"]["type"] in {"LineString", "MultiLineString"}
        ]
        assets = [
            feature
            for feature in collection["features"]
            if feature["geometry"]["type"] not in {"LineString", "MultiLineString"}
        ]
        return {
            key: value
            for key, value in {"power.lines": lines, "power.assets": assets}.items()
            if value
        }
    if domain == "emergency":
        return {"emergency.facilities": collection["features"]} if collection["features"] else {}
    if domain == "telecom":
        grouped = {"telecom.towers": [], "telecom.facilities": [], "telecom.lines": []}
        for feature in collection["features"]:
            category = feature.get("properties", {}).get("provider_category")
            if isinstance(category, str) and f"telecom.{category}" in grouped:
                grouped[f"telecom.{category}"].append(feature)
        if not any(grouped.values()):
            return {}
        inspection_points = []
        for layer_id, features in grouped.items():
            for feature in features:
                geometry = shape(feature["geometry"])
                if geometry.geom_type == "Point":
                    continue
                properties = dict(feature.get("properties", {}))
                properties.update(
                    {
                        "origin_artifact": layer_id,
                        "origin_source_id": f"{properties.get('element', 'feature')}/{properties.get('id')}",
                        "source_geometry_type": geometry.geom_type,
                    }
                )
                inspection_points.append(
                    {
                        "type": "Feature",
                        "properties": properties,
                        "geometry": mapping(geometry.representative_point()),
                    }
                )
        if inspection_points:
            grouped["telecom.inspection_points"] = inspection_points
        return grouped
    if domain == "district_heating":
        grouped = {
            "district_heating.plants": [],
            "district_heating.facilities": [],
            "district_heating.lines": [],
        }
        for feature in collection["features"]:
            category = feature.get("properties", {}).get("provider_category")
            layer_id = f"district_heating.{category}" if isinstance(category, str) else ""
            if layer_id in grouped:
                grouped[layer_id].append(feature)
        if not any(grouped.values()):
            return {}
        inspection_points = []
        for layer_id, features in grouped.items():
            for feature in features:
                geometry = shape(feature["geometry"])
                if geometry.geom_type != "Point":
                    properties = dict(feature.get("properties", {}))
                    properties.update(
                        {
                            "origin_artifact": layer_id,
                            "origin_source_id": f"{properties.get('element', 'feature')}/{properties.get('id')}",
                            "source_geometry_type": geometry.geom_type,
                        }
                    )
                    inspection_points.append(
                        {
                            "type": "Feature",
                            "properties": properties,
                            "geometry": mapping(geometry.representative_point()),
                        }
                    )
        if inspection_points:
            grouped["district_heating.inspection_points"] = inspection_points
        return grouped
    grouped: dict[str, list[dict[str, Any]]] = {}
    for feature in collection["features"]:
        category = feature.get("properties", {}).get("provider_category")
        if isinstance(category, str):
            grouped.setdefault(f"{domain}.{category}", []).append(feature)
    inspection_points = []
    for layer_id, features in grouped.items():
        for feature in features:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = dict(feature.get("properties", {}))
            properties.update(
                {
                    "origin_artifact": layer_id,
                    "origin_source_id": f"{properties.get('element', 'feature')}/{properties.get('id')}",
                    "source_geometry_type": geometry.geom_type,
                }
            )
            inspection_points.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    if inspection_points:
        grouped[f"{domain}.inspection_points"] = inspection_points
    return grouped


def _pack_payload(
    *,
    aoi: dict[str, Any],
    domain: str,
    query_version: str,
    snapshot_at: str,
    layers: dict[str, list[dict[str, Any]]],
    relation_evidence: dict[str, Any] | None = None,
    overpass_endpoint: str | None = None,
) -> tuple[dict[str, Any], dict[str, bytes]]:
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
                "sha256": _digest(payload),
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
                "sha256": _digest(relation_bytes),
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


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _fetch_power_circuit_relation_elements(
    geometry: dict[str, Any],
) -> list[dict[str, Any]]:
    """Read bounded OSM relation membership separately from OSMnx feature geometry."""
    return guard_source_access(
        "openstreetmap",
        "acquisition",
        lambda: _fetch_power_circuit_relation_elements_from_osm(geometry),
    )


def fetch_power_circuit_relations_for_member(source_id: str) -> list[dict[str, Any]]:
    """Read parent power-circuit relations for one delivered OSM member.

    This is deliberately a narrow recovery path for a cached power snapshot
    whose original full-AOI Overpass acquisition was rate limited.  It does
    not fetch or invent geometry outside the already delivered AOI pack.
    """
    if not re.fullmatch(r"(?:node|way|relation)/[1-9][0-9]*", source_id):
        raise ValueError("source_id must be an OSM node, way or relation identifier")
    return guard_source_access(
        "openstreetmap",
        "acquisition",
        lambda: _fetch_power_circuit_relations_for_member_from_osm(source_id),
    )


def backfill_power_circuit_evidence_for_member(
    *, aoi: dict[str, Any], source_id: str, root: Path
) -> dict[str, Any]:
    """Attach narrow, source-backed circuit evidence to an existing power pack.

    The existing public geometry is retained verbatim.  Only parent
    ``power=circuit`` relations for the delivered selected OSM feature are
    requested, then only relation members already in that pack are exposed.
    """
    pack_root = domain_pack_root(aoi["aoi_id"], "power", root=root)
    manifest = read_domain_pack(aoi["aoi_id"], "power", root=root)
    source_features: list[dict[str, Any]] = []
    files: dict[str, bytes] = {}
    artifacts = []
    for artifact in manifest["artifacts"]:
        if artifact["id"] == "power.osm_relation_evidence":
            continue
        path = artifact["path"]
        payload = (pack_root / path).read_bytes()
        files[path] = payload
        artifacts.append(artifact)
        if artifact["id"] in {"power.lines", "power.assets"}:
            layer = json.loads(payload)
            source_features.extend(layer.get("features", []))
    for section in ("validation", "readiness"):
        path = manifest[section]["path"]
        files[path] = (pack_root / path).read_bytes()
    relation_evidence = _power_relation_evidence(
        aoi["geometry"],
        {"type": "FeatureCollection", "features": source_features},
        fetch_power_circuit_relations_for_member(source_id),
    )
    evidence_path = "native/osm-relation-evidence.json"
    evidence_bytes = json.dumps(relation_evidence, ensure_ascii=False, indent=2).encode("utf-8")
    files[evidence_path] = evidence_bytes
    artifacts.append(
        {
            "id": "power.osm_relation_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": evidence_path,
            "sha256": _digest(evidence_bytes),
            "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}],
            "public_export": False,
        }
    )
    refreshed_manifest = {**manifest, "artifacts": artifacts}
    pack = write_domain_pack(
        aoi["aoi_id"], "power", root=root, manifest=refreshed_manifest, files=files
    )
    build_map_presentation(pack_root=pack_root, manifest=pack)
    read_domain_pack(aoi["aoi_id"], "power", root=root)
    return relation_evidence


def _fetch_power_circuit_relations_for_member_from_osm(
    source_id: str,
) -> list[dict[str, Any]]:
    element_type, element_id = source_id.split("/", 1)
    response = requests.get(
        f"https://api.openstreetmap.org/api/0.6/{element_type}/{element_id}/relations",
        timeout=60,
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)
    relations = []
    for relation in root.findall("relation"):
        try:
            relation_id = int(relation.attrib["id"])
        except KeyError, ValueError:
            continue
        tags = {
            tag.attrib["k"]: tag.attrib["v"]
            for tag in relation.findall("tag")
            if "k" in tag.attrib and "v" in tag.attrib
        }
        if tags.get("power") != "circuit":
            continue
        members = []
        for member in relation.findall("member"):
            member_type, member_ref = (
                member.attrib.get("type"),
                member.attrib.get("ref"),
            )
            if member_type not in {"node", "way", "relation"}:
                continue
            try:
                members.append(
                    {
                        "type": member_type,
                        "ref": int(member_ref),
                        "role": member.attrib.get("role", ""),
                    }
                )
            except TypeError, ValueError:
                continue
        relations.append({"type": "relation", "id": relation_id, "tags": tags, "members": members})
    return relations


def _fetch_power_circuit_relation_elements_from_osm(
    geometry: dict[str, Any],
) -> list[dict[str, Any]]:
    polygonal = shape(geometry)
    if polygonal.geom_type not in {"Polygon", "MultiPolygon"} or polygonal.is_empty:
        raise ValueError("Power relation evidence requires a non-empty polygonal AOI")
    polygons = [polygonal] if polygonal.geom_type == "Polygon" else list(polygonal.geoms)
    blocks = "".join(
        f'relation["power"="circuit"](poly:"{_overpass_polygon(polygon)}");' for polygon in polygons
    )
    query = f"[out:json][timeout:120];({blocks});out body;>;out skel qt;"
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = requests.post(f"{endpoint}/interpreter", data={"data": query}, timeout=180)
            response.raise_for_status()
            payload = response.json()
            elements = payload.get("elements") if isinstance(payload, dict) else None
            if not isinstance(elements, list) or not all(
                isinstance(element, dict) for element in elements
            ):
                raise ValueError("Overpass relation response has no element list")
            return elements
        except Exception as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise RuntimeError("No Overpass endpoint configured")


def _overpass_polygon(polygon: Any) -> str:
    return " ".join(
        f"{latitude:.7f} {longitude:.7f}" for longitude, latitude in polygon.exterior.coords
    )


def _power_relation_evidence(
    geometry: dict[str, Any], source: dict[str, Any], elements: list[dict[str, Any]]
) -> dict[str, Any]:
    """Keep only source-reported circuit members that are delivered inside this AOI."""
    delivered = {
        _source_id(feature.get("properties", {})): feature
        for feature in source.get("features", [])
        if isinstance(feature, dict)
        and isinstance(feature.get("properties"), dict)
        and _source_id(feature["properties"])
    }
    ways = {
        f"way/{element['id']}": element
        for element in elements
        if element.get("type") == "way" and isinstance(element.get("id"), int)
    }
    relations = []
    for relation in elements:
        if relation.get("type") != "relation" or not isinstance(relation.get("id"), int):
            continue
        tags = relation.get("tags")
        members = relation.get("members")
        if (
            not isinstance(tags, dict)
            or tags.get("power") != "circuit"
            or not isinstance(members, list)
        ):
            continue
        retained = []
        for member in members:
            if (
                not isinstance(member, dict)
                or member.get("type") not in {"node", "way", "relation"}
                or not isinstance(member.get("ref"), int)
            ):
                continue
            source_id = f"{member['type']}/{member['ref']}"
            feature = delivered.get(source_id)
            if feature is None:
                continue
            record: dict[str, Any] = {
                "source_id": source_id,
                "role": str(member.get("role") or "member"),
            }
            if member["type"] == "way":
                way = ways.get(source_id)
                node_ids = way.get("nodes") if isinstance(way, dict) else None
                if (
                    isinstance(node_ids, list)
                    and len(node_ids) >= 2
                    and isinstance(node_ids[0], int)
                    and isinstance(node_ids[-1], int)
                ):
                    record["endpoint_evidence"] = {
                        "start": f"node/{node_ids[0]}",
                        "end": f"node/{node_ids[-1]}",
                    }
            feature_geometry = feature.get("geometry")
            if (
                isinstance(feature_geometry, dict)
                and feature_geometry.get("type") == "LineString"
                and isinstance(feature_geometry.get("coordinates"), list)
                and len(feature_geometry["coordinates"]) >= 2
            ):
                record["geometry"] = feature_geometry
            elif member["type"] == "way":
                record["availability"] = (
                    "Member is delivered in the AOI but has no retained LineString geometry."
                )
            retained.append(record)
        if retained:
            relations.append(
                {
                    "relation_id": f"relation/{relation['id']}",
                    "tags": {str(key): str(value) for key, value in tags.items()},
                    "aoi_coverage": "bounded_source_snapshot",
                    "limitations": [
                        "Only OSM circuit members delivered inside this bounded AOI are retained.",
                        "No topology, connectivity, flow, outage or cascade is inferred.",
                    ],
                    "members": retained,
                }
            )
    reverse_index: dict[str, list[str]] = {}
    for relation in relations:
        for member in relation["members"]:
            reverse_index.setdefault(member["source_id"], []).append(relation["relation_id"])
    boundary = shape(geometry).bounds
    checksum_source = json.dumps(
        elements, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return {
        "relation_evidence_version": "osm_power_relation_evidence/v2",
        "source": "OpenStreetMap",
        "snapshot_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "bbox": [boundary[0], boundary[1], boundary[2], boundary[3]],
        "source_checksum": _digest(checksum_source),
        "relations": relations,
        "reverse_member_index": reverse_index,
    }


def _unavailable_power_relation_evidence(
    geometry: dict[str, Any], error: Exception
) -> dict[str, Any]:
    boundary = shape(geometry).bounds
    return {
        "relation_evidence_version": "osm_power_relation_evidence/v2",
        "source": "OpenStreetMap",
        "snapshot_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "bbox": [boundary[0], boundary[1], boundary[2], boundary[3]],
        "source_checksum": None,
        "relations": [],
        "reverse_member_index": {},
        "availability": "unavailable",
        "limitations": [
            "The bounded power geometry was acquired, but its optional OSM circuit-relation enrichment was unavailable.",
            f"Relation acquisition error: {error}",
            "No circuit membership, topology, connectivity, flow, outage or cascade is inferred.",
        ],
    }


def _source_id(properties: dict[str, Any]) -> str | None:
    element, identifier = properties.get("element"), properties.get("id")
    if element in {"node", "way", "relation"} and isinstance(identifier, int):
        return f"{element}/{identifier}"
    source_id = properties.get("source_id")
    return (
        source_id
        if isinstance(source_id, str)
        and re.fullmatch(r"(?:node|way|relation)/[1-9][0-9]*", source_id)
        else None
    )
