"""On-demand, bounded OSM domain packs for selected runtime AOIs."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import mapping, shape

from geo_pipeline.contracts import normalize_analytical_vector_layer
from geo_pipeline.domain_pack import build_map_presentation, domain_pack_root, read_domain_pack, write_domain_pack
from geo_pipeline.bridges import category_for_osm_feature as bridges_category_for_osm_feature
from geo_pipeline.water import category_for_osm_feature as water_category_for_osm_feature
from geo_pipeline.gas import category_for_osm_feature as gas_category_for_osm_feature
from geo_pipeline.emergency import category_for_osm_feature
from geo_pipeline.public_services import category_for_osm_feature as public_category_for_osm_feature
from geo_pipeline.transport import category_for_osm_feature as transport_category_for_osm_feature, road_class_for_osm_feature
from geo_pipeline.extract import configure_osmnx, fetch_osm_features_geometry, sanitize_for_geojson
from geo_pipeline.layers.power import _add_power_categories, _compact_power_properties
from geo_pipeline.query_catalog import BRIDGES_OSM_QUERY, EMERGENCY_OSM_QUERY, GAS_OSM_QUERY, PUBLIC_OSM_QUERY, POWER_OSM_QUERY, TRANSPORT_OSM_QUERY, WATER_OSM_QUERY

RUNTIME_PIPELINE_VERSION = "geo_pipeline/runtime-osm/v3"
_QUERY_BY_DOMAIN = {"power": POWER_OSM_QUERY, "emergency": EMERGENCY_OSM_QUERY, "public": PUBLIC_OSM_QUERY, "transport": TRANSPORT_OSM_QUERY, "bridges": BRIDGES_OSM_QUERY, "water": WATER_OSM_QUERY, "gas": GAS_OSM_QUERY}


def refresh_runtime_osm_domain(*, aoi: dict[str, Any], domain: str, root: Path) -> dict[str, Any]:
    """Acquire one qualified OSM profile, clip it to the true AOI and publish PMTiles atomically."""
    query = _QUERY_BY_DOMAIN.get(domain)
    if query is None:
        raise ValueError(f"Runtime OSM acquisition is not enabled for domain: {domain}")
    configure_osmnx()
    raw = sanitize_for_geojson(fetch_osm_features_geometry(aoi["geometry"], query.tags))
    queried_feature_count = len(raw)
    if domain == "power":
        raw = _compact_power_properties(_add_power_categories(raw))
    elif domain == "emergency":
        raw = _add_emergency_categories(raw)
    elif domain == "public":
        raw = _add_public_categories(raw)
    elif domain == "transport":
        raw = _add_transport_categories(raw)
    elif domain == "bridges":
        raw = _add_bridges_categories(raw)
    elif domain == "water":
        raw = _add_water_categories(raw)
    else:
        raw = _add_gas_categories(raw)
    source = _clip_to_aoi(_geojson_collection(raw), aoi["geometry"])
    return publish_runtime_osm_collection(
        aoi=aoi,
        domain=domain,
        source=source,
        query_version=query.query_version,
        root=root,
        queried_feature_count=queried_feature_count,
    )


def publish_runtime_osm_collection(*, aoi: dict[str, Any], domain: str, source: dict[str, Any], query_version: str, root: Path, queried_feature_count: int | None = None) -> dict[str, Any]:
    """Publish already-acquired OSM GeoJSON; kept separate for offline contract tests."""
    layers = _domain_layers(domain, source)
    if not layers:
        return {
            "status": "needs_source",
            "detail": "The qualified OpenStreetMap query returned no renderable features inside this AOI.",
            "artifact_aoi_id": None,
            "cache_status": "missing",
            "queried_feature_count": queried_feature_count if queried_feature_count is not None else len(source["features"]),
            "accepted_feature_count": 0,
            "derived_feature_count": 0,
        }
    snapshot_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    manifest, files = _pack_payload(aoi=aoi, domain=domain, query_version=query_version, snapshot_at=snapshot_at, layers=layers)
    pack = write_domain_pack(aoi["aoi_id"], domain, root=root, manifest=manifest, files=files)
    build_map_presentation(pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack)
    read_domain_pack(aoi["aoi_id"], domain, root=root)
    derived_feature_count = len(layers.get(f"{domain}.inspection_points", []))
    accepted_feature_count = sum(len(features) for layer_id, features in layers.items() if layer_id != f"{domain}.inspection_points")
    return {
        "status": "ready",
        "detail": "A bounded OpenStreetMap runtime artifact was acquired, validated and cached for this AOI.",
        "artifact_aoi_id": aoi["aoi_id"],
        "cache_status": "fresh",
        "queried_feature_count": queried_feature_count if queried_feature_count is not None else accepted_feature_count,
        "accepted_feature_count": accepted_feature_count,
        "derived_feature_count": derived_feature_count,
    }


def _add_emergency_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: category_for_osm_feature(dict(row)) or "other", axis=1)
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_public_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: public_category_for_osm_feature(dict(row)) or "other", axis=1)
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_transport_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: transport_category_for_osm_feature(dict(row)) or "other", axis=1)
    filtered = enriched[enriched["provider_category"] != "other"].copy()
    if not filtered.empty:
        filtered["road_class"] = filtered.apply(
            lambda row: road_class_for_osm_feature(dict(row)) if row.get("provider_category") == "roads" else None,
            axis=1,
        )
    return filtered


def _add_bridges_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: bridges_category_for_osm_feature(dict(row)) or "other", axis=1)
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_water_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: water_category_for_osm_feature(dict(row)) or "other", axis=1)
    return enriched[enriched["provider_category"] != "other"].copy()


def _add_gas_categories(frame: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if frame.empty:
        return frame
    enriched = frame.copy()
    enriched["provider_category"] = enriched.apply(lambda row: gas_category_for_osm_feature(dict(row)) or "other", axis=1)
    return enriched[enriched["provider_category"] != "other"].copy()


def _geojson_collection(frame: gpd.GeoDataFrame) -> dict[str, Any]:
    if frame.empty:
        return {"type": "FeatureCollection", "features": []}
    return json.loads(frame.to_json())


def _clip_to_aoi(collection: dict[str, Any], geometry: dict[str, Any]) -> dict[str, Any]:
    boundary = shape(geometry)
    features = []
    for feature in collection["features"]:
        candidate = shape(feature["geometry"])
        clipped = candidate.intersection(boundary)
        if clipped.is_empty or clipped.geom_type not in {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}:
            continue
        features.append({**feature, "geometry": mapping(clipped)})
    return {"type": "FeatureCollection", "features": features}


def _domain_layers(domain: str, collection: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    if domain == "power":
        lines = [feature for feature in collection["features"] if feature["geometry"]["type"] in {"LineString", "MultiLineString"}]
        assets = [feature for feature in collection["features"] if feature["geometry"]["type"] not in {"LineString", "MultiLineString"}]
        return {key: value for key, value in {"power.lines": lines, "power.assets": assets}.items() if value}
    if domain == "emergency":
        return {"emergency.facilities": collection["features"]} if collection["features"] else {}
    grouped: dict[str, list[dict[str, Any]]] = {}
    for feature in collection["features"]:
        category = feature.get("properties", {}).get("provider_category")
        if isinstance(category, str):
            grouped.setdefault(f"{domain}.{category}", []).append(feature)
    inspection_points = []
    for layer_id, features in grouped.items():
        for feature in features:
            geometry = shape(feature["geometry"])
            if geometry.geom_type == "Point":
                continue
            properties = dict(feature.get("properties", {}))
            properties.update({
                "origin_artifact": layer_id,
                "origin_source_id": f"{properties.get('element', 'feature')}/{properties.get('id')}",
                "source_geometry_type": geometry.geom_type,
            })
            inspection_points.append({"type": "Feature", "properties": properties, "geometry": mapping(geometry.representative_point())})
    if inspection_points:
        grouped[f"{domain}.inspection_points"] = inspection_points
    return grouped


def _pack_payload(*, aoi: dict[str, Any], domain: str, query_version: str, snapshot_at: str, layers: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, Any], dict[str, bytes]]:
    limitations = [
        "OSM completeness varies by area and object type.",
        "A passed provider validation does not prove complete real-world infrastructure coverage.",
        "This is an on-demand bounded snapshot; refresh after 24 hours to obtain a new source response.",
    ]
    provenance = [{"source_id": "openstreetmap", "contribution_role": "primary"}]
    files: dict[str, bytes] = {}
    artifacts = []
    first_metadata: dict[str, Any] | None = None
    for layer_id, features in layers.items():
        metadata = {
            "cache_layout_version": "provider_cache/v1", "geojson_contract_version": "provider_geojson/v1",
            "aoi_id": aoi["aoi_id"], "domain": domain, "layer_id": layer_id, "source": "OpenStreetMap",
            "source_type": "analytical_vector", "source_registry_id": "openstreetmap", "source_url": "https://overpass-api.de/api/interpreter",
            "source_query": f"On-demand bounded OSM query for {domain} inside resolved provider AOI.", "snapshot_at": snapshot_at,
            "pipeline_version": RUNTIME_PIPELINE_VERSION, "query_version": query_version, "validation_status_raw": "warning",
            "quality_status": "warning", "confidence": "medium", "limitations": limitations, "eligible_for_analysis": True,
            "readiness": "usable_with_limitations",
        }
        layer = normalize_analytical_vector_layer({"type": "FeatureCollection", "features": features}, metadata=metadata)
        payload = json.dumps(layer, ensure_ascii=False, indent=2).encode("utf-8")
        relative = f"layers/{layer_id}.geojson"
        files[relative] = payload
        artifacts.append({"id": layer_id, "kind": "processed_vector", "format": "geojson", "path": relative, "sha256": _digest(payload), "feature_count": len(layer["features"]), "source_provenance": provenance, "public_export": True})
        first_metadata = layer["metadata"]
    assert first_metadata is not None
    readiness = {"cache_layout_version": "provider_cache/v1", "aoi_id": aoi["aoi_id"], "domain": domain, "layer_id": first_metadata["layer_id"], "readiness": "usable_with_limitations", "quality_status": "warning", "highest_issue_severity": "medium", "feature_count": first_metadata["feature_count"], "evaluated_at": snapshot_at}
    files["validation/metadata.json"] = json.dumps(first_metadata, ensure_ascii=False, indent=2).encode("utf-8")
    files["readiness/readiness.json"] = json.dumps(readiness, ensure_ascii=False, indent=2).encode("utf-8")
    return ({"domain_pack_version": "provider_domain_pack/v2", "aoi_id": aoi["aoi_id"], "domain": domain, "source_provenance": provenance, "artifacts": artifacts, "validation": {"path": "validation/metadata.json"}, "readiness": {"path": "readiness/readiness.json"}}, files)


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
