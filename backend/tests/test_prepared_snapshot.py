import hashlib
import json
from pathlib import Path

from geo_pipeline.prepared_snapshot import publish_runtime_snapshot
from geo_pipeline.regional_snapshots import RUNTIME_DOMAINS, regional_snapshot_aoi


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
