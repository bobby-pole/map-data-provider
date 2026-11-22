"""Power circuit OSM relation acquisition, evidence assembly, and narrow backfill."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from shapely.geometry import shape

from geo_pipeline.domain_pack import (
    PACK_DIRNAME,
    build_map_presentation,
    domain_pack_root,
    read_domain_pack,
    write_domain_pack,
)
from geo_pipeline.extract import OVERPASS_ENDPOINTS
from geo_pipeline.prepared_snapshot import (
    prepare_snapshot_domain_manifest_checksum_update,
    write_snapshot_manifest,
)
from geo_pipeline.source_registry import guard_source_access


def digest(payload: bytes) -> str:
    """Return lowercase SHA-256 hex digest for artifact bytes."""
    return hashlib.sha256(payload).hexdigest()


def fetch_power_circuit_relation_elements(
    geometry: dict[str, Any],
    *,
    requests_post: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Read bounded OSM relation membership separately from OSMnx feature geometry."""
    return guard_source_access(
        "openstreetmap",
        "acquisition",
        lambda: fetch_power_circuit_relation_elements_from_osm(
            geometry, requests_post=requests_post
        ),
    )


def fetch_power_circuit_relations_for_member(
    source_id_value: str,
    *,
    requests_get: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Read parent power-circuit relations for one delivered OSM member.

    This is deliberately a narrow recovery path for a cached power snapshot
    whose original full-AOI Overpass acquisition was rate limited.  It does
    not fetch or invent geometry outside the already delivered AOI pack.
    """
    if not re.fullmatch(r"(?:node|way|relation)/[1-9][0-9]*", source_id_value):
        raise ValueError("source_id must be an OSM node, way or relation identifier")
    return guard_source_access(
        "openstreetmap",
        "acquisition",
        lambda: fetch_power_circuit_relations_for_member_from_osm(
            source_id_value, requests_get=requests_get
        ),
    )


def backfill_power_circuit_evidence_for_member(
    *,
    aoi: dict[str, Any],
    source_id: str,
    root: Path,
    relations_fetcher: Callable[[str], list[dict[str, Any]]] | None = None,
    presentation_builder: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Attach narrow, source-backed circuit evidence to an existing power pack.

    The existing public geometry is retained verbatim.  Only parent
    ``power=circuit`` relations for the delivered selected OSM feature are
    requested, then only relation members already in that pack are exposed.
    """
    fetcher = relations_fetcher or fetch_power_circuit_relations_for_member
    builder = presentation_builder or build_map_presentation
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
    relation_evidence = power_relation_evidence(
        aoi["geometry"],
        {"type": "FeatureCollection", "features": source_features},
        fetcher(source_id),
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
            "sha256": digest(evidence_bytes),
            "source_provenance": [{"source_id": "openstreetmap", "contribution_role": "primary"}],
            "public_export": False,
        }
    )
    refreshed_manifest = {**manifest, "artifacts": artifacts}
    staging_root = root / f".backfill-stage-{uuid.uuid4().hex}"
    backup = pack_root.parent / f".{PACK_DIRNAME}-backup-{uuid.uuid4().hex}"
    moved_existing = False
    try:
        pack = write_domain_pack(
            aoi["aoi_id"], "power", root=staging_root, manifest=refreshed_manifest, files=files
        )
        staged_pack_root = domain_pack_root(aoi["aoi_id"], "power", root=staging_root)
        builder(pack_root=staged_pack_root, manifest=pack)
        read_domain_pack(aoi["aoi_id"], "power", root=staging_root)
        updated_snapshot = prepare_snapshot_domain_manifest_checksum_update(
            cache_root=root,
            aoi_id=aoi["aoi_id"],
            domain="power",
            manifest_bytes=(staged_pack_root / "manifest.json").read_bytes(),
        )
        if pack_root.exists():
            pack_root.replace(backup)
            moved_existing = True
        staged_pack_root.replace(pack_root)
        if updated_snapshot is not None:
            write_snapshot_manifest(root, aoi["aoi_id"], updated_snapshot)
    except Exception:
        if moved_existing and backup.exists():
            if pack_root.exists():
                shutil.rmtree(pack_root, ignore_errors=True)
            backup.replace(pack_root)
        raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
        shutil.rmtree(backup, ignore_errors=True)
    return relation_evidence


def fetch_power_circuit_relations_for_member_from_osm(
    source_id_value: str,
    *,
    requests_get: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Fetch XML parent relations for a delivered OSM element and retain power=circuit entries."""
    get = requests_get or requests.get
    element_type, element_id = source_id_value.split("/", 1)
    response = get(
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


def fetch_power_circuit_relation_elements_from_osm(
    geometry: dict[str, Any],
    *,
    requests_post: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    """Query Overpass for power=circuit relations and member skeletons inside polygonal AOI."""
    post = requests_post or requests.post
    polygonal = shape(geometry)
    if polygonal.geom_type not in {"Polygon", "MultiPolygon"} or polygonal.is_empty:
        raise ValueError("Power relation evidence requires a non-empty polygonal AOI")
    polygons = [polygonal] if polygonal.geom_type == "Polygon" else list(polygonal.geoms)
    blocks = "".join(
        f'relation["power"="circuit"](poly:"{overpass_polygon(polygon)}");' for polygon in polygons
    )
    query = f"[out:json][timeout:120];({blocks});out body;>;out skel qt;"
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = post(endpoint, data={"data": query}, timeout=180)
            response.raise_for_status()
            payload = response.json()
            elements = payload.get("elements") if isinstance(payload, dict) else None
            if (
                payload.get("remark")
                or not isinstance(elements, list)
                or not all(isinstance(element, dict) for element in elements)
            ):
                raise ValueError("Overpass relation response has no element list")
            return elements
        except Exception as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise RuntimeError("No Overpass endpoint configured")


def overpass_polygon(polygon: Any) -> str:
    """Format polygon exterior coordinates for an Overpass poly filter."""
    return " ".join(
        f"{latitude:.7f} {longitude:.7f}" for longitude, latitude in polygon.exterior.coords
    )


def power_relation_evidence(
    geometry: dict[str, Any], source: dict[str, Any], elements: list[dict[str, Any]]
) -> dict[str, Any]:
    """Keep only source-reported circuit members that are delivered inside this AOI."""
    delivered = {
        _extract_source_id(feature.get("properties", {})): feature
        for feature in source.get("features", [])
        if isinstance(feature, dict)
        and isinstance(feature.get("properties"), dict)
        and _extract_source_id(feature["properties"])
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
            member_source_id = f"{member['type']}/{member['ref']}"
            feature = delivered.get(member_source_id)
            if feature is None:
                continue
            record: dict[str, Any] = {
                "source_id": member_source_id,
                "role": str(member.get("role") or "member"),
            }
            if member["type"] == "way":
                way = ways.get(member_source_id)
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
        "source_checksum": digest(checksum_source),
        "relations": relations,
        "reverse_member_index": reverse_index,
    }


def unavailable_power_relation_evidence(
    geometry: dict[str, Any], error: Exception
) -> dict[str, Any]:
    """Build explicit unavailable-enrichment metadata when power relation fetch fails."""
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


def _extract_source_id(properties: dict[str, Any]) -> str | None:
    element, identifier = properties.get("element"), properties.get("id")
    if element in {"node", "way", "relation"} and isinstance(identifier, int):
        return f"{element}/{identifier}"
    source_id_value = properties.get("source_id")
    return (
        source_id_value
        if isinstance(source_id_value, str)
        and re.fullmatch(r"(?:node|way|relation)/[1-9][0-9]*", source_id_value)
        else None
    )
