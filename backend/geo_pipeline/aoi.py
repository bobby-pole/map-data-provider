"""Versioned, deterministic AOI resolution for provider cache identities."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pyproj import Transformer

AOI_CONTRACT_VERSION = "provider_aoi/v1"
WGS84 = "EPSG:4326"
POLAND_METRIC_CRS = "EPSG:2180"
MIN_RADIUS_M = 100
MAX_RADIUS_M = 100_000
MAX_AREA_SQ_M = math.pi * MAX_RADIUS_M**2
_IDENTIFIER = set("abcdefghijklmnopqrstuvwxyz0123456789_")
_TO_METRIC = Transformer.from_crs(WGS84, POLAND_METRIC_CRS, always_xy=True)
_TO_WGS84 = Transformer.from_crs(POLAND_METRIC_CRS, WGS84, always_xy=True)


class AoiResolutionError(ValueError):
    """A deterministic AOI input or registry error."""


@dataclass(frozen=True)
class ResolvedAoi:
    aoi_id: str
    cache_key: str
    geometry: dict[str, Any]
    input_type: str
    source_crs: str
    boundary_provenance: dict[str, Any]
    constraints: dict[str, float]
    aliases: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "aoi_contract_version": AOI_CONTRACT_VERSION,
            "aoi_id": self.aoi_id,
            "cache_key": self.cache_key,
            "geometry": self.geometry,
            "geometry_crs": WGS84,
            "input_type": self.input_type,
            "source_crs": self.source_crs,
            "boundary_provenance": self.boundary_provenance,
            "constraints": self.constraints,
            "aliases": list(self.aliases),
        }


def resolve_aoi(value: str | dict[str, Any]) -> ResolvedAoi:
    """Resolve a registered alias, bounded circle, or approved PRG reference."""
    if isinstance(value, str):
        return _resolve_alias(value)
    if not isinstance(value, dict):
        raise AoiResolutionError("AOI input must be an alias or an object")
    input_type = value.get("type")
    if input_type == "circle":
        return _resolve_circle(value)
    if input_type == "administrative_reference":
        return _resolve_administrative_reference(value)
    raise AoiResolutionError("Unsupported AOI input type")


def validate_cache_key(cache_key: str) -> str:
    if not isinstance(cache_key, str) or not cache_key or set(cache_key) - _IDENTIFIER:
        raise AoiResolutionError("AOI cache key must use lowercase letters, digits and underscores only")
    return cache_key


def _resolve_alias(alias: str) -> ResolvedAoi:
    if alias != "rybnik_60km":
        raise AoiResolutionError(f"Unsupported AOI alias '{alias}'")
    resolved = _resolve_circle({"type": "circle", "longitude": 18.546285, "latitude": 50.102174, "radius_m": 60_000})
    return ResolvedAoi(**{**resolved.__dict__, "cache_key": "rybnik_60km", "aliases": ("rybnik_60km",)})


def _resolve_circle(value: dict[str, Any]) -> ResolvedAoi:
    _require_exact_keys(value, {"type", "longitude", "latitude", "radius_m"})
    longitude = _number(value["longitude"], "longitude")
    latitude = _number(value["latitude"], "latitude")
    radius_m = _number(value["radius_m"], "radius_m")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise AoiResolutionError("Circle coordinates are outside WGS84 bounds")
    if not MIN_RADIUS_M <= radius_m <= MAX_RADIUS_M or math.pi * radius_m**2 > MAX_AREA_SQ_M:
        raise AoiResolutionError("Circle radius exceeds provider AOI limits")
    geometry = _circle_geometry(longitude, latitude, radius_m)
    provenance = {"kind": "request_circle", "source": "caller", "metric_crs": POLAND_METRIC_CRS}
    return _resolved(geometry, "circle", WGS84, provenance, radius_m=radius_m)


def _resolve_administrative_reference(value: dict[str, Any]) -> ResolvedAoi:
    _require_exact_keys(value, {"type", "reference_id"})
    reference_id = value.get("reference_id")
    if reference_id != "prg_gmina_rybnik":
        raise AoiResolutionError("Unsupported administrative AOI reference")
    fixture = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "aoi" / "prg_gmina_rybnik.geojson"
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    if payload.get("type") != "Feature" or not isinstance(payload.get("geometry"), dict):
        raise AoiResolutionError("Approved PRG AOI fixture has invalid geometry")
    geometry = _normalize_polygon(payload["geometry"])
    properties = payload.get("properties", {})
    provenance = {
        "kind": "prg_reference",
        "source_registry_id": "prg_wfs",
        "reference_id": reference_id,
        "snapshot_id": properties.get("snapshot_id"),
        "fixture": "backend/data/fixtures/aoi/prg_gmina_rybnik.geojson",
    }
    return _resolved(geometry, "administrative_reference", str(properties.get("source_crs", WGS84)), provenance, radius_m=None)


def _resolved(
    geometry: dict[str, Any], input_type: str, source_crs: str, provenance: dict[str, Any], *, radius_m: float | None
) -> ResolvedAoi:
    constraints = {"max_area_sq_m": MAX_AREA_SQ_M, "min_radius_m": MIN_RADIUS_M, "max_radius_m": MAX_RADIUS_M}
    if radius_m is not None:
        constraints["radius_m"] = radius_m
    identity = {"aoi_contract_version": AOI_CONTRACT_VERSION, "geometry": geometry, "boundary_provenance": provenance}
    digest = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]
    return ResolvedAoi(
        aoi_id=f"aoi_{digest}",
        cache_key=f"aoi_{digest}",
        geometry=geometry,
        input_type=input_type,
        source_crs=source_crs,
        boundary_provenance=provenance,
        constraints=constraints,
    )


def _circle_geometry(longitude: float, latitude: float, radius_m: float) -> dict[str, Any]:
    center_x, center_y = _TO_METRIC.transform(longitude, latitude)
    coordinates = []
    for step in range(33):
        angle = 2 * math.pi * step / 32
        lon, lat = _TO_WGS84.transform(center_x + radius_m * math.cos(angle), center_y + radius_m * math.sin(angle))
        coordinates.append([round(lon, 7), round(lat, 7)])
    return {"type": "Polygon", "coordinates": [coordinates]}


def _normalize_polygon(geometry: dict[str, Any]) -> dict[str, Any]:
    if geometry.get("type") != "Polygon" or not isinstance(geometry.get("coordinates"), list) or not geometry["coordinates"]:
        raise AoiResolutionError("Administrative AOI geometry must be a Polygon")
    rings: list[list[list[float]]] = []
    for ring in geometry["coordinates"]:
        if not isinstance(ring, list) or len(ring) < 4:
            raise AoiResolutionError("Administrative AOI polygon ring is invalid")
        normalized = []
        for point in ring:
            if not isinstance(point, list) or len(point) != 2:
                raise AoiResolutionError("Administrative AOI coordinate is invalid")
            lon, lat = _number(point[0], "longitude"), _number(point[1], "latitude")
            if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                raise AoiResolutionError("Administrative AOI coordinate is outside WGS84 bounds")
            normalized.append([round(lon, 7), round(lat, 7)])
        if normalized[0] != normalized[-1]:
            raise AoiResolutionError("Administrative AOI polygon ring must be closed")
        rings.append(normalized)
    return {"type": "Polygon", "coordinates": rings}


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise AoiResolutionError(f"AOI {label} must be a finite number")
    return float(value)


def _require_exact_keys(value: dict[str, Any], allowed: set[str]) -> None:
    if set(value) != allowed:
        raise AoiResolutionError("AOI input has unsupported or missing fields")
