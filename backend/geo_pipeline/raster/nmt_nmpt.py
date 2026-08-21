"""Deterministic NMT/NMPT ASCII Grid adapter with no implicit resampling."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import Point, box, shape
from shapely.ops import transform

from geo_pipeline.source_registry import guard_source_access

NMT_NMPT_ADAPTER_VERSION = "nmt_nmpt_raster_adapter/v1"
NMT_NMPT_SOURCE_CRS = "EPSG:2180"
NMT_NMPT_INTERCHANGE_CRS = "EPSG:4326"
DERIVED_PRODUCT_VERSION = "terrain_sample_points/v1"
DERIVED_ALGORITHM = "cell_centroid/v1"
_TO_SOURCE = Transformer.from_crs(NMT_NMPT_INTERCHANGE_CRS, NMT_NMPT_SOURCE_CRS, always_xy=True)
_TO_WGS84 = Transformer.from_crs(NMT_NMPT_SOURCE_CRS, NMT_NMPT_INTERCHANGE_CRS, always_xy=True)


class RasterAdapterError(ValueError):
    """Raised for corrupt, incompatible or unsafe raster processing inputs."""


@dataclass(frozen=True)
class AsciiGrid:
    ncols: int
    nrows: int
    xllcorner: float
    yllcorner: float
    cellsize: float
    nodata_value: float
    values: tuple[tuple[float, ...], ...]

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        return (
            self.xllcorner,
            self.yllcorner,
            self.xllcorner + self.ncols * self.cellsize,
            self.yllcorner + self.nrows * self.cellsize,
        )


def parse_ascii_grid(payload: bytes) -> AsciiGrid:
    """Read a strict ESRI ASCII Grid without accepting missing or extra cells."""
    try:
        lines = [line.strip() for line in payload.decode("utf-8").splitlines() if line.strip()]
    except UnicodeDecodeError as error:
        raise RasterAdapterError("ASCII Grid must be UTF-8 text") from error
    if len(lines) < 7:
        raise RasterAdapterError("ASCII Grid is empty or missing header/data")
    header: dict[str, str] = {}
    for line in lines[:6]:
        parts = line.split()
        if len(parts) != 2:
            raise RasterAdapterError("ASCII Grid header line is malformed")
        key = parts[0].lower()
        if key in header:
            raise RasterAdapterError("ASCII Grid header has duplicate field")
        header[key] = parts[1]
    required = {"ncols", "nrows", "xllcorner", "yllcorner", "cellsize", "nodata_value"}
    if set(header) != required:
        raise RasterAdapterError("ASCII Grid header fields are incomplete or unsupported")
    try:
        ncols, nrows = int(header["ncols"]), int(header["nrows"])
        xllcorner, yllcorner = float(header["xllcorner"]), float(header["yllcorner"])
        cellsize, nodata_value = (
            float(header["cellsize"]),
            float(header["nodata_value"]),
        )
    except ValueError as error:
        raise RasterAdapterError("ASCII Grid header values are invalid") from error
    if (
        ncols <= 0
        or nrows <= 0
        or not all(math.isfinite(value) for value in (xllcorner, yllcorner, cellsize, nodata_value))
        or cellsize <= 0
    ):
        raise RasterAdapterError("ASCII Grid dimensions, origin, cell size or nodata are invalid")
    if len(lines[6:]) != nrows:
        raise RasterAdapterError("ASCII Grid row count does not match header")
    values: list[tuple[float, ...]] = []
    for line in lines[6:]:
        try:
            row = tuple(float(value) for value in line.split())
        except ValueError as error:
            raise RasterAdapterError("ASCII Grid cell value is invalid") from error
        if len(row) != ncols or not all(math.isfinite(value) for value in row):
            raise RasterAdapterError("ASCII Grid row width or cell value is invalid")
        values.append(row)
    return AsciiGrid(ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value, tuple(values))


def process_fixture(
    *,
    raster_path: Path,
    aoi_geometry: dict[str, Any],
    snapshot_at: str,
    source_crs: str = NMT_NMPT_SOURCE_CRS,
) -> dict[str, Any]:
    """Read, clip and validate a local native raster under the source eligibility boundary."""
    if source_crs != NMT_NMPT_SOURCE_CRS:
        raise RasterAdapterError(f"NMT/NMPT source CRS must be {NMT_NMPT_SOURCE_CRS}")
    if not isinstance(snapshot_at, str) or not snapshot_at:
        raise RasterAdapterError("NMT/NMPT snapshot_at must be a non-empty string")
    return guard_source_access(
        "nmt_nmpt",
        "local_import",
        lambda: guard_source_access(
            "nmt_nmpt",
            "analytical_processing",
            lambda: _process(raster_path, aoi_geometry, snapshot_at),
        ),
    )


def _process(raster_path: Path, aoi_geometry: dict[str, Any], snapshot_at: str) -> dict[str, Any]:
    if not raster_path.is_file():
        raise RasterAdapterError("NMT/NMPT raster artifact does not exist")
    native_bytes = raster_path.read_bytes()
    grid = parse_ascii_grid(native_bytes)
    aoi_wgs84 = shape(aoi_geometry)
    if aoi_wgs84.is_empty:
        raise RasterAdapterError("NMT/NMPT AOI must not be empty")
    aoi_source = transform(_TO_SOURCE.transform, aoi_wgs84)
    source_extent = box(*grid.bounds)
    overlap = aoi_source.intersection(source_extent)
    if overlap.is_empty:
        raise RasterAdapterError("NMT/NMPT raster does not cover the selected AOI")
    processed_values: list[tuple[float, ...]] = []
    selected_cells = valid_cells = nodata_cells = 0
    for row_index, row in enumerate(grid.values):
        result_row: list[float] = []
        for column_index, value in enumerate(row):
            centre = _cell_centre(grid, row_index, column_index)
            if not aoi_source.covers(Point(*centre)):
                result_row.append(grid.nodata_value)
                continue
            selected_cells += 1
            if value == grid.nodata_value:
                nodata_cells += 1
                result_row.append(grid.nodata_value)
            else:
                valid_cells += 1
                result_row.append(value)
        processed_values.append(tuple(result_row))
    processed = AsciiGrid(
        grid.ncols,
        grid.nrows,
        grid.xllcorner,
        grid.yllcorner,
        grid.cellsize,
        grid.nodata_value,
        tuple(processed_values),
    )
    processed_bytes = serialize_ascii_grid(processed)
    aoi_coverage = overlap.area / aoi_source.area if aoi_source.area else 0.0
    nodata_coverage = nodata_cells / selected_cells if selected_cells else 1.0
    status = (
        "valid"
        if aoi_coverage >= 0.999999 and valid_cells
        else "partial"
        if valid_cells
        else "nodata"
    )
    return {
        "adapter_version": NMT_NMPT_ADAPTER_VERSION,
        "source_registry_id": "nmt_nmpt",
        "data_kind": "raster",
        "usage_role": "analytical",
        "analytical_geojson": False,
        "native_raster": {
            "format": "ascii_grid",
            "sha256": _digest(native_bytes),
            "source_crs": NMT_NMPT_SOURCE_CRS,
            "path": raster_path.name,
        },
        "processed_raster": {
            "format": "ascii_grid",
            "sha256": _digest(processed_bytes),
            "source_crs": NMT_NMPT_SOURCE_CRS,
            "bytes": processed_bytes,
        },
        "provenance": {
            "snapshot_at": snapshot_at,
            "attribution": "Główny Urząd Geodezji i Kartografii (GUGiK), NMT/NMPT",
            "transforms": [
                {
                    "operation": "aoi_geometry_to_source_crs",
                    "from_crs": NMT_NMPT_INTERCHANGE_CRS,
                    "to_crs": NMT_NMPT_SOURCE_CRS,
                    "resampling": "none",
                },
                {
                    "operation": "grid_clip",
                    "resampling": "none",
                    "cellsize": grid.cellsize,
                },
            ],
        },
        "validation": {
            "status": status,
            "crs": NMT_NMPT_SOURCE_CRS,
            "resolution": {"value": grid.cellsize, "unit": "metres"},
            "nodata_value": grid.nodata_value,
            "nodata_coverage": round(nodata_coverage, 6),
            "aoi_coverage": round(aoi_coverage, 6),
            "selected_cell_count": selected_cells,
            "valid_cell_count": valid_cells,
            "grid_bounds_source_crs": list(grid.bounds),
        },
        "limitations": [
            "Raster elevations are source context, not object vectors.",
            "No flood risk or operational condition is inferred from elevation alone.",
        ],
    }


def derive_product(processed: dict[str, Any], *, product: str) -> dict[str, Any]:
    """Produce only labelled cell-centre samples; arbitrary terrain claims are rejected."""
    if product != DERIVED_PRODUCT_VERSION:
        raise RasterAdapterError("Unsupported derived raster product")
    payload = processed.get("processed_raster", {}).get("bytes")
    if not isinstance(payload, bytes):
        raise RasterAdapterError("Processed raster bytes are missing")
    grid = parse_ascii_grid(payload)
    features = []
    for row_index, row in enumerate(grid.values):
        for column_index, elevation in enumerate(row):
            if elevation == grid.nodata_value:
                continue
            x, y = _cell_centre(grid, row_index, column_index)
            longitude, latitude = _TO_WGS84.transform(x, y)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "derived": True,
                        "derived_product": DERIVED_PRODUCT_VERSION,
                        "algorithm": DERIVED_ALGORITHM,
                        "native_raster_sha256": processed["native_raster"]["sha256"],
                        "processed_raster_sha256": processed["processed_raster"]["sha256"],
                        "source_crs": NMT_NMPT_SOURCE_CRS,
                        "elevation": elevation,
                        "unit": "metres",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(longitude, 7), round(latitude, 7)],
                    },
                }
            )
    return {
        "type": "FeatureCollection",
        "metadata": {
            "data_kind": "derived_vector",
            "derived": True,
            "derived_product": DERIVED_PRODUCT_VERSION,
            "algorithm": DERIVED_ALGORITHM,
            "native_raster_sha256": processed["native_raster"]["sha256"],
            "processed_raster_sha256": processed["processed_raster"]["sha256"],
            "limitations": [
                "Terrain sample points are derived context, not terrain risk or object evidence."
            ],
        },
        "features": features,
    }


def serialize_ascii_grid(grid: AsciiGrid) -> bytes:
    """Serialize the exact grid resolution and nodata value deterministically."""
    header = [
        f"ncols {grid.ncols}",
        f"nrows {grid.nrows}",
        f"xllcorner {grid.xllcorner:g}",
        f"yllcorner {grid.yllcorner:g}",
        f"cellsize {grid.cellsize:g}",
        f"NODATA_value {grid.nodata_value:g}",
    ]
    rows = [" ".join(f"{value:g}" for value in row) for row in grid.values]
    return ("\n".join(header + rows) + "\n").encode("utf-8")


def _cell_centre(grid: AsciiGrid, row_index: int, column_index: int) -> tuple[float, float]:
    return (
        grid.xllcorner + (column_index + 0.5) * grid.cellsize,
        grid.yllcorner + (grid.nrows - row_index - 0.5) * grid.cellsize,
    )


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
