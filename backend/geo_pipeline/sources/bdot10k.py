"""Bounded official BDOT10k GPKG and GeoParquet adapter.

The package-index WMS may help a user discover an artifact, but it is not used
as a feature API here. This module only imports a selected, already acquired
class artifact and keeps its source evidence attached to the normalized result.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import mapping, shape

from geo_pipeline.source_registry import guard_source_access

BDOT10K_ADAPTER_VERSION = "bdot10k_adapter/v1"
BDOT10K_SOURCE_CRS = "EPSG:2180"
BDOT10K_INTERCHANGE_CRS = "EPSG:4326"
BDOT10K_DOWNLOAD_ROOT = "https://opendata.geoportal.gov.pl/bdot10k/schemat2021/"
BDOT10K_PACKAGE_DISCOVERY_WMS = (
    "https://mapy.geoportal.gov.pl/wss/service/PZGIK/BDOT/WMS/PobieranieBDOT10k"
)

# Each entry is a verified 2021-schema class download. The point industrial
# representation exercises every geometry family without a generic upload route.
BDOT10K_CLASS_MAPPING: dict[str, dict[str, str]] = {
    "OT_SKDR_L": {
        "source_role": "transport",
        "geometry_family": "line",
        "label": "road",
    },
    "OT_BUIN_L": {
        "source_role": "bridge_context",
        "geometry_family": "line",
        "label": "engineering_structure",
    },
    "OT_SWRS_L": {
        "source_role": "water_context",
        "geometry_family": "line",
        "label": "river_or_stream",
    },
    "OT_BUBD_A": {
        "source_role": "building_context",
        "geometry_family": "polygon",
        "label": "building",
    },
    "OT_KUPG_A": {
        "source_role": "industrial_context",
        "geometry_family": "polygon",
        "label": "industrial_economic_complex",
    },
    "OT_KUPG_P": {
        "source_role": "industrial_context",
        "geometry_family": "point",
        "label": "industrial_economic_complex",
    },
    "OT_PTKM_A": {
        "source_role": "military_context",
        "geometry_family": "polygon",
        "label": "military_complex",
    },
}
BDOT10K_REQUIRED_FIELDS = frozenset({"idIIP"})
BDOT10K_SELECTED_FIELDS = ("idIIP", "x_kod", "nazwa", "geometry")


class Bdot10kAdapterError(ValueError):
    """Raised for unsupported BDOT10k artifacts or incompatible class schema."""


def class_definition(source_class: str) -> dict[str, str]:
    """Return one narrow, versioned BDOT10k class mapping."""
    try:
        return BDOT10K_CLASS_MAPPING[source_class]
    except KeyError as error:
        raise Bdot10kAdapterError(f"Unsupported BDOT10k source class: {source_class}") from error


def package_discovery_descriptor() -> dict[str, str]:
    """Describe the fixed package-discovery fallback without exposing a WMS proxy."""
    return {
        "source_registry_id": "bdot10k",
        "service_url": BDOT10K_PACKAGE_DISCOVERY_WMS,
        "method": "GetFeatureInfo",
        "purpose": "package_discovery_only",
        "limitation": "The WMS response is not a vector feature acquisition API.",
    }


def load_fixture_manifest(path: Path) -> dict[str, Any]:
    """Load and validate a compact, dated artifact-manifest fixture."""
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise Bdot10kAdapterError("BDOT10k fixture manifest is unreadable") from error
    if manifest.get("adapter_version") != BDOT10K_ADAPTER_VERSION:
        raise Bdot10kAdapterError("BDOT10k fixture manifest has an incompatible adapter version")
    if not isinstance(manifest.get("snapshot_at"), str):
        raise Bdot10kAdapterError("BDOT10k fixture manifest is missing snapshot_at")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise Bdot10kAdapterError("BDOT10k fixture manifest is missing artifacts")
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) != {
            "file",
            "format",
            "sha256",
            "source_classes",
        }:
            raise Bdot10kAdapterError("BDOT10k fixture manifest artifact shape is invalid")
        if artifact["format"] not in {"gpkg", "geoparquet"} or not isinstance(
            artifact["source_classes"], list
        ):
            raise Bdot10kAdapterError("BDOT10k fixture manifest artifact format is invalid")
        for source_class in artifact["source_classes"]:
            class_definition(source_class)
    return manifest


def read_fixture_class(
    *,
    manifest_path: Path,
    source_class: str,
    artifact_format: str,
    aoi_geometry: dict[str, Any],
) -> dict[str, Any]:
    """Read one fixture artifact after checksum and mapping validation."""
    manifest = load_fixture_manifest(manifest_path)
    artifact = _artifact_for(manifest, source_class, artifact_format)
    artifact_path = manifest_path.parent / artifact["file"]
    return read_bdot10k_class(
        source_class=source_class,
        artifact_path=artifact_path,
        aoi_geometry=aoi_geometry,
        snapshot_at=manifest["snapshot_at"],
        expected_sha256=artifact["sha256"],
    )


def read_bdot10k_class(
    *,
    source_class: str,
    artifact_path: Path,
    aoi_geometry: dict[str, Any],
    snapshot_at: str,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    """Normalize a bounded GPKG/GeoParquet class artifact to provider GeoJSON.

    A GPKG reader receives its selected layer, selected columns and source-CRS
    AOI bound. GeoParquet gets selected columns and a source-CRS bounding box, which
    GeoPandas/pyarrow can push to a spatially indexed file. Both are clipped
    again after normalization, so a reader without spatial pushdown stays safe.
    """
    definition = class_definition(source_class)
    if not isinstance(snapshot_at, str) or not snapshot_at:
        raise Bdot10kAdapterError("BDOT10k snapshot_at must be a non-empty string")
    aoi = shape(aoi_geometry)
    if aoi.is_empty:
        raise Bdot10kAdapterError("BDOT10k AOI must not be empty")

    return guard_source_access(
        "bdot10k",
        "local_import",
        lambda: guard_source_access(
            "bdot10k",
            "analytical_processing",
            lambda: _read_and_normalize(
                source_class=source_class,
                definition=definition,
                artifact_path=artifact_path,
                aoi=aoi,
                snapshot_at=snapshot_at,
                expected_sha256=expected_sha256,
            ),
        ),
    )


def _read_and_normalize(
    *,
    source_class: str,
    definition: dict[str, str],
    artifact_path: Path,
    aoi: Any,
    snapshot_at: str,
    expected_sha256: str | None,
) -> dict[str, Any]:
    if not artifact_path.is_file():
        raise Bdot10kAdapterError(f"BDOT10k artifact does not exist: {artifact_path.name}")
    raw_sha256 = _digest_path(artifact_path)
    if expected_sha256 is not None and raw_sha256 != expected_sha256:
        raise Bdot10kAdapterError("BDOT10k artifact checksum does not match manifest")

    suffix = artifact_path.suffix.lower()
    if suffix == ".gpkg":
        frame = gpd.read_file(
            artifact_path,
            layer=source_class,
            columns=list(BDOT10K_SELECTED_FIELDS[:-1]),
            bbox=_aoi_bounds_in_source_crs(aoi),
            engine="pyogrio",
        )
        artifact_format = "gpkg"
    elif suffix == ".parquet":
        frame = gpd.read_parquet(
            artifact_path,
            columns=list(BDOT10K_SELECTED_FIELDS),
            bbox=_aoi_bounds_in_source_crs(aoi),
        )
        artifact_format = "geoparquet"
    else:
        raise Bdot10kAdapterError("BDOT10k artifact must be a .gpkg or .parquet file")

    _validate_frame(frame, source_class, definition)
    normalized = frame.to_crs(BDOT10K_INTERCHANGE_CRS)
    features: list[dict[str, Any]] = []
    for _, row in normalized.iterrows():
        geometry = row.geometry.intersection(aoi)
        if geometry.is_empty:
            continue
        _validate_geometry_family(geometry.geom_type, definition["geometry_family"], source_class)
        source_attributes = {
            key: _json_scalar(row[key])
            for key in BDOT10K_SELECTED_FIELDS[:-1]
            if key in row and row[key] is not None
        }
        features.append(
            {
                "type": "Feature",
                "id": str(row["idIIP"]),
                "properties": {
                    "source_registry_id": "bdot10k",
                    "source_feature_type": source_class,
                    "source_feature_id": str(row["idIIP"]),
                    "source_crs": BDOT10K_SOURCE_CRS,
                    "snapshot_at": snapshot_at,
                    "source_role": definition["source_role"],
                    "source_class_label": definition["label"],
                    "source_attributes": source_attributes,
                    "attribution": "Główny Urząd Geodezji i Kartografii (GUGiK), BDOT10k",
                    "terms": "Free reuse of published BDOT10k data; preserve GUGiK attribution, artifact evidence and snapshot provenance.",
                    "limitations": [
                        "BDOT10k topographic geometry is not a facility-semantics, ownership, availability or operational-status guarantee."
                    ],
                },
                "geometry": json.loads(json.dumps(mapping(geometry))),
            }
        )
    extension = "parquet" if artifact_format == "geoparquet" else "gpkg"
    directory = "GeoParquet" if artifact_format == "geoparquet" else "GPKG"
    return {
        "type": "FeatureCollection",
        "metadata": {
            "adapter_version": BDOT10K_ADAPTER_VERSION,
            "source_registry_id": "bdot10k",
            "source_class": source_class,
            "source_role": definition["source_role"],
            "source_crs": BDOT10K_SOURCE_CRS,
            "interchange_crs": BDOT10K_INTERCHANGE_CRS,
            "artifact_format": artifact_format,
            "artifact_filename": artifact_path.name,
            "raw_sha256": raw_sha256,
            "snapshot_at": snapshot_at,
            "source_url": f"{BDOT10K_DOWNLOAD_ROOT}{directory}/{source_class}.{extension}",
        },
        "features": features,
    }


def _artifact_for(
    manifest: dict[str, Any], source_class: str, artifact_format: str
) -> dict[str, Any]:
    for artifact in manifest["artifacts"]:
        if artifact["format"] == artifact_format and source_class in artifact["source_classes"]:
            return artifact
    raise Bdot10kAdapterError(f"No {artifact_format} fixture artifact for {source_class}")


def _validate_frame(frame: gpd.GeoDataFrame, source_class: str, definition: dict[str, str]) -> None:
    missing = BDOT10K_REQUIRED_FIELDS - set(frame.columns)
    if missing:
        raise Bdot10kAdapterError(
            f"BDOT10k schema drift for {source_class}: missing {', '.join(sorted(missing))}"
        )
    if frame.crs is None or frame.crs.to_string().upper() != BDOT10K_SOURCE_CRS:
        found = "missing" if frame.crs is None else frame.crs.to_string()
        raise Bdot10kAdapterError(
            f"BDOT10k schema drift for {source_class}: expected {BDOT10K_SOURCE_CRS}, got {found}"
        )
    for geometry in frame.geometry:
        if geometry is not None and not geometry.is_empty:
            _validate_geometry_family(
                geometry.geom_type, definition["geometry_family"], source_class
            )


def _validate_geometry_family(geometry_type: str, expected: str, source_class: str) -> None:
    family = (
        "point"
        if geometry_type == "Point"
        else "line"
        if geometry_type in {"LineString", "MultiLineString"}
        else "polygon"
        if geometry_type in {"Polygon", "MultiPolygon"}
        else "other"
    )
    if family != expected:
        raise Bdot10kAdapterError(
            f"BDOT10k schema drift for {source_class}: expected {expected} geometry, got {geometry_type}"
        )


def _aoi_bounds_in_source_crs(aoi: Any) -> tuple[float, float, float, float]:
    aoi_frame = gpd.GeoDataFrame(geometry=[aoi], crs=BDOT10K_INTERCHANGE_CRS).to_crs(
        BDOT10K_SOURCE_CRS
    )
    return tuple(aoi_frame.total_bounds)


def _digest_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _json_scalar(value: Any) -> Any:
    return value.item() if hasattr(value, "item") else value
