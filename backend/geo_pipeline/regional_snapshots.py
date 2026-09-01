"""Operator-only definition for the MDQ-057 default regional publication."""

from __future__ import annotations

from typing import Any

from geo_pipeline.aoi import ResolvedAoi, resolve_aoi

RYBNIK_CENTER = (18.546285, 50.102174)
RUNTIME_DOMAINS = (
    "power",
    "emergency",
    "public",
    "transport",
    "bridges",
    "water",
    "gas",
    "sewer",
    "industrial",
    "telecom",
    "district_heating",
)


def regional_snapshot_aoi(snapshot_id: str) -> dict[str, Any]:
    """Return a resolved AOI whose stable identity is the published snapshot ID.

    This intentionally does not alter the public runtime request guard. The
    default regional geometry is an operator-prepared baseline, not a browser
    template or a route around bounded acquisition policy.
    """
    if snapshot_id == "rybnik_35km":
        resolved = resolve_aoi(
            {
                "type": "circle",
                "longitude": RYBNIK_CENTER[0],
                "latitude": RYBNIK_CENTER[1],
                "radius_m": 35_000,
            }
        )
        return _named(resolved, snapshot_id).as_dict()
    raise ValueError(f"Unsupported regional snapshot '{snapshot_id}'")


def _named(resolved: ResolvedAoi, snapshot_id: str) -> ResolvedAoi:
    return ResolvedAoi(
        **{
            **resolved.__dict__,
            "aoi_id": snapshot_id,
            "cache_key": snapshot_id,
            "aliases": (snapshot_id,),
        }
    )
