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


EMERGENCY_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    query_version="emergency-osm/v1",
    tags={
        "amenity": ["hospital", "fire_station", "police", "ambulance_station"],
        "healthcare": ["hospital"],
        "emergency": ["ambulance_station", "mountain_rescue", "lifeguard_base"],
    },
)


PUBLIC_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    query_version="public-osm/v1",
    tags={
        "amenity": ["townhall", "school", "college", "university", "kindergarten", "post_office", "community_centre", "social_facility", "library", "arts_centre"],
        "office": ["government"],
    },
)


TRANSPORT_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    # v3 invalidates v2 runtime artifacts whose PMTiles payload omitted the
    # normalized road_class field required for client-side class filtering.
    query_version="transport-osm/v3",
    tags={
        "highway": ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"],
        "railway": ["rail", "station", "halt"],
        "aeroway": ["aerodrome", "helipad"],
    },
)


BRIDGES_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    query_version="bridges-osm/v1",
    tags={
        "bridge": ["yes", "viaduct", "aqueduct", "boardwalk"],
        "man_made": ["bridge"],
        "railway": ["level_crossing", "crossing"],
        "highway": ["viaduct"],
    },
)
