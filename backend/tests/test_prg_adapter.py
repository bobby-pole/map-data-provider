from pathlib import Path
import json

import pytest

from geo_pipeline.sources.prg import (
    PRG_FEATURE_TYPES,
    PrgAdapterError,
    build_getfeature_url,
    capability_feature_types,
    clip_non_boundary_features,
    fetch_gml,
    inspect_fixture,
    normalize_gml,
)


FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "data" / "fixtures" / "prg"
SNAPSHOT_AT = "2026-08-02T10:37:05Z"


def _fixture(name: str) -> bytes:
    return (FIXTURE_ROOT / name).read_bytes()


def _manifest() -> dict:
    return json.loads(_fixture("fixture_manifest.json"))


def test_prg_allowlist_matches_verified_administrative_police_and_fire_classes() -> None:
    assert {"ms:A01_Granice_wojewodztw", "ms:A02_Granice_powiatow", "ms:A03_Granice_gmin"} <= set(PRG_FEATURE_TYPES)
    assert {"ms:K01_Komenda_wojewodzka_policji", "ms:K05_Komisariat_policji", "ms:K06_Komenda_wojewodzka_strazy_pozarnej", "ms:K07_Komenda_powiatowa_strazy_pozarnej"} <= set(PRG_FEATURE_TYPES)
    assert capability_feature_types(_fixture("capabilities.xml")) >= {"ms:A03_Granice_gmin", "ms:K02_Komenda_powiatowa_policji", "ms:K07_Komenda_powiatowa_strazy_pozarnej"}
    manifest = _manifest()
    assert manifest["source_registry_id"] == "prg_wfs"
    assert manifest["service"]["source_crs"] == "EPSG:2180"
    assert manifest["attribution"].startswith("Główny Urząd")


@pytest.mark.parametrize(
    ("feature_type", "source_id", "source_class"),
    [
        ("ms:A03_Granice_gmin", "prg-gmina-fixture", "gmina"),
        ("ms:A02_Granice_powiatow", "prg-powiat-fixture", "powiat"),
        ("ms:A01_Granice_wojewodztw", "prg-wojewodztwo-fixture", "wojewodztwo"),
        ("ms:K02_Komenda_powiatowa_policji", "prg-police-fixture", "police_command_county"),
        ("ms:K07_Komenda_powiatowa_strazy_pozarnej", "prg-fire-fixture", "fire_command_county"),
    ],
)
def test_prg_gml_normalization_preserves_class_id_crs_and_snapshot(feature_type: str, source_id: str, source_class: str) -> None:
    collection = normalize_gml(feature_type, _fixture("features.gml"), snapshot_at=SNAPSHOT_AT)

    assert len(collection["features"]) == 1
    feature = collection["features"][0]
    assert feature["properties"]["source_registry_id"] == "prg_wfs"
    assert feature["properties"]["source_feature_type"] == feature_type
    assert feature["properties"]["source_feature_id"] == source_id
    assert feature["properties"]["source_crs"] == "EPSG:2180"
    assert feature["properties"]["snapshot_at"] == SNAPSHOT_AT
    assert feature["properties"]["source_class"] == source_class
    assert feature["geometry"]["type"] in {"Polygon", "Point"}


def test_non_boundary_prg_geometry_is_clipped_to_aoi_while_boundary_is_preserved() -> None:
    boundary = normalize_gml("ms:A03_Granice_gmin", _fixture("features.gml"), snapshot_at=SNAPSHOT_AT)
    police = normalize_gml("ms:K02_Komenda_powiatowa_policji", _fixture("features.gml"), snapshot_at=SNAPSHOT_AT)
    combined = {"type": "FeatureCollection", "features": boundary["features"] + police["features"]}

    clipped = clip_non_boundary_features(combined, boundary["features"][0]["geometry"])

    assert len(clipped["features"]) == 2
    assert clipped["features"][0]["geometry"] == boundary["features"][0]["geometry"]
    assert clipped["features"][1]["geometry"] != police["features"][0]["geometry"]


def test_fixture_outcomes_make_empty_schema_drift_and_unavailable_distinct() -> None:
    available = inspect_fixture(feature_type="ms:A03_Granice_gmin", capabilities=_fixture("capabilities.xml"), schema=_fixture("schema.xml"), gml=_fixture("features.gml"), snapshot_at=SNAPSHOT_AT)
    empty = inspect_fixture(feature_type="ms:A03_Granice_gmin", capabilities=_fixture("capabilities.xml"), schema=_fixture("schema.xml"), gml=_fixture("empty.gml"), snapshot_at=SNAPSHOT_AT)
    drift = inspect_fixture(feature_type="ms:A03_Granice_gmin", capabilities=_fixture("capabilities.xml"), schema=_fixture("schema-drift.xml"), gml=_fixture("features.gml"), snapshot_at=SNAPSHOT_AT)
    unavailable = inspect_fixture(feature_type="ms:K05_Komisariat_policji", capabilities=_fixture("capabilities.xml"), schema=_fixture("schema.xml"), gml=None, snapshot_at=SNAPSHOT_AT)

    assert available.status == "available"
    assert available.evidence["raw_sha256"]
    assert available.evidence["attribution"].startswith("Główny Urząd")
    assert empty.status == "empty"
    assert drift.status == "schema_drift"
    assert drift.evidence["missing_fields"] == ["IIP_IDENTY", "JPT_ID", "JPT_NAZWA_"]
    assert unavailable.status == "service_unavailable"


def test_prg_request_is_allowlisted_and_guarded_before_callback() -> None:
    url = build_getfeature_url("ms:A03_Granice_gmin", bbox_2180=(500000, 250000, 505000, 255000))
    assert "TYPENAMES=ms%3AA03_Granice_gmin" in url
    assert "BBOX=500000%2C250000%2C505000%2C255000%2CEPSG%3A2180" in url
    assert fetch_gml("ms:A03_Granice_gmin", lambda requested_url: requested_url.encode(), bbox_2180=(500000, 250000, 505000, 255000)) == url.encode()
    with pytest.raises(PrgAdapterError, match="Unsupported PRG feature type"):
        build_getfeature_url("ms:unbounded_client_type")
