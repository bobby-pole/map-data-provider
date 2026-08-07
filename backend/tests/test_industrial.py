import pytest

from geo_pipeline.industrial import (
    category_for_osm_feature,
    build_osm_industrial_layers,
    build_osm_industrial_cache_layer,
)

def test_category_for_osm_feature():
    assert category_for_osm_feature({"landuse": "industrial"}) == "land_use"
    assert category_for_osm_feature({"man_made": "works"}) == "works"
    assert category_for_osm_feature({"industrial": "factory"}) == "facilities"
    assert category_for_osm_feature({"industrial": "works"}) == "facilities"
    assert category_for_osm_feature({"building": "industrial"}) == "building_context"
    assert category_for_osm_feature({"landuse": "military"}) == "military_context"
    assert category_for_osm_feature({"military": "danger_area"}) == "military_context"
    
    assert category_for_osm_feature({"landuse": "military", "industrial": "factory"}) == "military_context"
    assert category_for_osm_feature({"landuse": "industrial", "man_made": "works"}) == "land_use"
    
    assert category_for_osm_feature({"amenity": "school"}) is None
    assert category_for_osm_feature({}) is None

def test_build_osm_industrial_layers():
    layers = build_osm_industrial_layers(readiness="usable_with_limitations")
    assert "land_use" in layers
    assert "facilities" in layers
    assert "works" in layers
    assert "building_context" in layers
    assert "military_context" in layers
    
    assert layers["land_use"]["metadata"]["layer_id"] == "industrial.land_use"
    assert layers["facilities"]["metadata"]["layer_id"] == "industrial.facilities"
    
    for category in ("land_use", "facilities", "works", "building_context", "military_context"):
        assert layers[category]["metadata"]["feature_count"] == len(layers[category]["features"])

def test_build_osm_industrial_cache_layer():
    cache = build_osm_industrial_cache_layer(readiness="usable_with_limitations")
    assert cache["metadata"]["layer_id"] == "industrial.osm_facilities"
    assert cache["metadata"]["feature_count"] == len(cache["features"])
