import hashlib
import json
from pathlib import Path

import pytest

from geo_pipeline import runtime_osm
from geo_pipeline.aoi_runtime import resolve_runtime_request
from geo_pipeline.prepared_snapshot import publish_runtime_snapshot
from geo_pipeline.regional_snapshots import RUNTIME_DOMAINS, regional_snapshot_aoi
from geo_pipeline.runtime_osm import (
    backfill_power_circuit_evidence_for_member,
    publish_runtime_osm_collection,
)


def test_runtime_publication_writes_evidence_before_checksum_valid_manifest(tmp_path: Path) -> None:
    pack_path = tmp_path / "prepared_aoi" / "power" / "domain-pack-v2"
    pack_path.mkdir(parents=True)
    manifest_bytes = b'{"domain_pack_version":"provider_domain_pack/v2"}'
    (pack_path / "manifest.json").write_bytes(manifest_bytes)
    resolved = {
        "aoi": {
            "aoi_id": "prepared_aoi",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[18.4, 50.0], [18.6, 50.0], [18.6, 50.2], [18.4, 50.0]]],
            },
            "input_type": "administrative_selection",
            "boundary_provenance": {"unit_ids": ["gmina_2473011"]},
            "constraints": {"radius_m": 50_000},
        },
        "pipeline_version": "geo_pipeline/runtime/v18",
    }
    outcomes = [
        {
            "domain": "power",
            "status": "ready",
            "artifact_aoi_id": "prepared_aoi",
            "detail": "Validated bounded OSM artifact.",
            "queried_feature_count": 4,
            "accepted_feature_count": 3,
            "derived_feature_count": 1,
            "preparation_duration_ms": 25,
            "overpass_endpoint": "https://overpass-api.de/api/interpreter",
        },
        {
            "domain": "transport",
            "status": "failed",
            "artifact_aoi_id": None,
            "detail": "Upstream timeout.",
            "queried_feature_count": None,
            "accepted_feature_count": None,
            "derived_feature_count": None,
            "preparation_duration_ms": None,
            "overpass_endpoint": None,
        },
    ]

    publish_runtime_snapshot(
        cache_root=tmp_path,
        resolved=resolved,
        outcomes=outcomes,
        pipeline_version=resolved["pipeline_version"],
    )

    evidence = json.loads((tmp_path / "prepared_aoi" / "acquisition_evidence.json").read_text())
    snapshot = json.loads((tmp_path / "prepared_aoi" / "snapshot_manifest.json").read_text())
    assert evidence["aoi_id"] == snapshot["aoi_id"] == "prepared_aoi"
    assert evidence["radius_m"] == 50_000
    assert evidence["domains"][0]["rejected_feature_count"] == 1
    assert evidence["overpass_endpoint"] == "https://overpass-api.de/api/interpreter"
    assert evidence["domains"][0]["overpass_endpoint"] == "https://overpass-api.de/api/interpreter"
    assert snapshot["state"] == "partial"
    assert (
        snapshot["domain_outcomes"][0]["manifest_sha256"]
        == hashlib.sha256(manifest_bytes).hexdigest()
    )
    unsigned = {key: value for key, value in snapshot.items() if key != "checksum"}
    assert (
        snapshot["checksum"]
        == hashlib.sha256(
            json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    )


def test_operator_default_snapshot_is_35km_and_covers_all_runtime_domains() -> None:
    snapshot = regional_snapshot_aoi("rybnik_35km")

    assert snapshot["aoi_id"] == "rybnik_35km"
    assert snapshot["constraints"]["radius_m"] == 35_000
    assert len(RUNTIME_DOMAINS) == 11
    assert "district_heating" in RUNTIME_DOMAINS


def test_power_circuit_backfill_keeps_published_snapshot_manifest_checksum_in_sync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resolved = resolve_runtime_request(
        {
            "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]},
            "profiles": ["power"],
        }
    )
    aoi = resolved["aoi"]
    aoi_id = aoi["aoi_id"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "ss_power_category": "line",
                    "power": "line",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.45, 50.05], [18.55, 50.15]],
                },
            }
        ],
    }
    outcome = publish_runtime_osm_collection(
        aoi=aoi,
        domain="power",
        source=source,
        query_version="power-osm/v1",
        root=tmp_path,
        relation_evidence={
            "relation_evidence_version": "osm_power_relation_evidence/v2",
            "source": "OpenStreetMap",
            "snapshot_at": "2026-08-31T10:00:00Z",
            "bbox": [18.4, 50.0, 18.6, 50.2],
            "source_checksum": None,
            "relations": [],
            "reverse_member_index": {},
            "availability": "unavailable",
            "limitations": ["Overpass relation acquisition timed out."],
        },
        build_pmtiles=False,
    )
    publish_runtime_snapshot(
        cache_root=tmp_path,
        resolved=resolved,
        outcomes=[{**outcome, "domain": "power"}],
        pipeline_version=resolved["pipeline_version"],
    )

    pack_manifest_path = tmp_path / aoi_id / "power" / "domain-pack-v2" / "manifest.json"
    snapshot_manifest_path = tmp_path / aoi_id / "snapshot_manifest.json"
    original_pack_sha256 = hashlib.sha256(pack_manifest_path.read_bytes()).hexdigest()

    monkeypatch.setattr(
        runtime_osm,
        "fetch_power_circuit_relations_for_member",
        lambda source_id: [
            {
                "type": "relation",
                "id": 77,
                "tags": {"power": "circuit", "name": "Recovered circuit"},
                "members": [{"type": "way", "ref": 1, "role": "section"}],
            }
        ],
    )

    evidence = backfill_power_circuit_evidence_for_member(
        aoi=aoi,
        source_id="way/1",
        root=tmp_path,
    )

    assert evidence["reverse_member_index"] == {"way/1": ["relation/77"]}
    updated_pack_sha256 = hashlib.sha256(pack_manifest_path.read_bytes()).hexdigest()
    assert updated_pack_sha256 != original_pack_sha256

    snapshot = json.loads(snapshot_manifest_path.read_text(encoding="utf-8"))
    power_outcome = next(item for item in snapshot["domain_outcomes"] if item["domain"] == "power")
    assert power_outcome["manifest_sha256"] == updated_pack_sha256

    unsigned = {key: value for key, value in snapshot.items() if key != "checksum"}
    expected_checksum = hashlib.sha256(
        json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()
    assert snapshot["checksum"] == expected_checksum
    assert not list(tmp_path.glob(".backfill-stage-*"))
    assert not list((tmp_path / aoi_id / "power").glob(".*backup*"))


def test_power_circuit_backfill_does_not_overwrite_pack_when_snapshot_manifest_is_corrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resolved = resolve_runtime_request(
        {
            "aoi": {"type": "administrative_selection", "unit_ids": ["county_rybnik_city"]},
            "profiles": ["power"],
        }
    )
    aoi = resolved["aoi"]
    aoi_id = aoi["aoi_id"]
    source = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "element": "way",
                    "id": 1,
                    "ss_power_category": "line",
                    "power": "line",
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[18.45, 50.05], [18.55, 50.15]],
                },
            }
        ],
    }
    outcome = publish_runtime_osm_collection(
        aoi=aoi,
        domain="power",
        source=source,
        query_version="power-osm/v1",
        root=tmp_path,
        build_pmtiles=False,
    )
    publish_runtime_snapshot(
        cache_root=tmp_path,
        resolved=resolved,
        outcomes=[{**outcome, "domain": "power"}],
        pipeline_version=resolved["pipeline_version"],
    )

    pack_manifest_path = tmp_path / aoi_id / "power" / "domain-pack-v2" / "manifest.json"
    snapshot_manifest_path = tmp_path / aoi_id / "snapshot_manifest.json"
    original_pack_bytes = pack_manifest_path.read_bytes()
    snapshot_payload = json.loads(snapshot_manifest_path.read_text(encoding="utf-8"))
    snapshot_payload["checksum"] = "0" * 64
    snapshot_manifest_path.write_text(json.dumps(snapshot_payload), encoding="utf-8")

    monkeypatch.setattr(
        runtime_osm,
        "fetch_power_circuit_relations_for_member",
        lambda source_id: [],
    )

    with pytest.raises(ValueError, match="checksum"):
        backfill_power_circuit_evidence_for_member(aoi=aoi, source_id="way/1", root=tmp_path)

    assert pack_manifest_path.read_bytes() == original_pack_bytes
    assert not list(tmp_path.glob(".backfill-stage-*"))
