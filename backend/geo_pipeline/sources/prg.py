"""Bounded PRG WFS/GML adapter with deterministic offline fixture support."""

from __future__ import annotations

import hashlib
import json
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from pyproj import Transformer
from shapely.geometry import mapping as geometry_mapping
from shapely.geometry import shape

from geo_pipeline.source_registry import guard_source_access

PRG_WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries"
PRG_SOURCE_CRS = "EPSG:2180"
PRG_INTERCHANGE_CRS = "EPSG:4326"
PRG_ADAPTER_VERSION = "prg_adapter/v1"

PRG_FEATURE_TYPES = {
    "ms:A01_Granice_wojewodztw": {
        "source_class": "wojewodztwo",
        "normalized_role": "administrative_boundary",
        "boundary": True,
    },
    "ms:A02_Granice_powiatow": {
        "source_class": "powiat",
        "normalized_role": "administrative_boundary",
        "boundary": True,
    },
    "ms:A03_Granice_gmin": {
        "source_class": "gmina",
        "normalized_role": "administrative_boundary",
        "boundary": True,
    },
    "ms:K01_Komenda_wojewodzka_policji": {
        "source_class": "police_command_voivodeship",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K02_Komenda_powiatowa_policji": {
        "source_class": "police_command_county",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K03_Komenda_stoleczna_policji": {
        "source_class": "police_command_capital",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K04_Komenda_rejonowa_policji": {
        "source_class": "police_command_district",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K05_Komisariat_policji": {
        "source_class": "police_station",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K06_Komenda_wojewodzka_strazy_pozarnej": {
        "source_class": "fire_command_voivodeship",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
    "ms:K07_Komenda_powiatowa_strazy_pozarnej": {
        "source_class": "fire_command_county",
        "normalized_role": "official_public_service",
        "boundary": False,
    },
}

GML = "{http://www.opengis.net/gml/3.2}"
WFS = "{http://www.opengis.net/wfs/2.0}"
_TO_WGS84 = Transformer.from_crs(PRG_SOURCE_CRS, PRG_INTERCHANGE_CRS, always_xy=True)


class PrgAdapterError(ValueError):
    """Raised for a malformed PRG capability, schema or fixture response."""


@dataclass(frozen=True)
class PrgAdapterOutcome:
    status: str
    feature_type: str
    feature_count: int
    evidence: dict[str, Any]


def build_getfeature_url(
    feature_type: str, *, bbox_2180: tuple[float, float, float, float] | None = None
) -> str:
    """Build an allow-listed WFS 2.0 GML request; no client endpoint/type is accepted."""
    _feature_definition(feature_type)
    params: dict[str, str] = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": feature_type,
        "SRSNAME": PRG_SOURCE_CRS,
        "OUTPUTFORMAT": "application/gml+xml; version=3.2",
    }
    if bbox_2180 is not None:
        if len(bbox_2180) != 4:
            raise PrgAdapterError("PRG BBOX must contain four EPSG:2180 values")
        params["BBOX"] = ",".join(str(value) for value in bbox_2180) + ",EPSG:2180"
    return f"{PRG_WFS_URL}?{urlencode(params)}"


def fetch_gml(
    feature_type: str,
    request: Callable[[str], bytes],
    *,
    bbox_2180: tuple[float, float, float, float] | None = None,
) -> bytes:
    """Guard live PRG access; the offline fixture path never calls this function."""
    url = build_getfeature_url(feature_type, bbox_2180=bbox_2180)
    return guard_source_access("prg_wfs", "acquisition", lambda: request(url))


def capability_feature_types(payload: bytes) -> set[str]:
    """Return advertised WFS type names from a raw GetCapabilities snapshot."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise PrgAdapterError("PRG capabilities XML is invalid") from error
    names = {
        element.text.strip()
        for element in root.iter()
        if _local_name(element.tag) == "Name"
        and isinstance(element.text, str)
        and element.text.strip().startswith("ms:")
    }
    return names


def schema_field_names(payload: bytes) -> set[str]:
    """Return the feature fields from a raw DescribeFeatureType snapshot."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise PrgAdapterError("PRG schema XML is invalid") from error
    return {
        element.attrib["name"]
        for element in root.iter()
        if _local_name(element.tag) == "element" and isinstance(element.attrib.get("name"), str)
    }


def inspect_fixture(
    *,
    feature_type: str,
    capabilities: bytes,
    schema: bytes,
    gml: bytes | None,
    snapshot_at: str,
) -> PrgAdapterOutcome:
    """Evaluate fixture evidence without network access and normalize valid GML."""
    definition = _feature_definition(feature_type)
    if feature_type not in capability_feature_types(capabilities):
        return _outcome(
            "service_unavailable",
            feature_type,
            0,
            snapshot_at,
            reason="feature_type_not_advertised",
        )
    fields = schema_field_names(schema)
    required = {"msGeometry", "JPT_NAZWA_", "IIP_IDENTY", "JPT_ID"}
    if not required <= fields:
        return _outcome(
            "schema_drift",
            feature_type,
            0,
            snapshot_at,
            missing_fields=sorted(required - fields),
        )
    if gml is None:
        return _outcome(
            "service_unavailable",
            feature_type,
            0,
            snapshot_at,
            reason="fixture_response_missing",
        )
    features = normalize_gml(feature_type, gml, snapshot_at=snapshot_at)
    if not features["features"]:
        return _outcome("empty", feature_type, 0, snapshot_at, raw_sha256=_digest(gml))
    return PrgAdapterOutcome(
        status="available",
        feature_type=feature_type,
        feature_count=len(features["features"]),
        evidence={
            "adapter_version": PRG_ADAPTER_VERSION,
            "source_registry_id": "prg_wfs",
            "source_url": PRG_WFS_URL,
            "source_crs": PRG_SOURCE_CRS,
            "interchange_crs": PRG_INTERCHANGE_CRS,
            "snapshot_at": snapshot_at,
            "raw_sha256": _digest(gml),
            "source_class": definition["source_class"],
            "attribution": "Główny Urząd Geodezji i Kartografii (GUGiK), PRG",
            "terms": "Free reuse of published PRG data; preserve GUGiK attribution, service evidence and snapshot provenance.",
        },
    )


def normalize_gml(feature_type: str, payload: bytes, *, snapshot_at: str) -> dict[str, Any]:
    """Normalize allow-listed raw PRG GML to provider-neutral GeoJSON evidence."""
    definition = _feature_definition(feature_type)
    return guard_source_access(
        "prg_wfs",
        "analytical_processing",
        lambda: _normalize_gml(feature_type, definition, payload, snapshot_at),
    )


def clip_non_boundary_features(
    collection: dict[str, Any], aoi_geometry: dict[str, Any]
) -> dict[str, Any]:
    """Clip only non-boundary PRG features; preserve boundary geometry intact."""
    aoi = shape(aoi_geometry)
    clipped: list[dict[str, Any]] = []
    for feature in collection.get("features", []):
        definition = _feature_definition(feature["properties"]["source_feature_type"])
        geometry = shape(feature["geometry"])
        if not definition["boundary"]:
            geometry = geometry.intersection(aoi)
        if not geometry.is_empty:
            clipped.append(
                {
                    **feature,
                    "geometry": json.loads(json.dumps(geometry_mapping(geometry))),
                }
            )
    return {**collection, "features": clipped}


def _normalize_gml(
    feature_type: str, definition: dict[str, Any], payload: bytes, snapshot_at: str
) -> dict[str, Any]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise PrgAdapterError("PRG GML is invalid") from error
    short_type = feature_type.split(":", 1)[1]
    features = []
    for element in root.iter():
        if _local_name(element.tag) != short_type:
            continue
        geometry = _geometry(element)
        if geometry is None:
            raise PrgAdapterError(f"PRG {feature_type} feature is missing supported geometry")
        raw = {
            _local_name(child.tag): (child.text or "").strip()
            for child in element
            if _local_name(child.tag) != "msGeometry"
        }
        source_feature_id = raw.get("IIP_IDENTY") or raw.get("JPT_ID")
        if not source_feature_id:
            raise PrgAdapterError(f"PRG {feature_type} feature is missing IIP_IDENTY/JPT_ID")
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "source_registry_id": "prg_wfs",
                    "source_feature_type": feature_type,
                    "source_feature_id": source_feature_id,
                    "source_crs": PRG_SOURCE_CRS,
                    "snapshot_at": snapshot_at,
                    "source_class": definition["source_class"],
                    "normalized_role": definition["normalized_role"],
                    "name": raw.get("JPT_NAZWA_"),
                    "source_attributes": raw,
                    "limitations": [
                        "PRG feature presence is not a completeness or operational-status guarantee."
                    ],
                },
                "geometry": geometry,
            }
        )
    return {
        "type": "FeatureCollection",
        "metadata": {
            "source_registry_id": "prg_wfs",
            "feature_type": feature_type,
            "source_crs": PRG_SOURCE_CRS,
            "snapshot_at": snapshot_at,
        },
        "features": features,
    }


def _geometry(element: ET.Element) -> dict[str, Any] | None:
    polygon = element.find(f".//{GML}Polygon")
    if polygon is not None:
        pos_list = polygon.find(f".//{GML}posList")
        if pos_list is None or not pos_list.text:
            return None
        values = [float(value) for value in pos_list.text.split()]
        if len(values) < 8 or len(values) % 2:
            return None
        coordinates = [
            _to_wgs84(values[index], values[index + 1]) for index in range(0, len(values), 2)
        ]
        return {"type": "Polygon", "coordinates": [coordinates]}
    point = element.find(f".//{GML}Point")
    if point is not None:
        pos = point.find(f".//{GML}pos")
        if pos is None or not pos.text:
            return None
        values = [float(value) for value in pos.text.split()]
        if len(values) != 2:
            return None
        return {"type": "Point", "coordinates": _to_wgs84(values[0], values[1])}
    return None


def _to_wgs84(northing: float, easting: float) -> list[float]:
    longitude, latitude = _TO_WGS84.transform(easting, northing)
    return [round(longitude, 7), round(latitude, 7)]


def _feature_definition(feature_type: str) -> dict[str, Any]:
    try:
        return PRG_FEATURE_TYPES[feature_type]
    except KeyError as error:
        raise PrgAdapterError(f"Unsupported PRG feature type: {feature_type}") from error


def _outcome(
    status: str, feature_type: str, feature_count: int, snapshot_at: str, **extra: Any
) -> PrgAdapterOutcome:
    return PrgAdapterOutcome(
        status=status,
        feature_type=feature_type,
        feature_count=feature_count,
        evidence={
            "adapter_version": PRG_ADAPTER_VERSION,
            "source_registry_id": "prg_wfs",
            "snapshot_at": snapshot_at,
            **extra,
        },
    )


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1]
