from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PROCESSED_DIR = DATA_DIR / "processed"
REPORTS_DIR = DATA_DIR / "reports"
MANUAL_DIR = DATA_DIR / "manual"

PASSING_VALIDATION_STATUSES = frozenset({"pass", "ok", "success", "valid"})
WARNING_VALIDATION_STATUSES = frozenset({"warn", "warning"})
FAILING_VALIDATION_STATUSES = frozenset({"fail", "failed", "error", "invalid"})
QUALITY_STATUSES = frozenset({"passed", "warning", "failed", "unknown"})

app = FastAPI(title="Map Data Quality Lab API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Missing file: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def _feature_count(path: Path) -> int:
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    return len(data.get("features") or [])


def normalize_validation_status(value: object | None) -> str:
    """Map report-specific validation spellings to provider-facing quality states."""
    if value is None:
        return "unknown"

    status = str(value).strip().casefold().replace("-", "_").replace(" ", "_")
    if status in PASSING_VALIDATION_STATUSES:
        return "passed"
    if status in WARNING_VALIDATION_STATUSES:
        return "warning"
    if status in FAILING_VALIDATION_STATUSES:
        return "failed"
    return "unknown"


def derive_readiness(*, quality_status: str, feature_count: int, source: str) -> str:
    """Derive conservative provider readiness without changing source metadata contracts."""
    if quality_status not in QUALITY_STATUSES:
        quality_status = "unknown"

    if feature_count == 0 or quality_status == "failed":
        return "not_usable"

    source_key = source.strip().casefold()
    if source_key in {"reference_overlay", "reference_only", "kiut_wms", "gesut_wms"} or "wms" in source_key:
        return "needs_source"
    if quality_status == "unknown":
        return "needs_source"
    if source_key == "manual_seed":
        return "usable_with_limitations"
    if quality_status == "warning":
        return "usable_with_limitations"
    return "ready"


def _report_status(report_path: Path) -> tuple[str | None, str]:
    if not report_path.exists():
        return None, "unknown"
    report = _read_json(report_path)
    raw_status = report.get("status") or report.get("validation_status")
    raw_value = str(raw_status) if raw_status is not None else None
    return raw_value, normalize_validation_status(raw_status)


def _catalog() -> list[dict[str, Any]]:
    layers = [
        {
            "id": "power.lines",
            "label": "Power lines",
            "domain": "power",
            "source": "OpenStreetMap",
            "access": "public",
            "geometry": "LineString/MultiLineString",
            "endpoint": "/api/geodata/power/lines",
            "path": PROCESSED_DIR / "rybnik_60km_power_lines_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_60km_power_validation_clipped.json",
            "analytical_use": "limited_vector_evidence",
        },
        {
            "id": "power.nodes.display",
            "label": "Power nodes display",
            "domain": "power",
            "source": "OpenStreetMap",
            "access": "public",
            "geometry": "Point/MultiPoint",
            "endpoint": "/api/geodata/power/nodes",
            "path": PROCESSED_DIR / "rybnik_60km_power_node_points_display_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_60km_power_validation_clipped.json",
            "analytical_use": "inspection_display_subset",
        },
        {
            "id": "manual.power.seeds",
            "label": "Manual power seed nodes",
            "domain": "power",
            "source": "manual_seed",
            "access": "review_only",
            "geometry": "Point",
            "endpoint": "/api/geodata/power/manual-seeds",
            "path": MANUAL_DIR / "rybnik_60km_power_seed_nodes.geojson",
            "report": REPORTS_DIR / "rybnik_60km_power_seed_nodes_validation.json",
            "analytical_use": "non_authoritative_review_input",
        },
        {
            "id": "power.hexes.regional",
            "label": "Power hexes regional",
            "domain": "power",
            "source": "derived_from_osm",
            "access": "public",
            "geometry": "Polygon",
            "endpoint": "/api/geodata/power/hexes/regional",
            "path": PROCESSED_DIR / "rybnik_60km_power_hexes_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_60km_power_hexes_report.json",
            "analytical_use": "aggregated_quality_signal",
        },
    ]
    result = []
    for layer in layers:
        path = layer.pop("path")
        report = layer.pop("report")
        raw_status, quality_status = _report_status(report)
        feature_count = _feature_count(path)
        result.append(
            {
                **layer,
                "feature_count": feature_count,
                "quality_status": quality_status,
                "validation_status_raw": raw_status,
                "readiness": derive_readiness(
                    quality_status=quality_status,
                    feature_count=feature_count,
                    source=layer["source"],
                ),
                "artifact": str(path.relative_to(ROOT)),
                "validation_report": str(report.relative_to(ROOT)),
            }
        )
    return result


def _issues() -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    catalog = _catalog()
    by_id = {layer["id"]: layer for layer in catalog}

    for layer in catalog:
        if layer["feature_count"] == 0:
            issues.append(
                {
                    "id": f"DQ-{layer['id'].replace('.', '-').upper()}-EMPTY",
                    "layer_id": layer["id"],
                    "severity": "high",
                    "category": "empty_layer",
                    "title": f"{layer['label']} has no features",
                    "evidence": "Layer artifact exists but contains zero GeoJSON features.",
                    "recommendation": "Verify extraction, AOI clipping and source availability.",
                    "status": "open",
                }
            )
        if layer["quality_status"] != "passed":
            issues.append(
                {
                    "id": f"DQ-{layer['id'].replace('.', '-').upper()}-QUALITY",
                    "layer_id": layer["id"],
                    "severity": "medium",
                    "category": "quality_status",
                    "title": f"{layer['label']} quality status is {layer['quality_status']}",
                    "evidence": f"Validation report status: {layer['validation_status_raw'] or 'missing'}.",
                    "recommendation": "Inspect validation report and document source limitations before using this layer analytically.",
                    "status": "open",
                }
            )

    manual = by_id.get("manual.power.seeds")
    if manual and manual["feature_count"] > 0:
        issues.append(
            {
                "id": "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE",
                "layer_id": "manual.power.seeds",
                "severity": "medium",
                "category": "manual_source",
                "title": "Manual seed nodes are not authoritative infrastructure data",
                "evidence": "Manual seed layer is intended for review/synthetic topology experiments only.",
                "recommendation": "Keep manual seeds visually distinct from OSM-derived data and exclude them from source-of-truth analytics.",
                "status": "open",
            }
        )

    issues.append(
        {
            "id": "DQ-KIUT-WMS-REFERENCE-ONLY",
            "layer_id": "external.kiut_wms",
            "severity": "medium",
            "category": "wms_reference_only",
            "title": "KIUT/GESUT WMS must remain visual reference only",
            "evidence": "WMS tiles are rendered images, not analytical vector geometry.",
            "recommendation": "Use OSM/GeoJSON vectors for analytics and document WMS as a visual comparison layer only.",
            "status": "open",
        }
    )
    return issues


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/layers/catalog")
def layers_catalog() -> list[dict[str, Any]]:
    return _catalog()


@app.get("/api/data-quality/issues")
def data_quality_issues() -> list[dict[str, Any]]:
    return _issues()


@app.get("/api/data-quality/metrics")
def data_quality_metrics() -> dict[str, Any]:
    issues = _issues()
    catalog = _catalog()
    return {
        "total_issues": len(issues),
        "open_issues": sum(1 for issue in issues if issue["status"] == "open"),
        "issues_by_severity": dict(Counter(issue["severity"] for issue in issues)),
        "issues_by_category": dict(Counter(issue["category"] for issue in issues)),
        "layers": len(catalog),
        "layers_by_quality_status": dict(Counter(layer["quality_status"] for layer in catalog)),
        "layers_by_readiness": dict(Counter(layer["readiness"] for layer in catalog)),
    }


@app.get("/api/geodata/power/lines")
def get_power_lines() -> FileResponse:
    return FileResponse(PROCESSED_DIR / "rybnik_60km_power_lines_clipped.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/nodes")
def get_power_nodes() -> FileResponse:
    return FileResponse(PROCESSED_DIR / "rybnik_60km_power_node_points_display_clipped.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/manual-seeds")
def get_manual_power_seeds() -> FileResponse:
    return FileResponse(MANUAL_DIR / "rybnik_60km_power_seed_nodes.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/hexes/{level}")
def get_power_hexes(level: str) -> FileResponse:
    suffixes = {"regional": "", "urban": "_urban", "local": "_local"}
    if level not in suffixes:
        raise HTTPException(status_code=404, detail="Unknown hex level")
    return FileResponse(PROCESSED_DIR / f"rybnik_60km_power_hexes{suffixes[level]}_clipped.geojson", media_type="application/geo+json")
