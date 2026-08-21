import pytest
from fastapi.testclient import TestClient

from app.main import app, derive_readiness, normalize_validation_status

client = TestClient(app)


def test_health_reports_ok() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_catalog_uses_committed_local_artifacts() -> None:
    response = client.get("/api/layers/catalog")

    assert response.status_code == 200
    catalog = response.json()
    assert catalog
    local_layers = [layer for layer in catalog if layer["source_type"] != "reference_overlay"]
    assert local_layers
    assert all(layer["feature_count"] > 0 for layer in local_layers)
    assert all(layer["artifact"].startswith("data/") for layer in local_layers)
    assert all(layer["validation_report"].startswith("data/") for layer in local_layers)


@pytest.mark.parametrize(
    ("raw_status", "normalized_status"),
    [
        ("pass", "passed"),
        ("ok", "passed"),
        ("success", "passed"),
        ("valid", "passed"),
        ("warning", "warning"),
        ("invalid", "failed"),
        (None, "unknown"),
    ],
)
def test_validation_statuses_are_normalized(
    raw_status: object | None, normalized_status: str
) -> None:
    assert normalize_validation_status(raw_status) == normalized_status


def test_catalog_exposes_source_aware_readiness() -> None:
    response = client.get("/api/layers/catalog")

    assert response.status_code == 200
    by_id = {layer["id"]: layer for layer in response.json()}

    assert by_id["power.lines"]["quality_status"] == "passed"
    assert by_id["power.lines"]["validation_status_raw"] == "pass"
    assert by_id["power.lines"]["readiness"] == "ready"
    assert by_id["manual.power.seeds"]["quality_status"] == "passed"
    assert by_id["manual.power.seeds"]["readiness"] == "usable_with_limitations"
    assert by_id["power.hexes.regional"]["quality_status"] == "unknown"
    assert by_id["power.hexes.regional"]["readiness"] == "needs_source"
    assert by_id["external.kiut_wms"]["readiness"] == "needs_source"


@pytest.mark.parametrize(
    ("quality_status", "feature_count", "source_type", "expected"),
    [
        ("failed", 1, "analytical_vector", "not_usable"),
        ("passed", 0, "analytical_vector", "not_usable"),
        ("warning", 1, "analytical_vector", "usable_with_limitations"),
        ("passed", 1, "manual_seed", "usable_with_limitations"),
        ("passed", 0, "reference_overlay", "needs_source"),
        ("unknown", 1, "analytical_vector", "needs_source"),
    ],
)
def test_readiness_is_derived_conservatively(
    quality_status: str, feature_count: int, source_type: str, expected: str
) -> None:
    assert (
        derive_readiness(
            quality_status=quality_status,
            feature_count=feature_count,
            source_type=source_type,
        )
        == expected
    )


def test_readiness_consumes_structured_issue_severity() -> None:
    assert (
        derive_readiness(
            quality_status="passed",
            feature_count=1,
            source_type="analytical_vector",
            issue_severity="medium",
        )
        == "usable_with_limitations"
    )
    assert (
        derive_readiness(
            quality_status="passed",
            feature_count=1,
            source_type="analytical_vector",
            issue_severity="high",
        )
        == "not_usable"
    )


def test_catalog_exposes_required_source_metadata_contract() -> None:
    response = client.get("/api/layers/catalog")

    assert response.status_code == 200
    catalog = {layer["id"]: layer for layer in response.json()}
    required_fields = {
        "source_type",
        "confidence",
        "limitations",
        "not_authoritative",
        "eligible_for_analysis",
    }

    assert all(required_fields <= set(layer) for layer in catalog.values())
    assert {
        key: catalog["power.lines"][key]
        for key in (
            "source_type",
            "confidence",
            "not_authoritative",
            "eligible_for_analysis",
        )
    } == {
        "source_type": "analytical_vector",
        "confidence": "medium",
        "not_authoritative": False,
        "eligible_for_analysis": True,
    }
    assert catalog["power.lines"]["limitations"]
    assert catalog["manual.power.seeds"]["source_type"] == "manual_seed"
    assert catalog["manual.power.seeds"]["confidence"] == "low"
    assert catalog["manual.power.seeds"]["not_authoritative"] is True

    reference = catalog["external.kiut_wms"]
    assert reference["source_type"] == "reference_overlay"
    assert reference["confidence"] == "not_applicable"
    assert reference["limitations"]
    assert reference["not_authoritative"] is True
    assert reference["artifact"] is None
    assert reference["validation_report"] is None


def test_issue_metrics_match_issue_response() -> None:
    issues_response = client.get("/api/data-quality/issues")
    metrics_response = client.get("/api/data-quality/metrics")

    assert issues_response.status_code == 200
    assert metrics_response.status_code == 200

    issues = issues_response.json()
    metrics = metrics_response.json()
    assert issues
    assert metrics["total_issues"] == len(issues)
    assert metrics["open_issues"] == sum(issue["status"] == "open" for issue in issues)
    assert metrics["layers"] == len(client.get("/api/layers/catalog").json())
    assert metrics["layers_by_quality_status"] == {"passed": 3, "unknown": 2}
    assert metrics["layers_by_readiness"] == {
        "ready": 2,
        "usable_with_limitations": 1,
        "needs_source": 2,
    }


def test_passing_reports_do_not_create_false_positive_issues() -> None:
    issues = client.get("/api/data-quality/issues").json()
    quality_issue_layers = {
        issue["layer_id"] for issue in issues if issue["category"] == "quality_status"
    }

    assert "power.lines" not in quality_issue_layers
    assert "power.nodes.display" not in quality_issue_layers
    assert "manual.power.seeds" not in quality_issue_layers
    assert "power.hexes.regional" in quality_issue_layers
    assert "external.kiut_wms" not in quality_issue_layers
    assert not any(
        issue["layer_id"] == "external.kiut_wms" and issue["category"] == "empty_layer"
        for issue in issues
    )
    assert any(issue["id"] == "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE" for issue in issues)
    assert any(issue["id"] == "DQ-KIUT-WMS-REFERENCE-ONLY" for issue in issues)


def test_issues_expose_versioned_source_aware_rule_contract() -> None:
    issues = client.get("/api/data-quality/issues").json()
    required_fields = {
        "rule_id",
        "rule_version",
        "severity",
        "source_type",
        "domain",
        "layer_id",
        "affected_object",
        "evidence",
        "recommendation",
    }

    assert all(required_fields <= set(issue) for issue in issues)
    by_rule = {issue["rule_id"]: issue for issue in issues}
    assert by_rule["validation.status"]["layer_id"] == "power.hexes.regional"
    assert by_rule["manual.non_authoritative"]["source_type"] == "manual_seed"
    assert by_rule["reference.overlay"]["source_type"] == "reference_overlay"
    assert all(issue["rule_version"] == "1.0" for issue in issues)


@pytest.mark.parametrize(
    "path",
    [
        "/api/geodata/power/lines",
        "/api/geodata/power/nodes",
        "/api/geodata/power/manual-seeds",
        "/api/geodata/power/hexes/regional",
        "/api/geodata/power/hexes/urban",
        "/api/geodata/power/hexes/local",
    ],
)
def test_existing_geodata_endpoints_serve_geojson(path: str) -> None:
    response = client.get(path)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/geo+json")
    assert response.json()["type"] == "FeatureCollection"


def test_unknown_hex_level_remains_not_found() -> None:
    response = client.get("/api/geodata/power/hexes/unknown")

    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown hex level"}
