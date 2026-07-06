import pytest
from fastapi.testclient import TestClient

from app.main import app


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
    assert all(layer["feature_count"] > 0 for layer in catalog)
    assert all(layer["artifact"].startswith("data/") for layer in catalog)
    assert all(layer["validation_report"].startswith("data/") for layer in catalog)


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
