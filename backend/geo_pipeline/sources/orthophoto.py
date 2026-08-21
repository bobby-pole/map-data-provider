"""Fixture-first Geoportal orthophoto WMS reference adapter."""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlparse

from shapely.geometry import box, shape

from geo_pipeline.source_registry import guard_source_access

ORTHOPHOTO_ADAPTER_VERSION = "geoportal_orthophoto_wms_adapter/v1"
ORTHOPHOTO_WMS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution"
ORTHOPHOTO_WMS_VERSION = "1.3.0"
ORTHOPHOTO_LAYER = "Raster"
ORTHOPHOTO_METADATA_HOST = "mapy.geoportal.gov.pl"


class OrthophotoAdapterError(ValueError):
    """Raised for invalid orthophoto service metadata or reference requests."""


@dataclass(frozen=True)
class OrthophotoLayer:
    name: str
    title: str
    bbox_wgs84: tuple[float, float, float, float]
    metadata_url: str


def parse_capabilities(payload: bytes) -> OrthophotoLayer:
    """Parse only the published high-resolution orthophoto `Raster` layer."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise OrthophotoAdapterError("Orthophoto capabilities XML is invalid") from error
    if root.attrib.get("version") != ORTHOPHOTO_WMS_VERSION:
        raise OrthophotoAdapterError("Orthophoto capabilities WMS version is unsupported")

    layer = next(
        (
            item
            for item in root.iter()
            if _local_name(item.tag) == "Layer" and _text(item, "Name") == ORTHOPHOTO_LAYER
        ),
        None,
    )
    if layer is None:
        raise OrthophotoAdapterError("Orthophoto capabilities schema drift: missing Raster layer")
    crs_values = {
        child.text.strip() for child in layer if _local_name(child.tag) == "CRS" and child.text
    }
    if "EPSG:4326" not in crs_values:
        raise OrthophotoAdapterError("Orthophoto Raster layer is missing EPSG:4326 support")
    bbox = layer.find("{*}EX_GeographicBoundingBox")
    if bbox is None:
        raise OrthophotoAdapterError("Orthophoto Raster layer is missing geographic bounds")
    bounds = tuple(
        float(_text(bbox, field) or "nan")
        for field in (
            "westBoundLongitude",
            "southBoundLatitude",
            "eastBoundLongitude",
            "northBoundLatitude",
        )
    )
    if (
        not all(math.isfinite(value) for value in bounds)
        or bounds[0] >= bounds[2]
        or bounds[1] >= bounds[3]
    ):
        raise OrthophotoAdapterError("Orthophoto Raster layer has invalid geographic bounds")
    metadata_url = _metadata_url(layer)
    if not _is_expected_metadata_url(metadata_url):
        raise OrthophotoAdapterError("Orthophoto Raster metadata URL is unsafe")
    return OrthophotoLayer(
        ORTHOPHOTO_LAYER,
        _text(layer, "Title") or ORTHOPHOTO_LAYER,
        bounds,
        metadata_url,
    )


def reference_descriptor(
    *, aoi_geometry: dict[str, Any], capabilities: bytes | None
) -> dict[str, Any]:
    """Return metadata for a reference background; never return imagery or vectors."""
    return guard_source_access(
        "geoportal_orthophoto",
        "reference",
        lambda: _descriptor(aoi_geometry, capabilities),
    )


def _descriptor(aoi_geometry: dict[str, Any], capabilities: bytes | None) -> dict[str, Any]:
    base = {
        "adapter_version": ORTHOPHOTO_ADAPTER_VERSION,
        "source_registry_id": "geoportal_orthophoto",
        "data_kind": "rendered_imagery",
        "usage_role": "reference",
        "analytical_geojson": False,
        "imagery": {
            "date": {"state": "not_published", "value": None},
            "resolution": {"state": "not_published", "value": None, "unit": "metres"},
        },
        "attribution": "Źródło: Główny Urząd Geodezji i Kartografii (GUGiK), ortofotomapa",
        "limitations": [
            "Orthophoto is a rendered reference image, not analytical GeoJSON or object evidence.",
            "The WMS capabilities snapshot does not publish acquisition date or ground resolution for this layer.",
            "Published coverage does not prove current imagery or local image completeness.",
        ],
    }
    if capabilities is None:
        return {
            **base,
            "status": "service_unavailable",
            "coverage": {"state": "unknown"},
            "get_map": None,
            "metadata_url": None,
        }
    raster = parse_capabilities(capabilities)
    aoi = shape(aoi_geometry)
    if aoi.is_empty:
        raise OrthophotoAdapterError("Orthophoto AOI must not be empty")
    status = "available_reference" if aoi.intersects(box(*raster.bbox_wgs84)) else "uncovered"
    return {
        **base,
        "status": status,
        "title": raster.title,
        "coverage": {
            "state": "possible" if status == "available_reference" else "uncovered",
            "bbox_wgs84": list(raster.bbox_wgs84),
        },
        "get_map": build_getmap_url(aoi.bounds),
        "metadata_url": raster.metadata_url,
    }


def build_getmap_url(bounds_wgs84: tuple[float, float, float, float]) -> str:
    """Build a fixed-parameter WMS request with no caller-controlled host/layer."""
    if len(bounds_wgs84) != 4 or not all(
        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        for value in bounds_wgs84
    ):
        raise OrthophotoAdapterError("Orthophoto WGS84 bounds must contain four finite numbers")
    west, south, east, north = bounds_wgs84
    if west >= east or south >= north:
        raise OrthophotoAdapterError("Orthophoto WGS84 bounds are invalid")
    params = {
        "SERVICE": "WMS",
        "VERSION": ORTHOPHOTO_WMS_VERSION,
        "REQUEST": "GetMap",
        "LAYERS": ORTHOPHOTO_LAYER,
        "STYLES": "",
        "CRS": "EPSG:4326",
        "BBOX": f"{south},{west},{north},{east}",
        "WIDTH": "1024",
        "HEIGHT": "1024",
        "FORMAT": "image/jpeg",
    }
    return f"{ORTHOPHOTO_WMS_URL}?{urlencode(params)}"


def _metadata_url(layer: ET.Element) -> str:
    resource = next(
        (item for item in layer.iter() if _local_name(item.tag) == "OnlineResource"),
        None,
    )
    value = (
        resource.attrib.get("{http://www.w3.org/1999/xlink}href") if resource is not None else None
    )
    if not isinstance(value, str) or not value:
        raise OrthophotoAdapterError("Orthophoto Raster layer is missing metadata URL")
    return value


def _is_expected_metadata_url(value: str) -> bool:
    parsed = urlparse(value)
    return (
        parsed.scheme in {"http", "https"}
        and parsed.hostname == ORTHOPHOTO_METADATA_HOST
        and parsed.path.startswith("/wss/service/")
    )


def _text(element: ET.Element, local_name: str) -> str | None:
    item = next((child for child in element if _local_name(child.tag) == local_name), None)
    return item.text.strip() if item is not None and item.text else None


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
