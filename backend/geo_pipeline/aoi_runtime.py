"""AOI v2 request resolution and fixture-first provider runtime contracts."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from geo_pipeline.aoi import AoiResolutionError, MAX_AREA_SQ_M, WGS84, _resolved, resolve_aoi
from geo_pipeline.query_catalog import GAS_OSM_QUERY, POWER_OSM_QUERY, TRANSPORT_OSM_QUERY, WATER_OSM_QUERY

AOI_REQUEST_CONTRACT_VERSION = "provider_aoi_request/v2"
RUNTIME_CONTRACT_VERSION = "provider_runtime/v1"
# Changing the pipeline version deliberately creates a new request-cache key.
# v10 invalidates cached water results created before the runtime required
# explicit water semantics for generic pipelines and pumping stations.
PIPELINE_VERSION = "geo_pipeline/runtime/v10"
CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "aoi" / "prg_administrative_catalog.geojson"
POLAND_BOUNDS = (14.05, 49.0, 24.25, 55.0)
ProfileOutcome = Literal["ready", "needs_source", "reference_only", "pending_qualification"]


@dataclass(frozen=True)
class ProviderProfile:
    domain: str
    source_registry_id: str
    source_role: str
    output_kind: str
    query_version: str
    tags: dict[str, list[str]]
    fixture_ready: bool = False


PROFILES: tuple[ProviderProfile, ...] = (
    ProviderProfile("power", POWER_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", POWER_OSM_QUERY.query_version, POWER_OSM_QUERY.tags, True),
    ProviderProfile("emergency", "openstreetmap", "analytical", "analytical_vector", "emergency-osm/v1", {"amenity": ["hospital", "fire_station", "police", "ambulance_station"], "healthcare": ["hospital"], "emergency": ["ambulance_station", "mountain_rescue", "lifeguard_base"]}, True),
    ProviderProfile("public", "openstreetmap", "analytical", "analytical_vector", "public-osm/v1", {"amenity": ["townhall", "school", "college", "university", "kindergarten", "post_office", "community_centre", "social_facility", "library", "arts_centre"], "office": ["government"]}, True),
    ProviderProfile("transport", TRANSPORT_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", TRANSPORT_OSM_QUERY.query_version, TRANSPORT_OSM_QUERY.tags, True),
    ProviderProfile("bridges", "openstreetmap", "analytical", "analytical_vector", "bridges-osm/v1", {"man_made": ["bridge"], "bridge": ["yes", "viaduct", "aqueduct", "boardwalk"], "railway": ["level_crossing", "crossing"], "highway": ["viaduct"]}, True),
    ProviderProfile("water", WATER_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", WATER_OSM_QUERY.query_version, WATER_OSM_QUERY.tags, True),
    ProviderProfile("gas", GAS_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", GAS_OSM_QUERY.query_version, GAS_OSM_QUERY.tags, True),
    ProviderProfile("sewer", "openstreetmap", "analytical", "analytical_vector", "sewer-osm/v1", {"man_made": ["wastewater_plant", "pumping_station"], "pipeline": ["sewer"]}),
    ProviderProfile("industrial", "openstreetmap", "analytical", "analytical_vector", "industrial-osm/v1", {"landuse": ["industrial"], "man_made": ["works"], "industrial": ["factory", "works"]}),
)
_PROFILE_BY_DOMAIN = {profile.domain: profile for profile in PROFILES}


class RuntimeRequestError(ValueError):
    """Typed, deterministic invalid AOI/runtime request."""


def administrative_catalog() -> dict[str, Any]:
    payload = _read_catalog()
    metadata = payload["metadata"]
    units = []
    for feature in payload["features"]:
        properties = feature["properties"]
        units.append({"id": properties["id"], "kind": properties["kind"], "name": properties["name"], "prg_id": properties["prg_id"], "geometry": feature["geometry"]})
    return {"catalog_version": metadata["catalog_version"], "source_registry_id": metadata["source_registry_id"], "snapshot_at": metadata["snapshot_at"], "source_crs": metadata["source_crs"], "limitations": metadata["limitations"], "units": units}


def resolve_runtime_request(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"aoi", "profiles"}:
        raise RuntimeRequestError("AOI runtime request requires only aoi and profiles")
    profiles = _resolve_profiles(value["profiles"])
    aoi = _resolve_runtime_aoi(value["aoi"])
    identity = {
        "contract_version": AOI_REQUEST_CONTRACT_VERSION,
        "geometry": aoi.geometry,
        "boundary_provenance": aoi.boundary_provenance,
        "profiles": [{"domain": profile.domain, "query_version": profile.query_version} for profile in profiles],
        "pipeline_version": PIPELINE_VERSION,
    }
    request_key = "request_" + hashlib.sha256(_canonical_json(identity).encode("utf-8")).hexdigest()[:16]
    return {
        "request_contract_version": AOI_REQUEST_CONTRACT_VERSION,
        "request_id": request_key,
        "cache_key": request_key,
        "aoi": aoi.as_dict(),
        "profiles": [_profile_descriptor(profile) for profile in profiles],
        "pipeline_version": PIPELINE_VERSION,
    }


def profile_outcomes(request: dict[str, Any], *, fixture_mode: bool = True) -> list[dict[str, Any]]:
    resolved = resolve_runtime_request(request)
    is_rybnik_demo = resolved["aoi"]["aoi_id"] == resolve_aoi("rybnik_60km").aoi_id
    outcomes = []
    for descriptor in resolved["profiles"]:
        profile = _PROFILE_BY_DOMAIN[descriptor["domain"]]
        if fixture_mode and is_rybnik_demo and profile.fixture_ready:
            status: ProfileOutcome = "ready"
            detail = "Committed bounded fixture artifacts are available for the Rybnik demo AOI."
            artifact_aoi_id: str | None = "rybnik_60km"
        else:
            status = "needs_source"
            detail = "No AOI-matching fixture artifact is committed; live acquisition and domain vertical-slice semantics remain explicit separate work."
            artifact_aoi_id = None
        outcomes.append({
            **descriptor,
            "status": status,
            "detail": detail,
            "artifact_aoi_id": artifact_aoi_id,
            "cache_status": "fresh" if status == "ready" else "missing",
            "queried_feature_count": None,
            "accepted_feature_count": None,
            "derived_feature_count": None,
        })
    return outcomes


def context_outcomes(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Return non-OSM provider roles without turning them into vectors."""
    resolved = resolve_runtime_request(request)
    domains = [profile["domain"] for profile in resolved["profiles"]]
    records: list[dict[str, Any]] = []
    if resolved["aoi"]["input_type"] == "administrative_selection":
        records.append(_context("administrative", "prg_wfs", "official_context", "ready", "The resolved AOI retains dated PRG administrative-boundary provenance; it is not a facility layer."))
    for domain in domains:
        if domain in {"public", "transport", "bridges", "water", "industrial"}:
            records.append(_context(domain, "bdot10k", "topographic_context", "needs_source", "A qualified BDOT10k class must be selected and verified for this AOI; building or topographic context is not facility semantics."))
        if domain in {"power", "water", "gas", "sewer"}:
            records.append(_context(domain, "kiut_gesut_wms", "reference_descriptor", "reference_only", "KIUT/GESUT is rendered reference imagery and cannot enter analytical GeoJSON."))
        records.append(_context(domain, "geoportal_orthophoto", "reference_descriptor", "reference_only", "Orthophoto is an optional rendered reference and cannot become an object vector."))
        if domain == "water":
            records.append(_context(domain, "nmt_nmpt", "derived_context", "needs_source", "NMT/NMPT may provide labelled raster-derived context only after a bounded source artifact is supplied."))
    return records


def _context(domain: str, source_registry_id: str, output_kind: str, status: ProfileOutcome, detail: str) -> dict[str, Any]:
    return {"domain": domain, "source_registry_id": source_registry_id, "output_kind": output_kind, "status": status, "detail": detail}


def _resolve_runtime_aoi(value: Any):
    if not isinstance(value, dict):
        raise RuntimeRequestError("AOI must be an object")
    kind = value.get("type")
    if kind == "point_radius":
        if set(value) != {"type", "longitude", "latitude", "radius_m"}:
            raise RuntimeRequestError("Point/radius AOI has unsupported or missing fields")
        longitude, latitude = _finite(value["longitude"], "longitude"), _finite(value["latitude"], "latitude")
        if not _inside_poland(longitude, latitude):
            raise RuntimeRequestError("Point/radius centre must be inside Poland")
        try:
            resolved = resolve_aoi({"type": "circle", "longitude": longitude, "latitude": latitude, "radius_m": _finite(value["radius_m"], "radius_m")})
        except AoiResolutionError as error:
            raise RuntimeRequestError(str(error)) from error
        if not _geometry_inside_poland(resolved.geometry):
            raise RuntimeRequestError("Point/radius AOI must remain inside Poland")
        return resolved
    if kind == "administrative_selection":
        if set(value) != {"type", "unit_ids"} or not isinstance(value["unit_ids"], list) or not value["unit_ids"]:
            raise RuntimeRequestError("Administrative AOI requires one or more unit_ids")
        return _resolve_administrative_union(value["unit_ids"])
    raise RuntimeRequestError("Unsupported AOI request type")


def _resolve_administrative_union(unit_ids: list[Any]):
    if not all(isinstance(item, str) and item for item in unit_ids):
        raise RuntimeRequestError("Administrative unit IDs must be non-empty strings")
    normalized_ids = sorted(set(unit_ids))
    catalogue = administrative_catalog()
    by_id = {unit["id"]: unit for unit in catalogue["units"]}
    unknown = [unit_id for unit_id in normalized_ids if unit_id not in by_id]
    if unknown:
        raise RuntimeRequestError(f"Unknown administrative unit: {unknown[0]}")
    merged = unary_union([shape(by_id[unit_id]["geometry"]) for unit_id in normalized_ids])
    if merged.is_empty or not merged.is_valid or merged.geom_type not in {"Polygon", "MultiPolygon"}:
        raise RuntimeRequestError("Administrative selection did not produce a valid polygonal AOI")
    geometry = _canonical_geometry(mapping(merged))
    if _metric_area_sq_m(geometry) > MAX_AREA_SQ_M:
        raise RuntimeRequestError("Administrative AOI exceeds provider area limits")
    provenance = {"kind": "prg_administrative_selection", "source_registry_id": catalogue["source_registry_id"], "catalog_version": catalogue["catalog_version"], "snapshot_at": catalogue["snapshot_at"], "unit_ids": normalized_ids, "fixture": "backend/data/fixtures/aoi/prg_administrative_catalog.geojson"}
    return _resolved(geometry, "administrative_selection", catalogue["source_crs"], provenance, radius_m=None)


def _resolve_profiles(value: Any) -> tuple[ProviderProfile, ...]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        raise RuntimeRequestError("profiles must be a non-empty list of category IDs")
    domains = sorted(set(value))
    unknown = [domain for domain in domains if domain not in _PROFILE_BY_DOMAIN]
    if unknown:
        raise RuntimeRequestError(f"Unsupported provider category: {unknown[0]}")
    return tuple(_PROFILE_BY_DOMAIN[domain] for domain in domains)


def _profile_descriptor(profile: ProviderProfile) -> dict[str, Any]:
    return {"domain": profile.domain, "source_registry_id": profile.source_registry_id, "source_role": profile.source_role, "output_kind": profile.output_kind, "query_version": profile.query_version, "tags": profile.tags}


def _read_catalog() -> dict[str, Any]:
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeRequestError("Administrative catalogue is unavailable") from error
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list) or not isinstance(payload.get("metadata"), dict):
        raise RuntimeRequestError("Administrative catalogue is invalid")
    return payload


def _canonical_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    def point(value: Any) -> list[float]: return [round(float(value[0]), 7), round(float(value[1]), 7)]
    def ring(points: Any) -> list[list[float]]:
        normalized = [point(candidate) for candidate in points]
        if normalized[0] != normalized[-1]: normalized.append(normalized[0])
        body = normalized[:-1]
        start = min(range(len(body)), key=lambda index: body[index])
        rotated = body[start:] + body[:start]
        return rotated + [rotated[0]]
    if geometry.get("type") == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(item) for item in geometry["coordinates"]]}
    polygons = [{"type": "Polygon", "coordinates": [ring(item) for item in polygon]} for polygon in geometry.get("coordinates", [])]
    polygons.sort(key=_canonical_json)
    return {"type": "MultiPolygon", "coordinates": [item["coordinates"] for item in polygons]}


def _metric_area_sq_m(geometry: dict[str, Any]) -> float:
    from pyproj import Transformer
    from shapely.ops import transform
    transformer = Transformer.from_crs(WGS84, "EPSG:2180", always_xy=True)
    return float(transform(transformer.transform, shape(geometry)).area)


def _finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise RuntimeRequestError(f"AOI {name} must be finite")
    return float(value)


def _inside_poland(longitude: float, latitude: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = POLAND_BOUNDS
    return min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat


def _geometry_inside_poland(geometry: dict[str, Any]) -> bool:
    min_lon, min_lat, max_lon, max_lat = shape(geometry).bounds
    return _inside_poland(min_lon, min_lat) and _inside_poland(max_lon, max_lat)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
