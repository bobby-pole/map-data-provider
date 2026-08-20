#!/usr/bin/env python3
"""Build the versioned national PRG administrative catalogue used by MDQ-054.

The official GUGiK FeatureServer is queried only by this explicit maintenance
command. The preview and API remain cache/file backed at runtime.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


SERVICE_ROOT = "https://mapy.geoportal.gov.pl/wss/ims/maps/PRG_gugik_wyszukiwarka/FeatureServer"
LAYERS = ((0, "gmina"), (1, "county"), (2, "voivodeship"))
PAGE_SIZE = 1000


def fetch_json(path: str, parameters: dict[str, str]) -> dict:
    query = urlencode(parameters)
    with urlopen(f"{path}?{query}", timeout=120) as response:  # nosec B310: fixed official public endpoint
        return json.loads(response.read().decode("utf-8"))


def fetch_features(layer_id: int) -> list[dict]:
    path = f"{SERVICE_ROOT}/{layer_id}/query"
    count = fetch_json(path, {"where": "1=1", "returnCountOnly": "true", "f": "json"}).get("count")
    if not isinstance(count, int) or count <= 0:
        raise RuntimeError(f"PRG layer {layer_id} returned no usable feature count")
    features: list[dict] = []
    for offset in range(0, count, PAGE_SIZE):
        payload = fetch_json(path, {
            "where": "1=1", "outFields": "id,teryt,nazwa", "returnGeometry": "true", "f": "geojson",
            "outSR": "4326", "geometryPrecision": "5", "maxAllowableOffset": "0.0001",
            "resultOffset": str(offset), "resultRecordCount": str(PAGE_SIZE),
        })
        page = payload.get("features")
        if not isinstance(page, list):
            raise RuntimeError(f"PRG layer {layer_id} page at offset {offset} is invalid")
        features.extend(page)
    if len(features) != count:
        raise RuntimeError(f"PRG layer {layer_id} expected {count} features but received {len(features)}")
    return features


def unit_id(kind: str, teryt: str) -> str:
    return f"{kind}_{teryt}"


def parent_id(kind: str, teryt: str) -> str | None:
    if kind == "voivodeship":
        return None
    if kind == "county":
        return unit_id("voivodeship", teryt[:2])
    return unit_id("county", teryt[:4])


def catalog_feature(kind: str, feature: dict) -> dict:
    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        raise RuntimeError(f"PRG {kind} feature is missing geometry or properties")
    teryt, name = properties.get("teryt"), properties.get("nazwa")
    if not isinstance(teryt, str) or not teryt.isdigit() or not isinstance(name, str) or not name.strip():
        raise RuntimeError(f"PRG {kind} feature has invalid TERYT/name")
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise RuntimeError(f"PRG {kind} '{teryt}' has non-polygon geometry")
    return {
        "type": "Feature",
        "properties": {"id": unit_id(kind, teryt), "kind": kind, "name": name.strip(), "prg_id": teryt, "parent_id": parent_id(kind, teryt)},
        "geometry": geometry,
    }


def build_catalog(output: Path, snapshot_at: str) -> dict:
    by_kind = {kind: [catalog_feature(kind, item) for item in fetch_features(layer_id)] for layer_id, kind in LAYERS}
    identifiers = {feature["properties"]["id"] for features in by_kind.values() for feature in features}
    missing_parents = [feature["properties"]["id"] for features in by_kind.values() for feature in features if feature["properties"]["parent_id"] and feature["properties"]["parent_id"] not in identifiers]
    if missing_parents:
        raise RuntimeError(f"PRG hierarchy has missing parent for {missing_parents[0]}")
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "catalog_version": "prg_administrative_catalog/v2",
            "source_registry_id": "prg_wfs",
            "snapshot_at": snapshot_at,
            "source_crs": "EPSG:4326",
            "source_url": SERVICE_ROOT,
            "source_layers": {"gmina": 0, "county": 1, "voivodeship": 2},
            "geometry_generalization": "Official PRG polygons returned in EPSG:4326 with maxAllowableOffset=0.0001 degrees for interactive selection; never use a bounding rectangle as the AOI boundary.",
            "limitations": [
                "Versioned local PRG catalogue for administrative selection; refresh only through this explicit maintenance command.",
                "The preview receives a compact hierarchy index and requests selected official PRG boundary geometries on demand.",
                "A selected geometry remains subject to provider AOI area safeguards before any OSM acquisition.",
            ],
            "feature_counts": {kind: len(features) for kind, features in by_kind.items()},
        },
        "features": [feature for kind in ("voivodeship", "county", "gmina") for feature in by_kind[kind]],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return payload["metadata"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("backend/data/fixtures/aoi/prg_administrative_catalog.geojson"))
    parser.add_argument("--snapshot-at", default=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    args = parser.parse_args()
    metadata = build_catalog(args.output, args.snapshot_at)
    print(json.dumps({"output": str(args.output), **metadata}, ensure_ascii=False))


if __name__ == "__main__":
    main()
