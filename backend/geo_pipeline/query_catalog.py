"""Versioned provider-owned source query definitions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OsmQueryDefinition:
    source_registry_id: str
    query_version: str
    tags: dict[str, list[str]]


POWER_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    query_version="power-osmnx/v1",
    tags={
        "power": [
            "line", "minor_line", "cable", "substation", "transformer", "plant",
            "generator", "tower", "pole", "portal", "switch", "terminal",
            "converter", "compensator", "busbar", "bay",
        ],
        "man_made": ["utility_pole"],
    },
)
