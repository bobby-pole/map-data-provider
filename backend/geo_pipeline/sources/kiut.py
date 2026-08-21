"""Fixture-first KIUT/GESUT WMS reference-overlay and coverage adapter."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from shapely.geometry import box, shape

from geo_pipeline.source_registry import guard_source_access

KIUT_ADAPTER_VERSION = "kiut_wms_adapter/v1"
KIUT_WMS_URL = "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu"
KIUT_WMS_VERSION = "1.3.0"
KIUT_UTILITY_LAYERS = {
    "power": "przewod_elektroenergetyczny",
    "water": "przewod_wodociagowy",
    "gas": "przewod_gazowy",
    "sewer": "przewod_kanalizacyjny",
    "telecom": "przewod_telekomunikacyjny",
    "district_heating": "przewod_cieplowniczy",
}


class KiutAdapterError(ValueError):
    """Raised for invalid KIUT capabilities or unsupported reference requests."""


@dataclass(frozen=True)
class KiutLayer:
    name: str
    title: str
    min_scale: float | None
    max_scale: float | None
    bbox_wgs84: tuple[float, float, float, float]
    legend_url: str | None


def parse_capabilities(payload: bytes) -> dict[str, KiutLayer]:
    """Parse the small subset of KIUT WMS capability metadata used by the adapter."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise KiutAdapterError("KIUT capabilities XML is invalid") from error
    if root.attrib.get("version") != KIUT_WMS_VERSION:
        raise KiutAdapterError("KIUT capabilities WMS version is unsupported")
    layers: dict[str, KiutLayer] = {}
    for element in root.iter():
        if _name(element.tag) != "Layer":
            continue
        name = _text(element, "Name")
        if name is None:
            continue
        bbox = element.find("{*}EX_GeographicBoundingBox")
        if bbox is None:
            continue
        bounds = tuple(
            float(_text(bbox, field) or "nan")
            for field in (
                "westBoundLongitude",
                "southBoundLatitude",
                "eastBoundLongitude",
                "northBoundLatitude",
            )
        )
        if any(value != value for value in bounds):
            raise KiutAdapterError(f"KIUT layer {name} has invalid geographic bounds")
        legend = next(
            (
                item.attrib.get("{http://www.w3.org/1999/xlink}href")
                for item in element.iter()
                if _name(item.tag) == "OnlineResource"
                and "GetLegendGraphic" in item.attrib.get("{http://www.w3.org/1999/xlink}href", "")
            ),
            None,
        )
        layers[name] = KiutLayer(
            name,
            _text(element, "Title") or name,
            _number(element, "MinScaleDenominator"),
            _number(element, "MaxScaleDenominator"),
            bounds,
            legend,
        )
    required = set(KIUT_UTILITY_LAYERS.values()) | {"gesut"}
    missing = required - set(layers)
    if missing:
        raise KiutAdapterError(
            f"KIUT capabilities schema drift: missing {', '.join(sorted(missing))}"
        )
    return layers


def reference_descriptor(
    *,
    domain: str,
    aoi_geometry: dict[str, Any],
    scale_denominator: float,
    capabilities: bytes | None,
) -> dict[str, Any]:
    """Return a safe reference-only descriptor; it never returns imagery or vectors."""
    if domain not in KIUT_UTILITY_LAYERS:
        raise KiutAdapterError(f"Unsupported KIUT utility domain: {domain}")
    if (
        not isinstance(scale_denominator, (int, float))
        or isinstance(scale_denominator, bool)
        or scale_denominator <= 0
    ):
        raise KiutAdapterError("KIUT scale denominator must be positive")
    return guard_source_access(
        "kiut_gesut_wms",
        "reference",
        lambda: _descriptor(domain, aoi_geometry, float(scale_denominator), capabilities),
    )


def _descriptor(
    domain: str, aoi_geometry: dict[str, Any], scale: float, capabilities: bytes | None
) -> dict[str, Any]:
    if capabilities is None:
        return {
            "adapter_version": KIUT_ADAPTER_VERSION,
            "source_registry_id": "kiut_gesut_wms",
            "data_kind": "rendered_imagery",
            "usage_role": "reference",
            "analytical_geojson": False,
            "domain": domain,
            "layer": KIUT_UTILITY_LAYERS[domain],
            "status": "service_unavailable",
            "coverage": {"state": "unknown"},
            "scale": {"requested_denominator": scale},
            "get_map": None,
            "legend": None,
            "limitations": [
                "KIUT capabilities are unavailable; no imagery or analytical vector fallback is produced."
            ],
        }
    layers = parse_capabilities(capabilities)
    coverage = layers["gesut"]
    target = layers[KIUT_UTILITY_LAYERS[domain]]
    aoi = shape(aoi_geometry)
    if aoi.is_empty:
        raise KiutAdapterError("KIUT AOI must not be empty")
    if not aoi.intersects(box(*coverage.bbox_wgs84)):
        status = "uncovered"
    elif (target.min_scale is not None and scale < target.min_scale) or (
        target.max_scale is not None and scale > target.max_scale
    ):
        status = "unsupported_scale"
    else:
        status = "available_reference"
    return {
        "adapter_version": KIUT_ADAPTER_VERSION,
        "source_registry_id": "kiut_gesut_wms",
        "data_kind": "rendered_imagery",
        "usage_role": "reference",
        "analytical_geojson": False,
        "domain": domain,
        "layer": target.name,
        "title": target.title,
        "status": status,
        "coverage": {
            "layer": coverage.name,
            "state": "possible" if status != "uncovered" else "uncovered",
            "bbox_wgs84": list(coverage.bbox_wgs84),
        },
        "scale": {
            "requested_denominator": scale,
            "min_denominator": target.min_scale,
            "max_denominator": target.max_scale,
        },
        "get_map": build_getmap_url(target.name, aoi.bounds),
        "legend": build_legend_url(target.name),
        "attribution": "Źródło: Główny Urząd Geodezji i Kartografii (GUGiK), KIUT/GESUT WMS",
        "limitations": [
            "Rendered WMS is reference-only, not analytical GeoJSON.",
            "Coverage possible from a published extent does not prove local utility completeness.",
        ],
    }


def build_getmap_url(layer: str, bounds_wgs84: tuple[float, float, float, float]) -> str:
    if layer not in KIUT_UTILITY_LAYERS.values():
        raise KiutAdapterError("KIUT layer is not allow-listed")
    west, south, east, north = bounds_wgs84
    params = {
        "SERVICE": "WMS",
        "VERSION": KIUT_WMS_VERSION,
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "default",
        "CRS": "EPSG:4326",
        "BBOX": f"{south},{west},{north},{east}",
        "WIDTH": "1024",
        "HEIGHT": "1024",
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
    }
    return f"{KIUT_WMS_URL}?{urlencode(params)}"


def build_legend_url(layer: str) -> str:
    if layer not in KIUT_UTILITY_LAYERS.values():
        raise KiutAdapterError("KIUT layer is not allow-listed")
    return f"{KIUT_WMS_URL}?{urlencode({'SERVICE': 'WMS', 'VERSION': KIUT_WMS_VERSION, 'REQUEST': 'GetLegendGraphic', 'LAYER': layer, 'STYLE': 'default', 'FORMAT': 'image/png'})}"


def _text(element: ET.Element, local_name: str) -> str | None:
    item = next((child for child in element if _name(child.tag) == local_name), None)
    return item.text.strip() if item is not None and item.text else None


def _number(element: ET.Element, local_name: str) -> float | None:
    value = _text(element, local_name)
    return float(value) if value is not None else None


def _name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
