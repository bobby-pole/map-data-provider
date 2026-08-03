import json
from pathlib import Path


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "rybnik_60km" / "power"


def test_power_support_snapshot_is_full_bounded_and_classified() -> None:
    snapshot = json.loads((FIXTURE_ROOT / "osm-power-supports-full.geojson").read_text(encoding="utf-8"))

    assert snapshot["type"] == "FeatureCollection"
    assert snapshot["metadata"]["snapshot_at"] == "2026-08-03T08:45:36Z"
    assert snapshot["metadata"]["coverage"] == "bounded_aoi_snapshot"
    assert snapshot["metadata"]["source_checksum"]
    assert len(snapshot["features"]) == 133_129
    classes = {feature["properties"].get("power") or feature["properties"].get("man_made") for feature in snapshot["features"]}
    assert classes == {"tower", "pole", "portal", "utility_pole"}


def test_circuit_snapshot_has_deterministic_member_and_node_reverse_indexes() -> None:
    evidence = json.loads((FIXTURE_ROOT / "osm-power-circuit-evidence.json").read_text(encoding="utf-8"))

    assert evidence["relation_evidence_version"] == "osm_power_relation_evidence/v2"
    assert evidence["snapshot_at"] == "2026-08-03T08:45:36Z"
    assert len(evidence["relations"]) == 493
    assert "relation/19511895" in evidence["reverse_member_index"]["way/185080408"]
    # This support node is an actual member-way node, not a proximity match.
    assert "relation/19511896" in evidence["reverse_member_index"]["node/1528794574"]


def test_power_attribute_snapshot_preserves_verified_plant_reference_links() -> None:
    attributes = json.loads((FIXTURE_ROOT / "osm-power-attributes.json").read_text(encoding="utf-8"))

    plant = attributes["attributes"]["relation/12825526"]
    assert attributes["attribute_evidence_version"] == "osm_power_attributes/v1"
    assert attributes["snapshot_at"] == "2026-08-03T09:15:02Z"
    assert plant["wikipedia"] == "pl:Elektrownia Rybnik"
    assert plant["website"] == "https://elrybnik.pgegiek.pl/o-oddziale"
    assert plant["plant:output:electricity"] == "900 MW"
