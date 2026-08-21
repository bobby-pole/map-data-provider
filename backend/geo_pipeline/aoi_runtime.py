"""AOI v2 request resolution and fixture-first provider runtime contracts."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from geo_pipeline.aoi import AoiResolutionError, MAX_AREA_SQ_M, WGS84, _resolved, resolve_aoi
from geo_pipeline.query_catalog import GAS_OSM_QUERY, POWER_OSM_QUERY, SEWER_OSM_QUERY, TRANSPORT_OSM_QUERY, WATER_OSM_QUERY, INDUSTRIAL_OSM_QUERY, TELECOM_OSM_QUERY, DISTRICT_HEATING_OSM_QUERY

AOI_REQUEST_CONTRACT_VERSION = "provider_aoi_request/v2"
RUNTIME_CONTRACT_VERSION = "provider_runtime/v2"
# v18 records retryable per-domain acquisition failures in a publishable snapshot.
PIPELINE_VERSION = "geo_pipeline/runtime/v18"
CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "aoi" / "prg_administrative_catalog.geojson"
POLAND_BOUNDS = (14.05, 49.0, 24.25, 55.0)
ProfileOutcome = Literal["ready", "needs_source", "reference_only", "pending_qualification", "failed"]


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
    ProviderProfile("sewer", SEWER_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", SEWER_OSM_QUERY.query_version, SEWER_OSM_QUERY.tags, True),
    ProviderProfile("industrial", INDUSTRIAL_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", INDUSTRIAL_OSM_QUERY.query_version, INDUSTRIAL_OSM_QUERY.tags, True),
    ProviderProfile("telecom", TELECOM_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", TELECOM_OSM_QUERY.query_version, TELECOM_OSM_QUERY.tags, True),
    ProviderProfile("district_heating", DISTRICT_HEATING_OSM_QUERY.source_registry_id, "analytical", "analytical_vector", DISTRICT_HEATING_OSM_QUERY.query_version, DISTRICT_HEATING_OSM_QUERY.tags, True),
)
_PROFILE_BY_DOMAIN = {profile.domain: profile for profile in PROFILES}


class RuntimeRequestError(ValueError):
    """Typed, deterministic invalid AOI/runtime request."""


def administrative_catalog() -> dict[str, Any]:
    payload = _read_catalog()
    metadata = payload["metadata"]
    # Deliberately omit 41 MB of national geometry from the selector response.
    # Selected boundaries are served through administrative_boundary() instead.
    units = [{
        "id": properties["id"], "kind": properties["kind"], "name": properties["name"], "prg_id": properties["prg_id"], "parent_id": properties.get("parent_id"),
    } for feature in payload["features"] for properties in [feature["properties"]]]
    return {
        "catalog_version": metadata["catalog_version"], "source_registry_id": metadata["source_registry_id"], "snapshot_at": metadata["snapshot_at"], "source_crs": metadata["source_crs"],
        "source_url": metadata["source_url"], "limitations": metadata["limitations"], "units": units,
    }


def administrative_boundary(unit_ids: list[Any]) -> dict[str, Any]:
    """Resolve a real selected PRG union for map preview without acquisition."""
    resolved, area_sq_m = _administrative_selection(unit_ids)
    return {
        "response_version": "provider_administrative_boundary/v1",
        "aoi": resolved.as_dict(),
        "metric_area_sq_m": area_sq_m,
        "within_provider_area_limit": area_sq_m <= MAX_AREA_SQ_M,
        "message": "Selected PRG boundary is within the current provider area limit." if area_sq_m <= MAX_AREA_SQ_M else "Selected PRG boundary exceeds the current provider area limit; it can be viewed but cannot start OSM acquisition.",
    }


def preflight_runtime_request(value: dict[str, Any]) -> dict[str, Any]:
    """Return a typed pre-acquisition decision; do not invoke the OSM worker."""
    if not isinstance(value, dict) or set(value) != {"aoi", "profiles"}:
        raise RuntimeRequestError("AOI runtime request requires only aoi and profiles")
    _resolve_profiles(value["profiles"])
    aoi_value = value["aoi"]
    if isinstance(aoi_value, dict) and aoi_value.get("type") == "administrative_selection":
        if set(aoi_value) != {"type", "unit_ids"} or not isinstance(aoi_value["unit_ids"], list) or not aoi_value["unit_ids"]:
            raise RuntimeRequestError("Administrative AOI requires one or more unit_ids")
        resolved, area_sq_m = _administrative_selection(aoi_value["unit_ids"])
        if area_sq_m > MAX_AREA_SQ_M:
            return {
                "response_version": "provider_aoi_preflight/v1", "status": "blocked", "code": "aoi_area_limit",
                "message": f"The selected PRG boundary is {round(area_sq_m / 1_000_000, 1)} km²; the current bounded provider limit is {round(MAX_AREA_SQ_M / 1_000_000, 1)} km². It was not sent to Overpass.",
                "aoi": resolved.as_dict(), "metric_area_sq_m": area_sq_m,
            }
    else:
        resolved = _resolve_runtime_aoi(aoi_value)
        area_sq_m = _metric_area_sq_m(resolved.geometry)
    return {
        "response_version": "provider_aoi_preflight/v1", "status": "ready", "code": "bounded_provider_request",
        "message": "The selected AOI is within the current provider area limit. Cache lookup can proceed; OSM is contacted only for a cache miss.",
        "aoi": resolved.as_dict(), "metric_area_sq_m": area_sq_m,
    }


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
    is_rybnik_demo = resolved["aoi"]["aoi_id"] == resolve_aoi("rybnik_35km").aoi_id
    outcomes = []
    for descriptor in resolved["profiles"]:
        profile = _PROFILE_BY_DOMAIN[descriptor["domain"]]
        if fixture_mode and is_rybnik_demo and profile.fixture_ready:
            status: ProfileOutcome = "ready"
            detail = "Committed bounded fixture artifacts are available for the Rybnik demo AOI."
            artifact_aoi_id: str | None = "rybnik_35km"
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
            "failure_reason": None,
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
        if domain in {"power", "water", "gas", "sewer", "telecom", "district_heating"}:
            records.append(_context(domain, "kiut_gesut_wms", "reference_descriptor", "reference_only", "KIUT/GESUT is rendered reference imagery and cannot enter analytical GeoJSON."))
        records.append(_context(domain, "geoportal_orthophoto", "reference_descriptor", "reference_only", "Orthophoto is an optional rendered reference and cannot become an object vector."))
        if domain == "water":
            records.append(_context(domain, "nmt_nmpt", "derived_context", "needs_source", "NMT/NMPT may provide labelled raster-derived context only after a bounded source artifact is supplied."))
    return records


def _context(domain: str, source_registry_id: str, output_kind: str, status: ProfileOutcome, detail: str) -> dict[str, Any]:
    return {"domain": domain, "source_registry_id": source_registry_id, "output_kind": output_kind, "status": status, "detail": detail}


MAX_CUSTOM_RADIUS_M = 20_000
MAX_COUNTIES_SELECTION = 3


def _resolve_runtime_aoi(value: Any):
    if not isinstance(value, dict):
        raise RuntimeRequestError("AOI must be an object")
    kind = value.get("type")
    if kind == "point_radius":
        if set(value) != {"type", "longitude", "latitude", "radius_m"}:
            raise RuntimeRequestError("Point/radius AOI has unsupported or missing fields")
        longitude, latitude = _finite(value["longitude"], "longitude"), _finite(value["latitude"], "latitude")
        radius_m = _finite(value["radius_m"], "radius_m")
        if radius_m > MAX_CUSTOM_RADIUS_M and (longitude, latitude, radius_m) != (18.546285, 50.102174, 35_000):
            raise RuntimeRequestError(f"Point/radius AOI radius cannot exceed {int(MAX_CUSTOM_RADIUS_M / 1000)} km ({MAX_CUSTOM_RADIUS_M} m)")
        if not _inside_poland(longitude, latitude):
            raise RuntimeRequestError("Point/radius centre must be inside Poland")
        try:
            resolved = resolve_aoi({"type": "circle", "longitude": longitude, "latitude": latitude, "radius_m": radius_m})
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
    resolved, area_sq_m = _administrative_selection(unit_ids)
    if area_sq_m > MAX_AREA_SQ_M:
        raise RuntimeRequestError("Administrative AOI exceeds provider area limits; use a smaller county, gmina or explicit union")
    return resolved


_LEGACY_UNIT_ALIASES = {
    "county_rybnik_city": "county_2473",
    "county_rybnicki": "county_2412",
    "gmina_rybnik": "gmina_2473011",
}


def _are_counties_contiguous(county_ids: list[str], by_id: dict[str, dict[str, Any]]) -> bool:
    if len(county_ids) <= 1:
        return True
    geoms = {cid: shape(by_id[cid]["geometry"]) for cid in county_ids}
    adj: dict[str, set[str]] = {cid: set() for cid in county_ids}
    c_list = list(county_ids)
    for i in range(len(c_list)):
        for j in range(i + 1, len(c_list)):
            c1, c2 = c_list[i], c_list[j]
            g1, g2 = geoms[c1], geoms[c2]
            if g1.touches(g2) or g1.intersects(g2) or g1.distance(g2) < 0.001:
                adj[c1].add(c2)
                adj[c2].add(c1)
    visited: set[str] = set()
    queue = [c_list[0]]
    visited.add(c_list[0])
    while queue:
        curr = queue.pop(0)
        for neighbor in adj[curr]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return len(visited) == len(county_ids)


def _validate_administrative_selection(unit_ids: list[str], by_id: dict[str, dict[str, Any]]) -> None:
    voivodeship_units = [uid for uid in unit_ids if by_id[uid]["properties"].get("kind") == "voivodeship"]
    if voivodeship_units:
        raise RuntimeRequestError(
            "Selecting an entire voivodeship is not allowed. Select up to 3 adjacent counties or their gminas."
        )

    selected_voivodeships = {_administrative_voivodeship_id(uid, by_id) for uid in unit_ids}
    if len(selected_voivodeships) > 1:
        raise RuntimeRequestError("Administrative selection must stay within one voivodeship")

    involved_counties: set[str] = set()
    for uid in unit_ids:
        unit = by_id[uid]["properties"]
        kind = unit.get("kind")
        if kind == "county":
            involved_counties.add(uid)
        elif kind == "gmina":
            parent = unit.get("parent_id")
            if parent:
                involved_counties.add(parent)

    if len(involved_counties) > MAX_COUNTIES_SELECTION:
        raise RuntimeRequestError(f"Administrative selection cannot span more than {MAX_COUNTIES_SELECTION} adjacent counties")

    if len(involved_counties) > 1:
        if not _are_counties_contiguous(list(involved_counties), by_id):
            raise RuntimeRequestError("Selected counties and gminas must belong to directly adjacent counties")


def _administrative_selection(unit_ids: list[Any]):
    if not all(isinstance(item, str) and item for item in unit_ids):
        raise RuntimeRequestError("Administrative unit IDs must be non-empty strings")
    requested_ids = sorted(set(unit_ids))
    normalized_ids = sorted({_LEGACY_UNIT_ALIASES.get(unit_id, unit_id) for unit_id in requested_ids})
    payload = _read_catalog()
    metadata = payload["metadata"]
    by_id = {feature["properties"]["id"]: feature for feature in payload["features"]}
    unknown = [unit_id for unit_id in normalized_ids if unit_id not in by_id]
    if unknown:
        raise RuntimeRequestError(f"Unknown administrative unit: {unknown[0]}")
    _validate_administrative_selection(normalized_ids, by_id)
    merged = unary_union([_valid_polygonal_geometry(shape(by_id[unit_id]["geometry"])) for unit_id in normalized_ids])
    if merged.is_empty or not merged.is_valid or merged.geom_type not in {"Polygon", "MultiPolygon"}:
        raise RuntimeRequestError("Administrative selection did not produce a valid polygonal AOI")
    geometry = _canonical_geometry(mapping(merged))
    provenance = {
        "kind": "prg_administrative_selection", "source_registry_id": metadata["source_registry_id"], "catalog_version": metadata["catalog_version"], "snapshot_at": metadata["snapshot_at"],
        "source_url": metadata["source_url"], "unit_ids": normalized_ids, "requested_unit_ids": requested_ids, "fixture": "backend/data/fixtures/aoi/prg_administrative_catalog.geojson",
    }
    return _resolved(geometry, "administrative_selection", metadata["source_crs"], provenance, radius_m=None), _metric_area_sq_m(geometry)


def _administrative_voivodeship_id(unit_id: str, by_id: dict[str, dict[str, Any]]) -> str:
    current = by_id[unit_id]
    visited: set[str] = set()
    while current["properties"].get("parent_id"):
        current_id = current["properties"]["id"]
        if current_id in visited:
            raise RuntimeRequestError("Administrative catalogue hierarchy is invalid")
        visited.add(current_id)
        parent_id = current["properties"]["parent_id"]
        parent = by_id.get(parent_id)
        if parent is None:
            raise RuntimeRequestError("Administrative catalogue hierarchy is invalid")
        current = parent
    if current["properties"].get("kind") != "voivodeship":
        raise RuntimeRequestError("Administrative catalogue hierarchy is invalid")
    return current["properties"]["id"]


def _valid_polygonal_geometry(geometry: Any):
    """Repair only invalid PRG topology introduced by the interactive generalisation."""
    candidate = make_valid(geometry) if not geometry.is_valid else geometry
    if candidate.geom_type == "GeometryCollection":
        polygonal = [item for item in candidate.geoms if item.geom_type in {"Polygon", "MultiPolygon"}]
        candidate = unary_union(polygonal) if polygonal else candidate
    if candidate.geom_type not in {"Polygon", "MultiPolygon"} or candidate.is_empty:
        raise RuntimeRequestError("Administrative catalogue geometry is invalid")
    return candidate


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


@lru_cache(maxsize=1)
def _read_catalog() -> dict[str, Any]:
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeRequestError("Administrative catalogue is unavailable") from error
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list) or not isinstance(payload.get("metadata"), dict):
        raise RuntimeRequestError("Administrative catalogue is invalid")
    metadata = payload["metadata"]
    if metadata.get("catalog_version") != "prg_administrative_catalog/v2" or metadata.get("source_registry_id") != "prg_wfs" or metadata.get("source_crs") != WGS84 or not isinstance(metadata.get("source_url"), str):
        raise RuntimeRequestError("Administrative catalogue metadata is invalid")
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
