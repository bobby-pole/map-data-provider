"""Native-artifact domain-pack cache v2 with v1 compatibility helpers."""

from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from shapely.geometry import mapping, shape

from geo_pipeline.aoi import validate_cache_key
from geo_pipeline.bridges import (
    BRIDGES_FIXTURE,
    BRIDGES_LIMITATIONS,
    build_osm_bridges_layers,
)
from geo_pipeline.bridges import (
    FACILITY_MAPPINGS as BRIDGES_FACILITY_MAPPINGS,
)
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import CACHE_DIR as DOMAIN_PACKS_DIR
from geo_pipeline.contracts import (
    normalize_analytical_vector_layer,
    validate_provider_geojson,
)
from geo_pipeline.district_heating import (
    DISTRICT_HEATING_CATEGORIES,
    DISTRICT_HEATING_FIXTURE,
    DISTRICT_HEATING_LIMITATIONS,
    build_osm_district_heating_layers,
)
from geo_pipeline.emergency import (
    EMERGENCY_FIXTURE,
    EMERGENCY_LIMITATIONS,
    PRG_EMERGENCY_FIXTURE,
    PRG_EMERGENCY_LIMITATIONS,
    build_osm_emergency_layers,
    build_prg_emergency_layers,
)
from geo_pipeline.gas import (
    FACILITY_MAPPINGS as GAS_FACILITY_MAPPINGS,
)
from geo_pipeline.gas import (
    GAS_FIXTURE,
    GAS_LIMITATIONS,
    build_osm_gas_layers,
)
from geo_pipeline.industrial import (
    INDUSTRIAL_FACILITY_MAPPINGS,
    INDUSTRIAL_FIXTURE,
    INDUSTRIAL_LIMITATIONS,
    build_osm_industrial_layers,
)
from geo_pipeline.public_services import (
    FACILITY_MAPPINGS as PUBLIC_FACILITY_MAPPINGS,
)
from geo_pipeline.public_services import (
    PUBLIC_SERVICES_FIXTURE,
    PUBLIC_SERVICES_LIMITATIONS,
    build_osm_public_service_layers,
)
from geo_pipeline.sewer import (
    FACILITY_MAPPINGS as SEWER_FACILITY_MAPPINGS,
)
from geo_pipeline.sewer import (
    SEWER_FIXTURE,
    SEWER_LIMITATIONS,
    build_osm_sewer_layers,
)
from geo_pipeline.source_registry import (
    guard_source_access,
    load_source_registry,
    validate_ordered_provenance,
)
from geo_pipeline.telecom import (
    TELECOM_CATEGORIES,
    TELECOM_FIXTURE,
    TELECOM_LIMITATIONS,
    build_osm_telecom_layers,
)
from geo_pipeline.transport import (
    FACILITY_MAPPINGS as TRANSPORT_FACILITY_MAPPINGS,
)
from geo_pipeline.transport import (
    TRANSPORT_FIXTURE,
    TRANSPORT_LIMITATIONS,
    build_osm_transport_layers,
)
from geo_pipeline.vector_tiles import build_map_presentation
from geo_pipeline.water import (
    FACILITY_MAPPINGS as WATER_FACILITY_MAPPINGS,
)
from geo_pipeline.water import (
    WATER_FIXTURE,
    WATER_LIMITATIONS,
    build_osm_water_layers,
)

DOMAIN_PACK_VERSION = "provider_domain_pack/v2"
PACK_DIRNAME = "domain-pack-v2"
ARTIFACT_KINDS = {
    "native_vector",
    "native_raster",
    "remote_service",
    "processed_vector",
    "derived_vector",
    "representative_points",
}
FILE_KINDS = {
    "native_vector",
    "native_raster",
    "processed_vector",
    "derived_vector",
    "representative_points",
}
POWER_ASSETS_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "data/fixtures/rybnik_35km/power/rybnik_35km_power_node_points_display_clipped.geojson"
)
POWER_SUPPORTS_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "data/fixtures/rybnik_35km/power/osm-power-supports-full.geojson"
)
POWER_RELATIONS_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "data/fixtures/rybnik_35km/power/osm-power-circuit-evidence.json"
)
POWER_ATTRIBUTES_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "data/fixtures/rybnik_35km/power/osm-power-attributes.json"
)
POWER_ASSETS_QUERY = (
    "OSMnx power and utility-pole point features from the committed Rybnik 35 km AOI snapshot."
)
POWER_SUPPORTS_QUERY = (
    "Captured bounded OpenStreetMap power-support snapshot for the committed Rybnik 35 km AOI."
)


def domain_pack_root(aoi_id: str, domain: str, *, root: Path | None = None) -> Path:
    effective_root = DOMAIN_PACKS_DIR if root is None else root
    return effective_root / validate_cache_key(aoi_id) / domain / PACK_DIRNAME


def read_domain_pack(
    aoi_id: str, domain: str, *, root: Path | None = None, public_export: bool = False
) -> dict[str, Any]:
    pack_root = domain_pack_root(aoi_id, domain, root=root)
    manifest_path = pack_root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing domain-pack manifest: {manifest_path.name}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_domain_pack(manifest, pack_root=pack_root, public_export=public_export)
    artifacts = manifest["artifacts"]
    if public_export:
        artifacts = [artifact for artifact in artifacts if artifact["public_export"]]
    return {**manifest, "artifacts": artifacts}


def validate_domain_pack(
    manifest: dict[str, Any], *, pack_root: Path, public_export: bool = False
) -> None:
    required = {
        "domain_pack_version",
        "aoi_id",
        "domain",
        "source_provenance",
        "artifacts",
        "validation",
        "readiness",
    }
    if not isinstance(manifest, dict) or not required <= set(manifest):
        raise ValueError("Domain-pack manifest is missing required fields")
    if manifest["domain_pack_version"] != DOMAIN_PACK_VERSION:
        raise ValueError("Unsupported domain-pack version")
    if not isinstance(manifest["aoi_id"], str) or not isinstance(manifest["domain"], str):
        raise ValueError("Domain-pack identity must contain AOI and domain")
    registry = load_source_registry()
    validate_ordered_provenance(manifest["source_provenance"], registry, public_export=False)
    if not isinstance(manifest["artifacts"], list) or not manifest["artifacts"]:
        raise ValueError("Domain-pack must contain artifacts")

    ids: set[str] = set()
    for artifact in manifest["artifacts"]:
        _validate_artifact(
            artifact,
            pack_root=pack_root,
            registry=registry,
            public_export=public_export,
            artifact_ids=ids,
        )
    for record_name in ("validation", "readiness"):
        record = manifest[record_name]
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise ValueError(f"Domain-pack {record_name} requires a file path")
        _safe_file(pack_root, record["path"])


def write_domain_pack(
    aoi_id: str,
    domain: str,
    *,
    root: Path | None = None,
    manifest: dict[str, Any],
    files: dict[str, bytes],
) -> dict[str, Any]:
    target = domain_pack_root(aoi_id, domain, root=root)
    staging = target.parent / f".{PACK_DIRNAME}-staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir(parents=True)
        for relative_path, payload in files.items():
            path = _safe_file(staging, relative_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        manifest_path = staging / "manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        validate_domain_pack(manifest, pack_root=staging)
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = target.parent / f".{PACK_DIRNAME}-backup-{uuid.uuid4().hex}"
        if target.exists():
            target.replace(backup)
        try:
            staging.replace(target)
        except Exception:
            if backup.exists() and not target.exists():
                backup.replace(target)
            raise
        finally:
            shutil.rmtree(backup, ignore_errors=True)
        return read_domain_pack(aoi_id, domain, root=root)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def build_rybnik_power_domain_pack(*, root: Path) -> dict[str, Any]:
    legacy = read_cached_layer(cache_paths("rybnik_35km", "power", root=root))
    layer_bytes = json.dumps(legacy["layer"], ensure_ascii=False, indent=2).encode()
    metadata_bytes = json.dumps(legacy["metadata"], ensure_ascii=False, indent=2).encode()
    readiness_bytes = json.dumps(legacy["readiness"], ensure_ascii=False, indent=2).encode()
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
    assets_bytes = json.dumps(assets, ensure_ascii=False, indent=2).encode()
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
    supports_bytes = json.dumps(supports, ensure_ascii=False, indent=2).encode()
    relation_evidence_bytes = json.dumps(
        guard_source_access(
            "openstreetmap", "local_import", lambda: _read_json(POWER_RELATIONS_SOURCE)
        ),
        ensure_ascii=False,
        indent=2,
    ).encode()
    lines = deepcopy(legacy["layer"])
    _merge_osm_attributes(lines, attributes_source)
    layer_bytes = json.dumps(lines, ensure_ascii=False, indent=2).encode()
    representative_points = _representative_points_layer(lines)
    representative_points_bytes = json.dumps(
        representative_points, ensure_ascii=False, indent=2
    ).encode()
    analytical_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *analytical_provenance,
        {"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"},
    ]
    source_evidence_bytes = json.dumps(
        {
            "source_registry_id": legacy["metadata"]["source_registry_id"],
            "source_url": legacy["metadata"]["source_url"],
            "source_query": legacy["metadata"]["source_query"],
            "snapshot_at": legacy["metadata"]["snapshot_at"],
            "pipeline_version": legacy["metadata"]["pipeline_version"],
            "query_version": legacy["metadata"]["query_version"],
            "attribute_snapshot_at": attributes_source["snapshot_at"],
            "attribute_source_checksum": attributes_source["source_checksum"],
        },
        ensure_ascii=False,
        indent=2,
    ).encode()
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
                "source_provenance": analytical_provenance,
                "public_export": True,
            },
            {
                "id": "power.assets",
                "kind": "processed_vector",
                "format": "geojson",
                "path": "layers/power.assets.geojson",
                "sha256": _digest(assets_bytes),
                "feature_count": assets["metadata"]["feature_count"],
                "source_provenance": analytical_provenance,
                "public_export": True,
            },
            {
                "id": "power.supports",
                "kind": "processed_vector",
                "format": "geojson",
                "path": "layers/power.supports.geojson",
                "sha256": _digest(supports_bytes),
                "feature_count": supports["metadata"]["feature_count"],
                "source_provenance": analytical_provenance,
                "public_export": True,
            },
            {
                "id": "power.representative_points",
                "kind": "representative_points",
                "format": "geojson",
                "path": "layers/power.representative_points.geojson",
                "sha256": _digest(representative_points_bytes),
                "feature_count": representative_points["metadata"]["feature_count"],
                "source_provenance": analytical_provenance,
                "public_export": False,
            },
            {
                "id": "power.osm_source_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": "native/osm-source-evidence.json",
                "sha256": _digest(source_evidence_bytes),
                "source_provenance": analytical_provenance,
                "public_export": False,
            },
            {
                "id": "power.osm_relation_evidence",
                "kind": "native_vector",
                "format": "json",
                "path": "native/osm-relation-evidence.json",
                "sha256": _digest(relation_evidence_bytes),
                "source_provenance": analytical_provenance,
                "public_export": False,
            },
            {
                "id": "power.kiut_reference",
                "kind": "remote_service",
                "format": "wms",
                "source_provenance": [
                    {
                        "source_id": "kiut_gesut_wms",
                        "contribution_role": "validation_reference",
                    }
                ],
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
    legacy = read_cached_layer(cache_paths("rybnik_35km", "emergency", root=root))
    readiness = legacy["readiness"]["readiness"]
    osm_layers = build_osm_emergency_layers(readiness=readiness)
    prg_layers = build_prg_emergency_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in osm_layers.items():
        path = f"layers/emergency.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"emergency.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    prg_provenance = [{"source_id": "prg_wfs", "contribution_role": "supplementary"}]
    for category, layer in prg_layers.items():
        path = f"layers/emergency.official_{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
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
                "public_export": True,
            }
        )

    inspection_points = _emergency_representative_points(osm_layers)
    inspection_payload = json.dumps(inspection_points, ensure_ascii=False, indent=2).encode()
    files["layers/emergency.inspection_points.geojson"] = inspection_payload
    artifacts.append(
        {
            "id": "emergency.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/emergency.inspection_points.geojson",
            "sha256": _digest(inspection_payload),
            "feature_count": inspection_points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    osm_evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(EMERGENCY_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(EMERGENCY_FIXTURE.read_bytes()),
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
        },
        "limitations": EMERGENCY_LIMITATIONS,
    }
    osm_evidence_payload = json.dumps(osm_evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-emergency-source-evidence.json"] = osm_evidence_payload
    artifacts.append(
        {
            "id": "emergency.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-emergency-source-evidence.json",
            "sha256": _digest(osm_evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    prg_evidence = {
        "source_registry_id": "prg_wfs",
        "mapped_feature_types": [
            "ms:K02_Komenda_powiatowa_policji",
            "ms:K07_Komenda_powiatowa_strazy_pozarnej",
        ],
        "fixture": str(PRG_EMERGENCY_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "fixture_sha256": _digest(PRG_EMERGENCY_FIXTURE.read_bytes()),
        "publication": "Public representative points retain PRG identity separately from OSM and do not assert exact facility locations.",
        "limitations": PRG_EMERGENCY_LIMITATIONS,
    }
    prg_evidence_payload = json.dumps(prg_evidence, ensure_ascii=False, indent=2).encode()
    files["native/prg-police-fire-source-evidence.json"] = prg_evidence_payload
    artifacts.append(
        {
            "id": "emergency.prg_police_fire_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/prg-police-fire-source-evidence.json",
            "sha256": _digest(prg_evidence_payload),
            "source_provenance": prg_provenance,
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "emergency",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "emergency", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "emergency", root=root), manifest=pack
    )
    return pack


def build_rybnik_public_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the public-services pack without deriving facilities from building context."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "public", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_public_service_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/public.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"public.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _public_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/public.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "public.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/public.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(PUBLIC_SERVICES_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(PUBLIC_SERVICES_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in PUBLIC_FACILITY_MAPPINGS.items()
        },
        "building_rule": "A BDOT10k or OSM building footprint without one of the mapped facility tags is not a public-service feature.",
        "limitations": PUBLIC_SERVICES_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-public-services-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "public.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-public-services-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
                "left": {
                    "source_id": "openstreetmap",
                    "feature_id": "way/public-townhall-1",
                },
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "building_context_cannot_establish_facility_semantics",
            }
        ],
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/public-services-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "public.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/public-services-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "public",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "public", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "public", root=root), manifest=pack
    )
    return pack


def build_rybnik_transport_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the transport pack without deriving network or facility semantics from raw topographic context."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "transport", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_transport_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/transport.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"transport.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _transport_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/transport.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "transport.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/transport.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(TRANSPORT_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(TRANSPORT_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in TRANSPORT_FACILITY_MAPPINGS.items()
        },
        "topographic_rule": "BDOT10k road or railway lines without OSM transport semantics are topographic context and not transport analytical vectors.",
        "limitations": TRANSPORT_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-transport-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "transport.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-transport-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
                "left": {
                    "source_id": "openstreetmap",
                    "feature_id": "way/transport-road-1",
                },
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_transport_semantics",
            }
        ],
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/transport-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "transport.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/transport-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "transport",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "transport", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "transport", root=root), manifest=pack
    )
    return pack


def build_rybnik_bridges_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the bridges pack without deriving operational criticality or connectivity from topographic context."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "bridges", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_bridges_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/bridges.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"bridges.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _bridges_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/bridges.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "bridges.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/bridges.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(BRIDGES_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(BRIDGES_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in BRIDGES_FACILITY_MAPPINGS.items()
        },
        "topographic_rule": "BDOT10k bridge or culvert objects without OSM bridge semantics are topographic context and not bridge analytical vectors.",
        "limitations": BRIDGES_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-bridges-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "bridges.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-bridges-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/bridges-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "bridges.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/bridges-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "bridges",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "bridges", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "bridges", root=root), manifest=pack
    )
    return pack


def build_rybnik_water_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the water pack without deriving hydraulic flood risk or flow models from raw terrain context."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "water", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_water_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/water.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"water.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _water_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/water.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "water.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/water.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(WATER_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(WATER_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in WATER_FACILITY_MAPPINGS.items()
        },
        "category_rules": {
            "water.facilities": "man_made=pumping_station requires pumping=water or substance=water.",
            "water.pipelines": "man_made=pipeline requires substance=water; pipeline=water remains an explicit legacy representation.",
        },
        "water_semantics_rule": "Generic pipelines and pumping stations without explicit water semantics are excluded to prevent gas or sewer attribution.",
        "topographic_rule": "BDOT10k hydrographic lines without OSM water semantics are topographic context and not water analytical vectors.",
        "limitations": WATER_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-water-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "water.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-water-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/water-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "water.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/water-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "water",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "water", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "water", root=root), manifest=pack
    )
    return pack


def build_rybnik_gas_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the gas pack with explicit gas semantics and without generic unlabelled pipeline synthesis."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "gas", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_gas_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/gas.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"gas.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _gas_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/gas.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "gas.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/gas.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(GAS_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(GAS_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in GAS_FACILITY_MAPPINGS.items()
        },
        "category_rules": {
            "gas.facilities": "man_made=gasometer or man_made=gas_station; pipeline=valve requires substance=gas.",
            "gas.pipelines": "man_made=pipeline requires substance=gas; pipeline=gas is retained only as explicit legacy semantics.",
        },
        "pipeline_rule": "Generic unlabelled pipelines and valves without explicit gas tags are excluded to prevent false gas attribution.",
        "limitations": GAS_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-gas-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "gas.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-gas-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/gas-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "gas.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/gas-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "gas",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "gas", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "gas", root=root), manifest=pack
    )
    return pack


def build_rybnik_sewer_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the sewer pack with explicit sewer semantics and without generic unlabelled pipeline synthesis."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "sewer", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_sewer_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [
        *osm_provenance,
        {"source_id": "prg_wfs", "contribution_role": "supplementary"},
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/sewer.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"sewer.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _sewer_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/sewer.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "sewer.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/sewer.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(SEWER_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(SEWER_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in SEWER_FACILITY_MAPPINGS.items()
        },
        "category_rules": {
            "sewer.facilities": "man_made=wastewater_plant, septic_tank, pumping_station (with pumping/substance=sewerage/wastewater), or manhole (with utility=sewer).",
            "sewer.pipelines": "pipeline=sewer without a conflicting substance, or man_made=pipeline with substance=sewerage/wastewater.",
        },
        "sewer_semantics_rule": "Generic, water, gas, stormwater and drainage infrastructure is excluded; facilities and pipelines require explicit sewer or wastewater semantics.",
        "limitations": SEWER_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-sewer-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "sewer.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-sewer-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/sewer-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "sewer.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/sewer-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "sewer",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "sewer", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "sewer", root=root), manifest=pack
    )
    return pack


def build_rybnik_industrial_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build the industrial pack with explicit industrial semantics."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "industrial", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_industrial_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    source_provenance = [*osm_provenance]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category, layer in layers.items():
        path = f"layers/industrial.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"industrial.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _industrial_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/industrial.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "industrial.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/industrial.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(INDUSTRIAL_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(INDUSTRIAL_FIXTURE.read_bytes()),
        "category_mappings": {
            category: [f"{key}={value}" for key, value in mappings]
            for category, mappings in INDUSTRIAL_FACILITY_MAPPINGS.items()
        },
        "category_rules": {
            "industrial.facilities": "landuse=industrial",
            "industrial.works": "man_made=works, industrial=factory, or industrial=works",
        },
        "limitations": INDUSTRIAL_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-industrial-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "industrial.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-industrial-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )

    context = {
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
                "left": {
                    "source_id": "openstreetmap",
                    "feature_id": "way/industrial-1",
                },
                "right": {"source_id": "bdot10k", "feature_id": None},
                "evidence": "topographic_context_cannot_establish_industrial_semantics",
            }
        ],
    }
    context_payload = json.dumps(context, ensure_ascii=False, indent=2).encode()
    files["native/industrial-context-and-comparison.json"] = context_payload
    artifacts.append(
        {
            "id": "industrial.context_and_comparison",
            "kind": "native_vector",
            "format": "json",
            "path": "native/industrial-context-and-comparison.json",
            "sha256": _digest(context_payload),
            "source_provenance": [
                {"source_id": "prg_wfs", "contribution_role": "supplementary"},
                {"source_id": "bdot10k", "contribution_role": "supplementary"},
            ],
            "public_export": False,
        }
    )

    source_provenance = [
        *osm_provenance,
        {"source_id": "bdot10k", "contribution_role": "supplementary"},
    ]

    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "industrial",
        "source_provenance": source_provenance,
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "industrial", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "industrial", root=root),
        manifest=pack,
    )
    return pack


def build_rybnik_telecom_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build a telecom pack without inferring a network from KIUT imagery."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "telecom", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_telecom_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    kiut_provenance = [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category in TELECOM_CATEGORIES:
        layer = layers[category]
        path = f"layers/telecom.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"telecom.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _telecom_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    files["layers/telecom.inspection_points.geojson"] = points_payload
    artifacts.append(
        {
            "id": "telecom.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": "layers/telecom.inspection_points.geojson",
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(TELECOM_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(TELECOM_FIXTURE.read_bytes()),
        "category_rules": {
            "telecom.towers": "man_made=communications_tower, or man_made=mast/tower with tower:type=communication or a communication:* service=yes tag.",
            "telecom.facilities": "allow-listed telecom=* values, or man_made=antenna with a communication:* service=yes tag.",
            "telecom.lines": "communication=line or cable=communication only.",
        },
        "false_positive_rule": "Generic masts, towers, poles, buildings, ducts and utilities without qualifying telecom tags are excluded.",
        "source_gap": "No qualified official analytical telecom-network vector feed is enabled; a zero-feature telecom.lines layer remains visible with readiness=needs_source.",
        "limitations": TELECOM_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    files["native/osm-telecom-source-evidence.json"] = evidence_payload
    artifacts.append(
        {
            "id": "telecom.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": "native/osm-telecom-source-evidence.json",
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )
    artifacts.append(
        {
            "id": "telecom.kiut_reference",
            "kind": "remote_service",
            "format": "wms",
            "source_provenance": kiut_provenance,
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "telecom",
        "source_provenance": [*osm_provenance, *kiut_provenance],
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack("rybnik_35km", "telecom", root=root, manifest=manifest, files=files)
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "telecom", root=root), manifest=pack
    )
    return pack


def build_rybnik_district_heating_domain_pack(*, root: Path) -> dict[str, Any]:
    """Build a district-heating pack without inferring a network from KIUT."""
    legacy = read_cached_layer(cache_paths("rybnik_35km", "district_heating", root=root))
    readiness = legacy["readiness"]["readiness"]
    layers = build_osm_district_heating_layers(readiness=readiness)
    osm_provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    kiut_provenance = [{"source_id": "kiut_gesut_wms", "contribution_role": "validation_reference"}]
    files: dict[str, bytes] = {
        "validation/metadata.json": json.dumps(
            legacy["metadata"], ensure_ascii=False, indent=2
        ).encode(),
        "readiness/readiness.json": json.dumps(
            legacy["readiness"], ensure_ascii=False, indent=2
        ).encode(),
    }
    artifacts: list[dict[str, Any]] = []
    for category in DISTRICT_HEATING_CATEGORIES:
        layer = layers[category]
        path = f"layers/district_heating.{category}.geojson"
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode()
        files[path] = payload
        artifacts.append(
            {
                "id": f"district_heating.{category}",
                "kind": "processed_vector",
                "format": "geojson",
                "path": path,
                "sha256": _digest(payload),
                "feature_count": layer["metadata"]["feature_count"],
                "source_provenance": osm_provenance,
                "public_export": True,
            }
        )

    points = _district_heating_representative_points(layers)
    points_payload = json.dumps(points, ensure_ascii=False, indent=2).encode()
    points_path = "layers/district_heating.inspection_points.geojson"
    files[points_path] = points_payload
    artifacts.append(
        {
            "id": "district_heating.inspection_points",
            "kind": "derived_vector",
            "format": "geojson",
            "path": points_path,
            "sha256": _digest(points_payload),
            "feature_count": points["metadata"]["feature_count"],
            "source_provenance": osm_provenance,
            "public_export": True,
        }
    )

    evidence = {
        "source_registry_id": "openstreetmap",
        "fixture": str(DISTRICT_HEATING_FIXTURE.relative_to(Path(__file__).resolve().parents[1])),
        "sha256": _digest(DISTRICT_HEATING_FIXTURE.read_bytes()),
        "category_rules": {
            "district_heating.plants": "industrial=heating_station, or power=plant/generator with explicit heat output/source tags.",
            "district_heating.facilities": "man_made=heat_exchanger only.",
            "district_heating.lines": "pipeline=heating, or man_made=pipeline with substance=hot_water, steam or heat.",
        },
        "false_positive_rule": "Generic industrial buildings, chimneys, power equipment and pipelines without explicit heating semantics are excluded.",
        "source_gap": "No qualified official analytical district-heating-network vector feed is enabled; a zero-feature district_heating.lines layer remains visible with readiness=needs_source.",
        "limitations": DISTRICT_HEATING_LIMITATIONS,
    }
    evidence_payload = json.dumps(evidence, ensure_ascii=False, indent=2).encode()
    evidence_path = "native/osm-district-heating-source-evidence.json"
    files[evidence_path] = evidence_payload
    artifacts.append(
        {
            "id": "district_heating.osm_source_evidence",
            "kind": "native_vector",
            "format": "json",
            "path": evidence_path,
            "sha256": _digest(evidence_payload),
            "source_provenance": osm_provenance,
            "public_export": False,
        }
    )
    artifacts.append(
        {
            "id": "district_heating.kiut_reference",
            "kind": "remote_service",
            "format": "wms",
            "source_provenance": kiut_provenance,
            "public_export": False,
        }
    )
    manifest = {
        "domain_pack_version": DOMAIN_PACK_VERSION,
        "aoi_id": "rybnik_35km",
        "domain": "district_heating",
        "source_provenance": [*osm_provenance, *kiut_provenance],
        "artifacts": artifacts,
        "validation": {"path": "validation/metadata.json"},
        "readiness": {"path": "readiness/readiness.json"},
    }
    pack = write_domain_pack(
        "rybnik_35km", "district_heating", root=root, manifest=manifest, files=files
    )
    build_map_presentation(
        pack_root=domain_pack_root("rybnik_35km", "district_heating", root=root),
        manifest=pack,
    )
    return pack


def _representative_points_layer(layer: dict[str, Any]) -> dict[str, Any]:
    metadata = {
        **deepcopy(layer["metadata"]),
        "layer_id": "power.representative_points",
    }
    features = []
    for feature in layer["features"]:
        geometry = shape(feature["geometry"])
        properties = {
            **deepcopy(feature["properties"]),
            "source_geometry_type": geometry.geom_type,
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(geometry.representative_point()),
            }
        )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _telecom_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "telecom.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"telecom.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Telecom representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _district_heating_representative_points(
    layers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    metadata = {
        **deepcopy(layers["plants"]["metadata"]),
        "layer_id": "district_heating.inspection_points",
    }
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"district_heating.{category}",
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"District-heating representative points violate provider contract: {', '.join(errors)}"
        )
    return points


def _emergency_representative_points(
    layers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {
        **deepcopy(first["metadata"]),
        "layer_id": "emergency.inspection_points",
    }
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"emergency.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Emergency representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _public_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "public.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"public.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Public-service representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _transport_representative_points(
    layers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {
        **deepcopy(first["metadata"]),
        "layer_id": "transport.inspection_points",
    }
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"transport.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Transport representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _bridges_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "bridges.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"bridges.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Bridges representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _water_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "water.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"water.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Water representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _gas_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "gas.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"gas.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Gas representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _sewer_representative_points(layers: dict[str, dict[str, Any]]) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {**deepcopy(first["metadata"]), "layer_id": "sewer.inspection_points"}
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"sewer.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Sewer representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _industrial_representative_points(
    layers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    first = next(iter(layers.values()))
    metadata = {
        **deepcopy(first["metadata"]),
        "layer_id": "industrial.inspection_points",
    }
    features = []
    for category, layer in layers.items():
        for feature in layer["features"]:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = {
                **deepcopy(feature["properties"]),
                "origin_artifact": f"industrial.{category}",
                "origin_source_id": feature["properties"]["source_id"],
                "source_geometry_type": geometry.geom_type,
            }
            features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": mapping(geometry.representative_point()),
                }
            )
    metadata["feature_count"] = len(features)
    points = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    errors = validate_provider_geojson(points)
    if errors:
        raise ValueError(
            f"Industrial representative points violate the provider contract: {', '.join(errors)}"
        )
    return points


def _merge_osm_attributes(layer: dict[str, Any], evidence: dict[str, Any]) -> None:
    attributes = evidence.get("attributes")
    if not isinstance(attributes, dict):
        raise ValueError("OSM attribute evidence requires an attributes mapping")
    for feature in layer.get("features", []):
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        source_id = properties.get("source_id")
        source_tags = attributes.get(source_id)
        if not isinstance(source_tags, dict):
            continue
        existing = properties.get("osm_tags")
        properties["osm_tags"] = {
            **(existing if isinstance(existing, dict) else {}),
            **source_tags,
        }


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate_artifact(
    artifact: Any,
    *,
    pack_root: Path,
    registry: dict[str, Any],
    public_export: bool,
    artifact_ids: set[str],
) -> None:
    required = {"id", "kind", "format", "source_provenance", "public_export"}
    if not isinstance(artifact, dict) or not required <= set(artifact):
        raise ValueError("Domain-pack artifact is missing required fields")
    if artifact["id"] in artifact_ids or not isinstance(artifact["id"], str):
        raise ValueError("Domain-pack artifact IDs must be unique")
    artifact_ids.add(artifact["id"])
    if artifact["kind"] not in ARTIFACT_KINDS:
        raise ValueError("Unsupported domain-pack artifact kind")
    if artifact["kind"] == "native_raster" and artifact["public_export"] is True:
        raise ValueError(
            "Native raster artifacts cannot be publicly exported through vector-only paths"
        )
    validate_ordered_provenance(
        artifact["source_provenance"],
        registry,
        public_export=bool(artifact["public_export"]),
    )
    if public_export and artifact["public_export"] is not True:
        return
    path = artifact.get("path")
    if artifact["kind"] in FILE_KINDS and not isinstance(path, str):
        if not artifact.get("not_applicable_reason"):
            raise ValueError("File-backed artifact requires a path or not-applicable reason")
        return
    if path is not None:
        file_path = _safe_file(pack_root, path)
        if not file_path.exists():
            raise FileNotFoundError(f"Domain-pack artifact is missing: {path}")
        if artifact.get("sha256") != _digest(file_path.read_bytes()):
            raise ValueError("Domain-pack artifact checksum does not match")
        if artifact.get("feature_count") is not None:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
            if (
                payload.get("type") != "FeatureCollection"
                or len(payload.get("features", [])) != artifact["feature_count"]
            ):
                raise ValueError("Domain-pack artifact feature count does not match")
    elif artifact["kind"] != "remote_service":
        raise ValueError("Non-remote artifact requires a path or not-applicable reason")


def _safe_file(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if not relative_path or candidate == root.resolve() or root.resolve() not in candidate.parents:
        raise ValueError("Domain-pack path escapes its root")
    return candidate


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
