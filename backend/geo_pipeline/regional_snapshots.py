"""Operator-only definitions for the two MDQ-057 regional publications."""

from __future__ import annotations

from typing import Any

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from geo_pipeline.aoi import ResolvedAoi, _resolved, resolve_aoi
from geo_pipeline.aoi_runtime import _read_catalog, _valid_polygonal_geometry

RYBNIK_CENTER = (18.546285, 50.102174)
DEMO_DOMAINS = ("power", "emergency", "public", "transport")


def regional_snapshot_aoi(snapshot_id: str) -> dict[str, Any]:
    """Return a resolved AOI whose stable identity is the published snapshot ID.

    This intentionally does not alter the public runtime request guard. These
    two geometries are explicit operator preparation targets, not browser
    templates or a route around the bounded acquisition policy.
    """
    if snapshot_id == "rybnik_50km":
        resolved = resolve_aoi(
            {
                "type": "circle",
                "longitude": RYBNIK_CENTER[0],
                "latitude": RYBNIK_CENTER[1],
                "radius_m": 50_000,
            }
        )
        return _named(resolved, snapshot_id).as_dict()
    if snapshot_id == "rybnik_prg_neighbours":
        return _rybnik_neighbouring_counties().as_dict()
    raise ValueError(f"Unsupported regional snapshot '{snapshot_id}'")


def _rybnik_neighbouring_counties() -> ResolvedAoi:
    payload = _read_catalog()
    by_id = {feature["properties"]["id"]: feature for feature in payload["features"]}
    rybnik = _valid_polygonal_geometry(shape(by_id["gmina_2473011"]["geometry"]))
    county_ids = sorted(
        unit_id
        for unit_id, feature in by_id.items()
        if feature["properties"].get("kind") == "county"
        and _valid_polygonal_geometry(shape(feature["geometry"])).intersects(rybnik)
    )
    merged = unary_union(
        [
            rybnik,
            *(
                _valid_polygonal_geometry(shape(by_id[unit_id]["geometry"]))
                for unit_id in county_ids
            ),
        ]
    )
    metadata = payload["metadata"]
    resolved = _resolved(
        mapping(merged),
        "administrative_selection",
        metadata["source_crs"],
        {
            "kind": "prg_operator_neighbour_counties",
            "source_registry_id": metadata["source_registry_id"],
            "catalog_version": metadata["catalog_version"],
            "snapshot_at": metadata["snapshot_at"],
            "source_url": metadata["source_url"],
            "unit_ids": ["gmina_2473011", *county_ids],
        },
        radius_m=None,
    )
    return _named(resolved, "rybnik_prg_neighbours")


def _named(resolved: ResolvedAoi, snapshot_id: str) -> ResolvedAoi:
    return ResolvedAoi(
        **{
            **resolved.__dict__,
            "aoi_id": snapshot_id,
            "cache_key": snapshot_id,
            "aliases": (snapshot_id,),
        }
    )
