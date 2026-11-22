"""Parameterized Rybnik 35 km domain-pack builders."""

from __future__ import annotations

import json
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import BACKEND_DIR
from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.domains.bridges import (
    BRIDGES_FIXTURE,
    BRIDGES_LIMITATIONS,
    build_osm_bridges_layers,
)
from geo_pipeline.domains.bridges import (
    FACILITY_MAPPINGS as BRIDGES_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.district_heating import (
    DISTRICT_HEATING_CATEGORIES,
    DISTRICT_HEATING_FIXTURE,
    DISTRICT_HEATING_LIMITATIONS,
    build_osm_district_heating_layers,
)
from geo_pipeline.domains.emergency import (
    EMERGENCY_FIXTURE,
    EMERGENCY_LIMITATIONS,
    PRG_EMERGENCY_FIXTURE,
    PRG_EMERGENCY_LIMITATIONS,
    build_osm_emergency_layers,
    build_prg_emergency_layers,
)
from geo_pipeline.domains.gas import (
    FACILITY_MAPPINGS as GAS_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.gas import (
    GAS_FIXTURE,
    GAS_LIMITATIONS,
    build_osm_gas_layers,
)
from geo_pipeline.domains.industrial import (
    INDUSTRIAL_FACILITY_MAPPINGS,
    INDUSTRIAL_FIXTURE,
    INDUSTRIAL_LIMITATIONS,
    build_osm_industrial_layers,
)
from geo_pipeline.domains.public_services import (
    FACILITY_MAPPINGS as PUBLIC_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.public_services import (
    PUBLIC_SERVICES_FIXTURE,
    PUBLIC_SERVICES_LIMITATIONS,
    build_osm_public_service_layers,
)
from geo_pipeline.domains.sewer import (
    FACILITY_MAPPINGS as SEWER_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.sewer import (
    SEWER_FIXTURE,
    SEWER_LIMITATIONS,
    build_osm_sewer_layers,
)
from geo_pipeline.domains.telecom import (
    TELECOM_CATEGORIES,
    TELECOM_FIXTURE,
    TELECOM_LIMITATIONS,
    build_osm_telecom_layers,
)
from geo_pipeline.domains.transport import (
    FACILITY_MAPPINGS as TRANSPORT_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.transport import (
    TRANSPORT_FIXTURE,
    TRANSPORT_LIMITATIONS,
    build_osm_transport_layers,
)
from geo_pipeline.domains.water import (
    FACILITY_MAPPINGS as WATER_FACILITY_MAPPINGS,
)
from geo_pipeline.domains.water import (
    WATER_FIXTURE,
    WATER_LIMITATIONS,
    build_osm_water_layers,
)
from geo_pipeline.packs.representative_points import (
    build_domain_inspection_points,
    representative_points_layer,
)
from geo_pipeline.packs.store import (
    DOMAIN_PACK_VERSION,
    _digest,
    _merge_osm_attributes,
    _read_json,
    domain_pack_root,
    write_domain_pack,
)
from geo_pipeline.source_registry import guard_source_access
from geo_pipeline.vector_tiles import build_map_presentation

POWER_ASSETS_SOURCE = (
    BACKEND_DIR
    / "data/fixtures/rybnik_35km/power/rybnik_35km_power_node_points_display_clipped.geojson"
)
POWER_SUPPORTS_SOURCE = (
    BACKEND_DIR / "data/fixtures/rybnik_35km/power/osm-power-supports-full.geojson"
)
POWER_RELATIONS_SOURCE = (
    BACKEND_DIR / "data/fixtures/rybnik_35km/power/osm-power-circuit-evidence.json"
)
POWER_ATTRIBUTES_SOURCE = BACKEND_DIR / "data/fixtures/rybnik_35km/power/osm-power-attributes.json"
POWER_ASSETS_QUERY = (
    "OSMnx power and utility-pole point features from the committed Rybnik 35 km AOI snapshot."
)
POWER_SUPPORTS_QUERY = (
    "Captured bounded OpenStreetMap power-support snapshot for the committed Rybnik 35 km AOI."
)

OSM_PRIMARY = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
KIUT_REFERENCE = [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}]
PRG_SUPPLEMENTARY = {"source_id": "prg_wfs", "contribution_role": "supplementary"}
BDOT10K_SUPPLEMENTARY = {"source_id": "bdot10k", "contribution_role": "supplementary"}


def _encode_json(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode()


@dataclass(frozen=True)
class _OsmFixtureDomainSpec:
    domain: str
    build_layers: Callable[..., dict[str, dict[str, Any]]]
    fixture_path: Path
    evidence_filename: str
    evidence_extra: dict[str, Any]
    limitations: list[str]
    inspection_error_label: str
    categories_order: tuple[str, ...] | None = None
    skip_points: bool = True
    metadata_layer: str | None = None
    include_origin_source_id: bool = True
    context_filename: str | None = None
    context_payload: dict[str, Any] | None = None
    include_kiut_reference: bool = False
    manifest_source_provenance: list[dict[str, str]] | None = None


def _build_rybnik_osm_fixture_pack(
    spec: _OsmFixtureDomainSpec,
    *,
    root: Path,
    extra_artifacts: Callable[[str, dict[str, bytes], list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    legacy = read_cached_layer(cache_paths("rybnik_35km", spec.domain, root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = spec.build_layers(readiness=readiness)
    files: dict[str, bytes] = {
        "validation/metadata.json": _encode_json(legacy["metadata"]),
        "readiness/readiness.json": _encode_json(legacy["readiness"]),
    }
    artifacts: list[dict[str, Any]] = []
    ordered_categories = (
        spec.categories_order if spec.categories_order is not None else tuple(layers.keys())
    )
    for category in ordered_categories:
        layer = layers[category]
        path = f"layers/{spec.domain}.{category}.geojson"
        payload = _encode_json(layer)
        files[path] = payload
        artifacts.append(
            {
                "id": f"{spec.domain}.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": OSM_PRIMARY,
                "public_export": True,
            }
        )

    if extra_artifacts is not None:
        extra_artifacts(readiness, files, artifacts)

    points = build_domain_inspection_points(
        spec.domain,
        layers,
        error_label=spec.inspection_error_label,
        skip_points=spec.skip_points,
        metadata_layer=spec.metadata_layer,
        include_origin_source_id=spec.include_origin_source_id,
    )
    points_payload = _encode_json(points)
    points_path = f"layers/{spec.domain}.inspection_points.geojson"
    files[points_path] = points_payload
    artifacts.append(
        {
            "id": f"{spec.domain}.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": points_path,
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": OSM_PRIMARY,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(spec.fixture_path.relative_to(BACKEND_DIR)),
        "sha256": _digest(spec.fixture_path.read_bytes()),
        **spec.evidence_extra,
        "limitations": spec.limitations,
    }
    evidence_payload = _encode_json(evidence)
    evidence_path = f"native/{spec.evidence_filename}"
    files[evidence_path] = evidence_payload
    artifacts.append(
        {
            "id": f"{spec.domain}.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": evidence_path,
            "sha256": _digest(evidence_payload),
            "source_provenance": OSM_PRIMARY,
            "public_export": False,
        }
    )

    if spec.context_filename is not None and spec.context_payload is not None:
        context_payload = _encode_json(spec.context_payload)
        context_path = f"native/{spec.context_filename}"
        files[context_path] = context_payload
        artifacts.append(
            {
                "id": f"{spec.domain}.context_and_comparison",
                "kind": "native_vector",
                "format": "json",
                "path": context_path,
                "sha256": _digest(context_payload),
                "source_provenance": [PRG_SUPPLEMENTARY, BDOT10K_SUPPLEMENTARY],
                "public_export": False,
            }
        )

    if spec.include_kiut_reference:
        artifacts.append(
            {
                "id": f"{spec.domain}.kiut_reference",
                "kind": "remote_service",
                "format": "wms",
                "source_provenance": KIUT_REFERENCE,
                "public_export": False,
            }
        )

    if spec.manifest_source_provenance is not None:
        source_provenance = spec.manifest_source_provenance
    elif spec.include_kiut_reference:
        source_provenance = [*OSM_PRIMARY, *KIUT_REFERENCE]
    else:
        source_provenance = [*OSM_PRIMARY, PRG_SUPPLEMENTARY, BDOT10K_SUPPLEMENTARY]

    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": spec.domain,
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", spec.domain, root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", spec.domain, root=root), manifest=pack
    )
    return pack


def _mapping_entries(mappings: dict[Any, list[tuple[str, str]]]) -> dict[str, list[str]]:
    return {
        category: [f"{key}={value}" for key, value in pairs] for category, pairs in mappings.items()
    }


def build_rybnik_power_domain_pack(*, root: Path) -> dict[str, Any]:
    legacy = read_cached_layer(cache_paths("rybnik_35km", "power", root=root))
    metadata_bytes = _encode_json(legacy["metadata"])
    readiness_bytes = _encode_json(legacy["readiness"])
    assets_source = guard_source_access(
        "openstreetmap", "local_import", lambda: _read_json(POWER_ASSETS_SOURCE)
    )
    assets = normalize_analytical_vector_layer(
        assets_source,
        metadata={
            **legacy["metadata"],
            "layer_id": "power.assets",
            "source_query": POWER_ASSETS_QUERY,
        },
    )
    assets["metadata"]["readiness"] = legacy["readiness"]["readiness"]
    attributes_source = guard_source_access(
        "openstreetmap", "local_import", lambda: _read_json(POWER_ATTRIBUTES_SOURCE)
    )
    _merge_osm_attributes(assets, attributes_source)
    assets_bytes = _encode_json(assets)
    supports_source = guard_source_access(
        "openstreetmap", "local_import", lambda: _read_json(POWER_SUPPORTS_SOURCE)
    )
    supports = normalize_analytical_vector_layer(
        supports_source,
        metadata={
            **legacy["metadata"],
            "layer_id": "power.supports",
            "source_query": POWER_SUPPORTS_QUERY,
        },
    )
    supports["metadata"]["readiness"] = legacy["readiness"]["readiness"]
    _merge_osm_attributes(supports, attributes_source)
    supports_bytes = _encode_json(supports)
    relation_evidence_bytes = _encode_json(
        guard_source_access(
            "openstreetmap", "local_import", lambda: _read_json(POWER_RELATIONS_SOURCE)
        )
    )
    lines = deepcopy(legacy["layer"])
    _merge_osm_attributes(lines, attributes_source)
    layer_bytes = _encode_json(lines)
    representative_points = representative_points_layer(lines)
    representative_points_bytes = _encode_json(representative_points)
    source_provenance = [*OSM_PRIMARY, *KIUT_REFERENCE]
    source_evidence_bytes = _encode_json(
        {
            "source_registry_id": legacy["metadata"]["source_registry_id"],
            "source_url": legacy["metadata"]["source_url"],
            "source_query": legacy["metadata"]["source_query"],
            "snapshot_at": legacy["metadata"]["snapshot_at"],
            "pipeline_version": legacy["metadata"]["pipeline_version"],
            "query_version": legacy["metadata"]["query_version"],
            "attribute_snapshot_at": attributes_source["snapshot_at"],
            "attribute_source_checksum": attributes_source["source_checksum"],
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "power",
        "source_provenance": source_provenance,
        "artifacts": [
            {
                "id": "power.lines",
                "kind": "processed_vector",
                "format": "geojson",
                "path": "layers/power.lines.geojson",
                "sha256": _digest(layer_bytes),
                "feature_count": legacy["metadata"]["feature_count"],
                "source_provenance": OSM_PRIMARY,
                "public_export": True,
            },
            {
                "id": "power.assets",
                "kind": "processed_vector",
                "format": "geojson",
                "path": "layers/power.assets.geojson",
                "sha256": _digest(assets_bytes),
                "feature_count": assets["metadata"]["feature_count"],
                "source_provenance": OSM_PRIMARY,
                "public_export": True,
            },
            {
                "id": "power.supports",
                "kind": "processed_vector",
                "format": "geojson",
                "path": "layers/power.supports.geojson",
                "sha256": _digest(supports_bytes),
                "feature_count": supports["metadata"]["feature_count"],
                "source_provenance": OSM_PRIMARY,
                "public_export": True,
            },
            {
                "id": "power.representative_points",
                "kind": "representative_points",
                "format": "geojson",
                "path": "layers/power.representative_points.geojson",
                "sha256": _digest(representative_points_bytes),
                "feature_count": representative_points["metadata"]["feature_count"],
                "source_provenance": OSM_PRIMARY,
                "public_export": False,
            },
            {
                "id": "power.osm_source_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": "native/osm-source-evidence.json",
                "sha256": _digest(source_evidence_bytes),
                "source_provenance": OSM_PRIMARY,
                "public_export": False,
            },
            {
                "id": "power.osm_relation_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": "native/osm-relation-evidence.json",
                "sha256": _digest(relation_evidence_bytes),
                "source_provenance": OSM_PRIMARY,
                "public_export": False,
            },
            {
                "id": "power.kiut_reference",
                "kind": "remote_service",
                "format": "wms",
                "source_provenance": KIUT_REFERENCE,
                "public_export": False,
            },
        ],
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack(
        "rybnik_35km",
        "power",
        root=root,
        manifest=manifest,
        files={
            "layers/power.lines.geojson": layer_bytes,
            "layers/power.assets.geojson": assets_bytes,
            "layers/power.supports.geojson": supports_bytes,
            "layers/power.representative_points.geojson": representative_points_bytes,
            "native/osm-source-evidence.json": source_evidence_bytes,
            "native/osm-relation-evidence.json": relation_evidence_bytes,
            "validation/metadata.json": metadata_bytes,
            "readiness/readiness.json": readiness_bytes,
        },
    )
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "power", root=root), manifest=pack
    )
    return pack


def build_rybnik_emergency_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build a source-separated emergency pack from committed fixture evidence."""
    prg_provenance = [PRG_SUPPLEMENTARY]

    def _add_prg_layers(
        readiness: str, files: dict[str, bytes], artifacts: list[dict[str, Any]]
    ) -> None:
        for category, layer in build_prg_emergency_layers(readiness=readiness).items():
            path = f"layers/emergency.official_{category}.geojson"
            payload = _encode_json(layer)
            files[path] = payload
            artifacts.append(
                {
                    "id": f"emergency.official_{category}",
                    "kind": "representative_points",
                    "format": "geojson",
                    "path": path,
                    "sha256": _digest(payload),
                    "feature_count": layer["metadata"]["feature_count"],
                    "source_provenance": prg_provenance,
                    "public_export": False,
                }
            )
        prg_evidence = {
            "source_registry_id": "prg_wfs",
            "mapped_feature_types": [
                "ms:K02_Komenda_powiatowa_policji",
                "ms:K07_Komenda_powiatowa_strazy_pozarnej",
            ],
            "fixture": str(PRG_EMERGENCY_FIXTURE.relative_to(BACKEND_DIR)),
            "fixture_sha256": _digest(PRG_EMERGENCY_FIXTURE.read_bytes()),
            "publication": "PRG representative points remain private source evidence until product-specific redistribution terms are recorded.",
            "limitations": PRG_EMERGENCY_LIMITATIONS,
        }
        prg_payload = _encode_json(prg_evidence)
        files["native/prg-police-fire-source-evidence.json"] = prg_payload
        artifacts.append(
            {
                "id": "emergency.prg_police_fire_source_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": "native/prg-police-fire-source-evidence.json",
                "sha256": _digest(prg_payload),
                "source_provenance": prg_provenance,
                "public_export": False,
            }
        )

    spec = _OsmFixtureDomainSpec(
        domain="emergency",
        build_layers=build_osm_emergency_layers,
        fixture_path=EMERGENCY_FIXTURE,
        evidence_filename="osm-emergency-source-evidence.json",
        evidence_extra={
            "category_mappings": {
                "hospital": ["amenity=hospital", "healthcare=hospital"],
                "fire_service": ["amenity=fire_station"],
                "police": ["amenity=police"],
                "ambulance_rescue": [
                    "amenity=ambulance_station",
                    "emergency=ambulance_station",
                    "emergency=mountain_rescue",
                    "emergency=lifeguard_base",
                ],
            }
        },
        limitations=EMERGENCY_LIMITATIONS,
        inspection_error_label="Emergency representative points",
        skip_points=False,
        manifest_source_provenance=[*OSM_PRIMARY, PRG_SUPPLEMENTARY],
    )
    return _build_rybnik_osm_fixture_pack(spec, root=root, extra_artifacts=_add_prg_layers)


_PUBLIC_SPEC = _OsmFixtureDomainSpec(
    domain="public",
    build_layers=build_osm_public_service_layers,
    fixture_path=PUBLIC_SERVICES_FIXTURE,
    evidence_filename="osm-public-services-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(PUBLIC_FACILITY_MAPPINGS),
        "building_rule": "A BDOT10k or OSM building footprint without one of the mapped facility tags is not a public-service feature.",
    },
    limitations=PUBLIC_SERVICES_LIMITATIONS,
    inspection_error_label="Public-service representative points",
    context_filename="public-services-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG facility class is enabled for administration, education, post or community/social semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k buildings are topographic context and cannot independently establish a public-service facility.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/public-townhall-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "building_context_cannot_establish_facility_semantics",
            }
        ],
    },
)

_TRANSPORT_SPEC = _OsmFixtureDomainSpec(
    domain="transport",
    build_layers=build_osm_transport_layers,
    fixture_path=TRANSPORT_FIXTURE,
    evidence_filename="osm-transport-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(TRANSPORT_FACILITY_MAPPINGS),
        "topographic_rule": "BDOT10k road or railway lines without OSM transport semantics are topographic context and not transport analytical vectors.",
    },
    limitations=TRANSPORT_LIMITATIONS,
    inspection_error_label="Transport representative points",
    context_filename="transport-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG facility or network class is enabled for transport semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k roads and railways are topographic context and cannot independently establish transport service semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/transport-road-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_transport_semantics",
            }
        ],
    },
)

_BRIDGES_SPEC = _OsmFixtureDomainSpec(
    domain="bridges",
    build_layers=build_osm_bridges_layers,
    fixture_path=BRIDGES_FIXTURE,
    evidence_filename="osm-bridges-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(BRIDGES_FACILITY_MAPPINGS),
        "topographic_rule": "BDOT10k bridge or culvert objects without OSM bridge semantics are topographic context and not bridge analytical vectors.",
    },
    limitations=BRIDGES_LIMITATIONS,
    inspection_error_label="Bridges representative points",
    context_filename="bridges-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG bridge or crossing registry is enabled for bridge semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k bridge and culvert layers are topographic context and cannot independently establish bridge semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/bridge-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_bridge_semantics",
            }
        ],
    },
)

_WATER_SPEC = _OsmFixtureDomainSpec(
    domain="water",
    build_layers=build_osm_water_layers,
    fixture_path=WATER_FIXTURE,
    evidence_filename="osm-water-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(WATER_FACILITY_MAPPINGS),
        "category_rules": {
            "water.facilities": "man_made=pumping_station requires pumping=water or substance=water.",
            "water.pipelines": "man_made=pipeline requires substance=water; pipeline=water remains an explicit legacy representation.",
        },
        "water_semantics_rule": "Generic pipelines and pumping stations without explicit water semantics are excluded to prevent gas or sewer attribution.",
        "topographic_rule": "BDOT10k hydrographic lines without OSM water semantics are topographic context and not water analytical vectors.",
    },
    limitations=WATER_LIMITATIONS,
    inspection_error_label="Water representative points",
    context_filename="water-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG water registry is enabled for water utility semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k hydrography layers are topographic context and cannot independently establish water utility semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/waterway-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_water_semantics",
            }
        ],
    },
)

_GAS_SPEC = _OsmFixtureDomainSpec(
    domain="gas",
    build_layers=build_osm_gas_layers,
    fixture_path=GAS_FIXTURE,
    evidence_filename="osm-gas-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(GAS_FACILITY_MAPPINGS),
        "category_rules": {
            "gas.facilities": "man_made=gasometer or man_made=gas_station; pipeline=valve requires substance=gas.",
            "gas.pipelines": "man_made=pipeline requires substance=gas; pipeline=gas is retained only as explicit legacy semantics.",
        },
        "pipeline_rule": "Generic unlabelled pipelines and valves without explicit gas tags are excluded to prevent false gas attribution.",
    },
    limitations=GAS_LIMITATIONS,
    inspection_error_label="Gas representative points",
    context_filename="gas-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG gas registry is enabled for gas utility semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k layers do not independently establish gas utility semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/gas-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_gas_semantics",
            }
        ],
    },
)

_SEWER_SPEC = _OsmFixtureDomainSpec(
    domain="sewer",
    build_layers=build_osm_sewer_layers,
    fixture_path=SEWER_FIXTURE,
    evidence_filename="osm-sewer-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(SEWER_FACILITY_MAPPINGS),
        "category_rules": {
            "sewer.facilities": "man_made=wastewater_plant, septic_tank, pumping_station (with pumping/substance=sewerage/wastewater), or manhole (with utility=sewer).",
            "sewer.pipelines": "pipeline=sewer without a conflicting substance, or man_made=pipeline with substance=sewerage/wastewater.",
        },
        "sewer_semantics_rule": "Generic, water, gas, stormwater and drainage infrastructure is excluded; facilities and pipelines require explicit sewer or wastewater semantics.",
    },
    limitations=SEWER_LIMITATIONS,
    inspection_error_label="Sewer representative points",
    context_filename="sewer-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG sewer registry is enabled for sewer utility semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k layers do not independently establish sewer utility semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/sewer-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_sewer_semantics",
            }
        ],
    },
)

_INDUSTRIAL_SPEC = _OsmFixtureDomainSpec(
    domain="industrial",
    build_layers=build_osm_industrial_layers,
    fixture_path=INDUSTRIAL_FIXTURE,
    evidence_filename="osm-industrial-source-evidence.json",
    evidence_extra={
        "category_mappings": _mapping_entries(INDUSTRIAL_FACILITY_MAPPINGS),
        "category_rules": {
            "industrial.facilities": "landuse=industrial",
            "industrial.works": "man_made=works, industrial=factory, or industrial=works",
        },
    },
    limitations=INDUSTRIAL_LIMITATIONS,
    inspection_error_label="Industrial representative points",
    context_filename="industrial-context-and-comparison.json",
    context_payload={
        "prg": {
            "status": "needs_source",
            "detail": "No qualified PRG facility class is enabled for industrial semantics.",
        },
        "bdot10k": {
            "status": "context_only",
            "detail": "BDOT10k industrial areas and military complexes provide topographic context and cannot independently establish operational semantics.",
        },
        "comparison": [
            {
                "outcome": "ambiguous",
                "left": {"source_id": "openstreetmap", "feature_id": "way/industrial-1"},
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_industrial_semantics",
            }
        ],
    },
    manifest_source_provenance=[*OSM_PRIMARY, BDOT10K_SUPPLEMENTARY],
)

_TELECOM_SPEC = _OsmFixtureDomainSpec(
    domain="telecom",
    build_layers=build_osm_telecom_layers,
    fixture_path=TELECOM_FIXTURE,
    evidence_filename="osm-telecom-source-evidence.json",
    evidence_extra={
        "category_rules": {
            "telecom.towers": "man_made=communications_tower, or man_made=mast/tower with tower:type=communication or a communication:* service=yes tag.",
            "telecom.facilities": "allow-listed telecom=* values, or man_made=antenna with a communication:* service=yes tag.",
            "telecom.lines": "communication=line or cable=communication only.",
        },
        "false_positive_rule": "Generic masts, towers, poles, buildings, ducts and utilities without qualifying telecom tags are excluded.",
        "source_gap": "No qualified official analytical telecom-network vector feed is enabled; a zero-feature telecom.lines layer remains visible with readiness=needs_source.",
    },
    limitations=TELECOM_LIMITATIONS,
    inspection_error_label="Telecom representative points",
    categories_order=TELECOM_CATEGORIES,
    include_kiut_reference=True,
)

_DISTRICT_HEATING_SPEC = _OsmFixtureDomainSpec(
    domain="district_heating",
    build_layers=build_osm_district_heating_layers,
    fixture_path=DISTRICT_HEATING_FIXTURE,
    evidence_filename="osm-district-heating-source-evidence.json",
    evidence_extra={
        "category_rules": {
            "district_heating.plants": "industrial=heating_station, or power=plant/generator with explicit heat output/source tags.",
            "district_heating.facilities": "man_made=heat_exchanger only.",
            "district_heating.lines": "pipeline=heating, or man_made=pipeline with substance=hot_water, steam or heat.",
        },
        "false_positive_rule": "Generic industrial buildings, chimneys, power equipment and pipelines without explicit heating semantics are excluded.",
        "source_gap": "No qualified official analytical district-heating-network vector feed is enabled; a zero-feature district_heating.lines layer remains visible with readiness=needs_source.",
    },
    limitations=DISTRICT_HEATING_LIMITATIONS,
    inspection_error_label="District-heating representative points",
    categories_order=DISTRICT_HEATING_CATEGORIES,
    metadata_layer="plants",
    include_origin_source_id=False,
    include_kiut_reference=True,
)


def build_rybnik_public_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the public-services pack without deriving facilities from building context."""
    return _build_rybnik_osm_fixture_pack(_PUBLIC_SPEC, root=root)


def build_rybnik_transport_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the transport pack without deriving network or facility semantics from raw topographic context."""
    return _build_rybnik_osm_fixture_pack(_TRANSPORT_SPEC, root=root)


def build_rybnik_bridges_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the bridges pack without deriving operational criticality or connectivity from topographic context."""
    return _build_rybnik_osm_fixture_pack(_BRIDGES_SPEC, root=root)


def build_rybnik_water_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the water pack without deriving hydraulic flood risk or flow models from raw terrain context."""
    return _build_rybnik_osm_fixture_pack(_WATER_SPEC, root=root)


def build_rybnik_gas_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the gas pack with explicit gas semantics and without generic unlabelled pipeline synthesis."""
    return _build_rybnik_osm_fixture_pack(_GAS_SPEC, root=root)


def build_rybnik_sewer_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the sewer pack with explicit sewer semantics and without generic unlabelled pipeline synthesis."""
    return _build_rybnik_osm_fixture_pack(_SEWER_SPEC, root=root)


def build_rybnik_industrial_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the industrial pack with explicit industrial semantics."""
    return _build_rybnik_osm_fixture_pack(_INDUSTRIAL_SPEC, root=root)


def build_rybnik_telecom_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build a telecom pack without inferring a network from KIUT imagery."""
    return _build_rybnik_osm_fixture_pack(_TELECOM_SPEC, root=root)


def build_rybnik_district_heating_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build a district-heating pack without inferring a network from KIUT."""
    return _build_rybnik_osm_fixture_pack(_DISTRICT_HEATING_SPEC, root=root)
