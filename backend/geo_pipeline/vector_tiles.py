"""Deterministic MVT-in-PMTiles presentation artifacts for public provider layers."""

from __future__ import annotations

import hashlib
import html
import json
import math
import shutil
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

import mapbox_vector_tile
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from shapely import STRtree, box, clip_by_rect
from shapely.geometry import mapping, shape

from geo_pipeline.source_registry import (
    load_source_registry,
    validate_ordered_provenance,
)

MAP_PRESENTATION_VERSION = "provider_map_presentation/v1"
PRESENTATION_DIRNAME = "presentation"
MIN_ZOOM = 7
MAX_ZOOM = 14
PRESENTATION_PROPERTY_NAMES = (
    "source",
    "source_id",
    "domain",
    "asset_type",
    # Transport rendering is intentionally class-filtered in MapLibre.  Keep
    # this normalized field in the compact MVT payload rather than requiring
    # the client to infer it from unbounded raw OSM tags.
    "road_class",
    "voltage_state",
    "voltage_bucket",
    "voltage_label",
    "name",
    "ref",
    "operator",
    "confidence",
    "missing_fields",
    "limitations",
)


def build_map_presentation(*, pack_root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Build a compact, offline PMTiles read model from an already validated pack.

    The caller must have validated the parent pack before this function. This function
    intentionally reads only public GeoJSON artifacts and never gives reference or
    private records a route into the derived archive.
    """

    public_artifacts = [
        artifact for artifact in manifest["artifacts"] if _is_public_vector_artifact(artifact)
    ]
    if not public_artifacts:
        raise ValueError(
            "Map presentation requires at least one public analytical GeoJSON artifact"
        )

    registry = load_source_registry()
    source_layers: list[dict[str, Any]] = []
    parent_manifest_bytes = _canonical_json(manifest)
    for artifact in public_artifacts:
        validate_ordered_provenance(artifact["source_provenance"], registry, public_export=True)
        artifact_path = _safe_file(pack_root, artifact["path"])
        payload = artifact_path.read_bytes()
        if _digest(payload) != artifact["sha256"]:
            raise ValueError(
                f"Presentation input '{artifact['id']}' checksum does not match the domain manifest"
            )
        layer = json.loads(payload)
        if layer.get("type") != "FeatureCollection" or not isinstance(layer.get("features"), list):
            raise ValueError(
                f"Presentation input '{artifact['id']}' is not a GeoJSON FeatureCollection"
            )
        metadata = layer.get("metadata")
        if (
            not isinstance(metadata, dict)
            or metadata.get("aoi_id") != manifest["aoi_id"]
            or metadata.get("domain") != manifest["domain"]
        ):
            raise ValueError(
                f"Presentation input '{artifact['id']}' identity does not match the domain manifest"
            )
        if metadata.get("layer_id") != artifact["id"] or metadata.get(
            "feature_count"
        ) != artifact.get("feature_count"):
            raise ValueError(
                f"Presentation input '{artifact['id']}' metadata does not match the domain manifest"
            )
        source_layers.append(
            {
                "artifact": artifact,
                "source_layer": _source_layer_name(artifact["id"]),
                "metadata": metadata,
                "features": layer["features"],
                "source_bytes": len(payload),
            }
        )

    staging = pack_root / f".{PRESENTATION_DIRNAME}-staging-{uuid.uuid4().hex}"
    target = pack_root / PRESENTATION_DIRNAME
    try:
        staging.mkdir(parents=True)
        archive_name = f"{manifest['domain']}.pmtiles"
        archive_path = staging / archive_name
        archive_summary = _write_pmtiles(archive_path, source_layers)
        archive_bytes = archive_path.read_bytes()
        presentation_layers = [_presentation_layer_descriptor(layer) for layer in source_layers]
        bounds = _combined_bounds(source_layers)
        benchmark = {
            "benchmark_version": "provider_map_presentation_benchmark/v1",
            "baseline": {
                "delivery": "full_geojson_to_leaflet",
                "feature_count": sum(len(layer["features"]) for layer in source_layers),
                "payload_bytes": sum(layer["source_bytes"] for layer in source_layers),
            },
            "presentation": {
                "delivery": "pmtiles_mvt_range_reads",
                "archive_bytes": len(archive_bytes),
                "addressed_tiles": archive_summary["addressed_tiles"],
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
            },
        }
        presentation_manifest = {
            "presentation_version": MAP_PRESENTATION_VERSION,
            "aoi_id": manifest["aoi_id"],
            "domain": manifest["domain"],
            "parent_domain_pack": {
                "version": manifest["domain_pack_version"],
                "sha256": _digest(parent_manifest_bytes),
            },
            "archive": {
                "format": "pmtiles",
                "path": archive_name,
                "sha256": _digest(archive_bytes),
                "size_bytes": len(archive_bytes),
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
                "bounds": bounds,
            },
            "layers": presentation_layers,
            "attribution": "; ".join(
                sorted({descriptor["attribution"] for descriptor in presentation_layers})
            ),
            "benchmark": benchmark,
        }
        (staging / "manifest.json").write_bytes(_canonical_json(presentation_manifest))
        (staging / "benchmark.json").write_bytes(_canonical_json(benchmark))
        _validate_presentation_files(staging, manifest)
        _replace_directory(target, staging)
        return presentation_manifest
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def read_map_presentation(*, pack_root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Read and integrity-check presentation metadata without reading source GeoJSON."""

    presentation_root = pack_root / PRESENTATION_DIRNAME
    _validate_presentation_files(presentation_root, manifest)
    return json.loads((presentation_root / "manifest.json").read_text(encoding="utf-8"))


def _write_pmtiles(archive_path: Path, source_layers: list[dict[str, Any]]) -> dict[str, int]:
    tile_features: dict[tuple[int, int, int], dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for source_layer in source_layers:
        features_data: list[tuple[Any, dict[str, str], int]] = []
        geometries: list[Any] = []
        active_tiles: set[tuple[int, int, int]] = set()
        for feature in source_layer["features"]:
            geometry_data = feature.get("geometry")
            if not isinstance(geometry_data, dict):
                continue
            geometry = shape(geometry_data)
            if geometry.is_empty:
                continue
            properties = _presentation_properties(
                feature.get("properties"), source_layer["metadata"]
            )
            min_z = _feature_min_zoom(properties)
            features_data.append((geometry, properties, min_z))
            geometries.append(geometry)
            if geometry.geom_type == "Point":
                for z in range(max(MIN_ZOOM, min_z), MAX_ZOOM + 1):
                    active_tiles.add((z, *_lon_lat_to_tile(geometry.x, geometry.y, z)))
            else:
                for tile_coord in _tiles_for_bounds(geometry.bounds, min_zoom=min_z):
                    active_tiles.add(tile_coord)

        if not geometries:
            continue

        tree = STRtree(geometries)

        for z, x, y in active_tiles:
            min_x, min_y, max_x, max_y = _tile_bounds(z, x, y)
            candidate_indices = tree.query(box(min_x, min_y, max_x, max_y), predicate="intersects")
            for idx in candidate_indices:
                geometry, properties, min_z = features_data[idx]
                if z < min_z:
                    continue
                if geometry.geom_type == "Point":
                    simplified = geometry
                else:
                    gb = geometry.bounds
                    if gb[0] >= min_x and gb[1] >= min_y and gb[2] <= max_x and gb[3] <= max_y:
                        clipped = geometry
                    else:
                        clipped = clip_by_rect(geometry, min_x, min_y, max_x, max_y)
                    if clipped.is_empty:
                        continue
                    simplified = _simplify_for_zoom(clipped, z)
                    if simplified.is_empty or simplified.geom_type == "GeometryCollection":
                        continue
                tile_features[(z, x, y)][source_layer["source_layer"]].append(
                    {
                        "geometry": mapping(simplified),
                        "properties": properties,
                    }
                )

    bounds = _combined_bounds(source_layers)
    metadata = {
        "name": "Map Data Provider presentation",
        "description": "Derived public analytical vectors for offline map inspection.",
        "format": "pbf",
        "type": "overlay",
        "version": "1",
        "bounds": ",".join(str(value) for value in bounds),
        "center": ",".join(
            str(value)
            for value in [
                round((bounds[0] + bounds[2]) / 2, 6),
                round((bounds[1] + bounds[3]) / 2, 6),
                MIN_ZOOM,
            ]
        ),
        "minzoom": str(MIN_ZOOM),
        "maxzoom": str(MAX_ZOOM),
        "vector_layers": [
            {
                "id": layer["source_layer"],
                "fields": {name: "String" for name in PRESENTATION_PROPERTY_NAMES},
            }
            for layer in source_layers
        ],
    }
    header = {
        "root_offset": 0,
        "root_length": 0,
        "metadata_offset": 0,
        "metadata_length": 0,
        "tile_data_offset": 0,
        "tile_data_length": 0,
        "clustered": True,
        "internal_compression": Compression.GZIP,
        "tile_compression": Compression.NONE,
        "tile_type": TileType.MVT,
        "min_zoom": MIN_ZOOM,
        "max_zoom": MAX_ZOOM,
        "min_lon_e7": round(bounds[0] * 10_000_000),
        "min_lat_e7": round(bounds[1] * 10_000_000),
        "max_lon_e7": round(bounds[2] * 10_000_000),
        "max_lat_e7": round(bounds[3] * 10_000_000),
        "center_zoom": MIN_ZOOM,
        "center_lon_e7": round((bounds[0] + bounds[2]) * 5_000_000),
        "center_lat_e7": round((bounds[1] + bounds[3]) * 5_000_000),
    }
    with archive_path.open("wb") as output:
        writer = Writer(output)
        # PMTiles directory locality is based on tile IDs (Hilbert ordering), not
        # lexical z/x/y order.  Preserve it so range reads stay clustered while
        # the map moves across adjacent tiles.
        for z, x, y in sorted(tile_features, key=lambda coordinate: zxy_to_tileid(*coordinate)):
            layers = [
                {"name": layer_name, "features": features}
                for layer_name, features in sorted(tile_features[(z, x, y)].items())
            ]
            writer.write_tile(
                zxy_to_tileid(z, x, y),
                mapbox_vector_tile.encode(
                    layers,
                    default_options={
                        "quantize_bounds": _tile_bounds(z, x, y),
                        "extents": 4096,
                    },
                ),
            )
        if not tile_features:
            raise ValueError("Map presentation has no rendered tile features")
        writer.finalize(header, metadata)
    return {"addressed_tiles": len(tile_features)}


def _validate_presentation_files(presentation_root: Path, manifest: dict[str, Any]) -> None:
    manifest_path = presentation_root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError("Missing map presentation manifest")
    presentation = json.loads(manifest_path.read_text(encoding="utf-8"))
    if presentation.get("presentation_version") != MAP_PRESENTATION_VERSION:
        raise ValueError("Unsupported map presentation version")
    if presentation.get("aoi_id") != manifest.get("aoi_id") or presentation.get(
        "domain"
    ) != manifest.get("domain"):
        raise ValueError("Map presentation identity does not match the domain manifest")
    expected_parent_sha = _digest(_canonical_json(manifest))
    if presentation.get("parent_domain_pack", {}).get("sha256") != expected_parent_sha:
        raise ValueError("Map presentation is stale for the domain manifest")
    archive = presentation.get("archive")
    if (
        not isinstance(archive, dict)
        or archive.get("format") != "pmtiles"
        or not isinstance(archive.get("path"), str)
    ):
        raise ValueError("Map presentation requires a PMTiles archive")
    archive_path = _safe_file(presentation_root, archive["path"])
    archive_bytes = archive_path.read_bytes()
    if archive.get("sha256") != _digest(archive_bytes) or archive.get("size_bytes") != len(
        archive_bytes
    ):
        raise ValueError("Map presentation archive checksum does not match")
    public_by_id = {
        artifact["id"]: artifact
        for artifact in manifest["artifacts"]
        if _is_public_vector_artifact(artifact)
    }
    layers = presentation.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ValueError("Map presentation requires public vector layer descriptors")
    if {layer.get("artifact_id") for layer in layers} != set(public_by_id):
        raise ValueError("Map presentation layers do not match public domain artifacts")
    registry = load_source_registry()
    for layer in layers:
        artifact = public_by_id[layer["artifact_id"]]
        if layer.get("source_provenance") != artifact["source_provenance"]:
            raise ValueError("Map presentation provenance does not match the domain artifact")
        validate_ordered_provenance(layer["source_provenance"], registry, public_export=True)


def _presentation_layer_descriptor(source_layer: dict[str, Any]) -> dict[str, Any]:
    artifact = source_layer["artifact"]
    metadata = source_layer["metadata"]
    registry = load_source_registry()
    source_ids = [record["source_id"] for record in artifact["source_provenance"]]
    sources = [source for source in registry["sources"] if source["id"] in source_ids]
    return {
        "artifact_id": artifact["id"],
        "source_layer": source_layer["source_layer"],
        "feature_count": artifact["feature_count"],
        "source": metadata["source"],
        "confidence": metadata["confidence"],
        "readiness": metadata["readiness"],
        "limitations": metadata["limitations"],
        "attribution": "; ".join(source["attribution"] for source in sources),
        "attribution_html": "; ".join(_presentation_attribution(source) for source in sources),
        "source_provenance": artifact["source_provenance"],
    }


def _presentation_attribution(source: dict[str, Any]) -> str:
    """Return the display attribution required by the source's public artefact."""
    attribution = html.escape(source["attribution"])
    if source["id"] != "openstreetmap":
        return attribution
    return (
        f'{attribution} <a href="https://www.openstreetmap.org/copyright">'
        "copyright</a> · "
        f'<a href="{html.escape(source["license_url"])}">ODbL 1.0</a>'
    )


def _presentation_properties(raw_properties: Any, metadata: dict[str, Any]) -> dict[str, str]:
    properties = raw_properties if isinstance(raw_properties, dict) else {}
    selected: dict[str, str] = {}
    for name in PRESENTATION_PROPERTY_NAMES:
        value = properties.get(name)
        if name == "limitations":
            values = value if isinstance(value, list) else metadata.get("limitations", [])
            selected[name] = (
                "; ".join(str(item) for item in values) if isinstance(values, list) else str(values)
            )
        elif name == "missing_fields":
            selected[name] = (
                ", ".join(str(item) for item in value) if isinstance(value, list) else ""
            )
        elif value is not None:
            selected[name] = str(value)
    selected.setdefault("source", str(metadata["source"]))
    selected.setdefault("domain", str(metadata["domain"]))
    selected.setdefault("confidence", str(metadata["confidence"]))
    voltage_state, voltage_bucket = _voltage_style(properties.get("osm_tags"))
    selected["voltage_state"] = voltage_state
    selected["voltage_bucket"] = voltage_bucket
    tags = properties.get("osm_tags") if isinstance(properties.get("osm_tags"), dict) else {}
    selected["voltage_label"] = _voltage_label(tags.get("voltage"))
    for name in ("name", "ref", "operator"):
        if tags.get(name) is not None:
            selected[name] = str(tags[name])
    return selected


def _is_public_vector_artifact(artifact: dict[str, Any]) -> bool:
    return (
        artifact.get("public_export") is True
        and artifact.get("format") == "geojson"
        and artifact.get("kind") in {"processed_vector", "derived_vector", "representative_points"}
        and isinstance(artifact.get("path"), str)
        and isinstance(artifact.get("sha256"), str)
        and isinstance(artifact.get("feature_count"), int)
    )


def _source_layer_name(artifact_id: str) -> str:
    return artifact_id.replace(".", "_").replace("-", "_")


def _feature_min_zoom(properties: dict[str, str]) -> int:
    asset_type = properties.get("asset_type")
    if asset_type in {"tower", "portal", "utility_pole"}:
        return 12
    if asset_type == "pole":
        return 14
    return MIN_ZOOM


def _tiles_for_bounds(bounds: tuple[float, float, float, float], *, min_zoom: int = MIN_ZOOM):
    min_lon, min_lat, max_lon, max_lat = bounds
    for zoom in range(max(MIN_ZOOM, min_zoom), MAX_ZOOM + 1):
        min_x, max_y = _lon_lat_to_tile(min_lon, min_lat, zoom)
        max_x, min_y = _lon_lat_to_tile(max_lon, max_lat, zoom)
        for x in range(min_x, max_x + 1):
            for y in range(min_y, max_y + 1):
                yield zoom, x, y


def _lon_lat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    size = 1 << zoom
    limited_lat = max(min(lat, 85.05112878), -85.05112878)
    x = min(size - 1, max(0, int((lon + 180.0) / 360.0 * size)))
    y = min(
        size - 1,
        max(
            0,
            int((1 - math.asinh(math.tan(math.radians(limited_lat))) / math.pi) / 2 * size),
        ),
    )
    return x, y


def _tile_bounds(zoom: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 1 << zoom
    min_lon = x / size * 360.0 - 180.0
    max_lon = (x + 1) / size * 360.0 - 180.0
    max_lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / size))))
    min_lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / size))))
    return min_lon, min_lat, max_lon, max_lat


def _simplify_for_zoom(geometry: Any, zoom: int) -> Any:
    if zoom >= 12:
        return geometry
    degrees_per_tile = 360 / (1 << zoom)
    return geometry.simplify(degrees_per_tile / 2048, preserve_topology=True)


def _voltage_style(raw_tags: Any) -> tuple[str, str]:
    tags = raw_tags if isinstance(raw_tags, dict) else {}
    value = tags.get("voltage")
    if value is None or not str(value).strip():
        return "missing", "unknown"
    values = [item.strip() for item in str(value).split(";") if item.strip()]
    try:
        voltages = [int(item) for item in values]
    except ValueError:
        return "unparseable", "unknown"
    if any(voltage <= 0 for voltage in voltages):
        return "unparseable", "unknown"
    voltage = max(voltages)
    state = "multiple_voltage" if len(voltages) > 1 else ""
    if voltage < 1_000:
        return state or "low_voltage", "low"
    if voltage < 35_000:
        return state or "medium_voltage", "medium"
    if voltage < 150_000:
        return state or "high_voltage", "high_110"
    if voltage < 300_000:
        return state or "extra_high_voltage", "high_220"
    return state or "ultra_high_voltage", "high_400"


def _voltage_label(raw_value: Any) -> str:
    values = [item.strip() for item in str(raw_value or "").split(";") if item.strip()]
    try:
        volts = [int(value) for value in values]
    except ValueError:
        return str(raw_value or "voltage unknown")
    if not volts or any(value <= 0 for value in volts):
        return str(raw_value or "voltage unknown")
    labels = [f"{value // 1000:g}" if value % 1000 == 0 else f"{value / 1000:g}" for value in volts]
    return f"{'/'.join(labels)} kV"


def _combined_bounds(source_layers: list[dict[str, Any]]) -> list[float]:
    geometries = [
        shape(feature["geometry"])
        for layer in source_layers
        for feature in layer["features"]
        if isinstance(feature.get("geometry"), dict)
    ]
    if not geometries:
        raise ValueError("Map presentation has no geometries")
    min_x = min(geometry.bounds[0] for geometry in geometries)
    min_y = min(geometry.bounds[1] for geometry in geometries)
    max_x = max(geometry.bounds[2] for geometry in geometries)
    max_y = max(geometry.bounds[3] for geometry in geometries)
    return [round(min_x, 7), round(min_y, 7), round(max_x, 7), round(max_y, 7)]


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _safe_file(root: Path, relative_path: str) -> Path:
    candidate = (root / relative_path).resolve()
    if not relative_path or candidate == root.resolve() or root.resolve() not in candidate.parents:
        raise ValueError("Map presentation path escapes its root")
    return candidate


def _replace_directory(target: Path, staging: Path) -> None:
    backup = target.parent / f".{PRESENTATION_DIRNAME}-backup-{uuid.uuid4().hex}"
    try:
        if target.exists():
            target.replace(backup)
        staging.replace(target)
    except Exception:
        if backup.exists() and not target.exists():
            backup.replace(target)
        raise
    finally:
        shutil.rmtree(backup, ignore_errors=True)
