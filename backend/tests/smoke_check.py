import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

for path in [
    "/api/health",
    "/api/layers/catalog",
    "/api/data-quality/issues",
    "/api/data-quality/metrics",
]:
    response = client.get(path)
    assert response.status_code == 200, f"{path}: {response.status_code} {response.text}"

catalog = client.get("/api/layers/catalog").json()
issues = client.get("/api/data-quality/issues").json()
metrics = client.get("/api/data-quality/metrics").json()

assert catalog, "Layer catalog should not be empty"
assert issues, "Data quality issues should not be empty"
assert metrics["total_issues"] == len(issues), "Metrics should match issue count"

print("Smoke check passed")
print(f"layers={len(catalog)} issues={len(issues)}")
