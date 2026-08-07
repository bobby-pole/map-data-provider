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


WATER_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    # OSMnx expands entries as an OR query.  Do not acquire every generic
    # man_made=pipeline or pumping_station object: a water classification
    # requires an explicit water tag and can otherwise admit gas or sewer
    # infrastructure into this domain.
    query_version="water-osm/v2",
    tags={
        "waterway": ["river", "stream", "canal", "drain", "ditch"],
        "pipeline": ["water"],
        "man_made": ["water_works", "water_tower"],
        "amenity": ["water_point"],
        "pumping": ["water"],
        "substance": ["water"],
    },
)


GAS_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    # OSMnx expands entries in this catalog as an OR query.  Request the
    # explicit gas substance instead of every man_made=pipeline feature in a
    # 60 km AOI; category normalization composes the required tag pairs.
    query_version="gas-osm/v2",
    tags={
        "pipeline": ["gas", "valve"],
        "man_made": ["gasometer", "gas_station"],
        "substance": ["gas"],
    },
)


SEWER_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    # OSMnx expands tag groups with OR semantics.  Generic pumping stations,
    # manholes and drainage lines are not sewer evidence without explicit
    # wastewater tags, so acquire the semantic tags and compose pairs during
    # normalization instead of querying each broad man_made representation.
    query_version="sewer-osm/v2",
    tags={
        "pipeline": ["sewer"],
        "man_made": ["wastewater_plant", "septic_tank"],
        "pumping": ["sewer", "wastewater"],
        "substance": ["sewerage", "wastewater"],
        "utility": ["sewer"],
    },
)


INDUSTRIAL_OSM_QUERY = OsmQueryDefinition(
    source_registry_id="openstreetmap",
    query_version="industrial-osm/v2",
    tags={
        "landuse": ["industrial", "military"],
        "man_made": ["works"],
        "industrial": ["factory", "works"],
        "building": ["industrial"],
        "military": ["danger_area", "base"],
    },
)
