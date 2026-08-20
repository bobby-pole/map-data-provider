from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from geo_pipeline.quality_rules import highest_issue_severity, triggered_issues
from geo_pipeline.readiness import QUALITY_STATUSES, SOURCE_TYPES, derive_readiness

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PROCESSED_DIR = DATA_DIR / "processed"
REPORTS_DIR = DATA_DIR / "reports"
MANUAL_DIR = DATA_DIR / "manual"

PASSING_VALIDATION_STATUSES = frozenset({"pass", "ok", "success", "valid"})
WARNING_VALIDATION_STATUSES = frozenset({"warn", "warning"})
FAILING_VALIDATION_STATUSES = frozenset({"fail", "failed", "error", "invalid"})
CONFIDENCE_LEVELS = frozenset({"high", "medium", "low", "not_applicable"})

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


def _report_status(report_path: Path | None) -> tuple[str | None, str]:
    if report_path is None or not report_path.exists():
        return None, "unknown"
    report = _read_json(report_path)
    raw_status = report.get("status") or report.get("validation_status")
    raw_value = str(raw_status) if raw_status is not None else None
    return raw_value, normalize_validation_status(raw_status)


def _catalog_base() -> list[dict[str, Any]]:
    layers = [
        {
            "id": "power.lines",
            "label": "Power lines",
            "domain": "power",
            "source": "OpenStreetMap",
            "source_type": "analytical_vector",
            "confidence": "medium",
            "limitations": [
                "OSM completeness varies by area and asset type.",
                "Passed validation does not prove complete real-world infrastructure coverage.",
            ],
            "not_authoritative": False,
            "eligible_for_analysis": True,
            "access": "public",
            "geometry": "LineString/MultiLineString",
            "endpoint": "/api/geodata/power/lines",
            "path": PROCESSED_DIR / "rybnik_35km_power_lines_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_35km_power_validation_clipped.json",
            "analytical_use": "limited_vector_evidence",
        },
        {
            "id": "power.nodes.display",
            "label": "Power nodes display",
            "domain": "power",
            "source": "OpenStreetMap",
            "source_type": "analytical_vector",
            "confidence": "medium",
            "limitations": [
                "Display nodes are a provider-selected subset of available OSM power objects.",
                "Passed validation does not prove complete real-world infrastructure coverage.",
            ],
            "not_authoritative": False,
            "eligible_for_analysis": True,
            "access": "public",
            "geometry": "Point/MultiPoint",
            "endpoint": "/api/geodata/power/nodes",
            "path": PROCESSED_DIR / "rybnik_35km_power_node_points_display_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_35km_power_validation_clipped.json",
            "analytical_use": "inspection_display_subset",
        },
        {
            "id": "manual.power.seeds",
            "label": "Manual power seed nodes",
            "domain": "power",
            "source": "manual_seed",
            "source_type": "manual_seed",
            "confidence": "low",
            "limitations": [
                "Manual seeds are non-authoritative review inputs.",
                "Manual seed geometry must not replace OSM or authoritative utility data.",
            ],
            "not_authoritative": True,
            "eligible_for_analysis": False,
            "access": "review_only",
            "geometry": "Point",
            "endpoint": "/api/geodata/power/manual-seeds",
            "path": MANUAL_DIR / "rybnik_35km_power_seed_nodes.geojson",
            "report": REPORTS_DIR / "rybnik_35km_power_seed_nodes_validation.json",
            "analytical_use": "non_authoritative_review_input",
        },
        {
            "id": "power.hexes.regional",
            "label": "Power hexes regional",
            "domain": "power",
            "source": "OpenStreetMap-derived",
            "source_type": "analytical_vector",
            "confidence": "low",
            "limitations": [
                "No normalized validation result is available for the current aggregated report.",
                "Aggregated quality signals inherit OSM coverage limitations.",
            ],
            "not_authoritative": False,
            "eligible_for_analysis": True,
            "access": "public",
            "geometry": "Polygon",
            "endpoint": "/api/geodata/power/hexes/regional",
            "path": PROCESSED_DIR / "rybnik_35km_power_hexes_clipped.geojson",
            "report": REPORTS_DIR / "rybnik_35km_power_hexes_report.json",
            "analytical_use": "aggregated_quality_signal",
        },
        {
            "id": "external.kiut_wms",
            "label": "KIUT/GESUT WMS reference overlay",
            "domain": "power",
            "source": "KIUT/GESUT WMS",
            "source_type": "reference_overlay",
            "confidence": "not_applicable",
            "limitations": [
                "WMS tiles are raster images, not analytical vector geometry.",
                "The overlay may be unavailable or incomplete and is not a source-of-truth analytical input.",
            ],
            "not_authoritative": True,
            "eligible_for_analysis": False,
            "access": "reference_only",
            "geometry": "Raster WMS",
            "endpoint": "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu",
            "path": None,
            "report": None,
            "analytical_use": "visual_reference_only",
        },
    ]
    result = []
    for layer in layers:
        if layer["source_type"] not in SOURCE_TYPES:
            raise ValueError(f"Unsupported source type for {layer['id']}: {layer['source_type']}")
        if layer["confidence"] not in CONFIDENCE_LEVELS:
            raise ValueError(f"Unsupported confidence for {layer['id']}: {layer['confidence']}")

        path = layer.pop("path")
        report = layer.pop("report")
        raw_status, quality_status = _report_status(report)
        feature_count = _feature_count(path) if path is not None else 0
        result.append(
            {
                **layer,
                "feature_count": feature_count,
                "quality_status": quality_status,
                "validation_status_raw": raw_status,
                "readiness": derive_readiness(
                    quality_status=quality_status,
                    feature_count=feature_count,
                    source_type=layer["source_type"],
                ),
                "artifact": str(path.relative_to(ROOT)) if path is not None else None,
                "validation_report": str(report.relative_to(ROOT)) if report is not None else None,
            }
        )
    return result


def _catalog_and_issues() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    catalog = _catalog_base()
    issues_by_layer = {layer["id"]: triggered_issues(layer) for layer in catalog}
    for layer in catalog:
        layer_issues = issues_by_layer[layer["id"]]
        layer["readiness"] = derive_readiness(
            quality_status=layer["quality_status"],
            feature_count=layer["feature_count"],
            source_type=layer["source_type"],
            issue_severity=highest_issue_severity(layer_issues),
        )
    return catalog, [issue for layer_issues in issues_by_layer.values() for issue in layer_issues]


def _catalog() -> list[dict[str, Any]]:
    return _catalog_and_issues()[0]


def _issues() -> list[dict[str, Any]]:
    return _catalog_and_issues()[1]


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
    catalog, issues = _catalog_and_issues()
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
    return FileResponse(PROCESSED_DIR / "rybnik_35km_power_lines_clipped.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/nodes")
def get_power_nodes() -> FileResponse:
    return FileResponse(PROCESSED_DIR / "rybnik_35km_power_node_points_display_clipped.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/manual-seeds")
def get_manual_power_seeds() -> FileResponse:
    return FileResponse(MANUAL_DIR / "rybnik_35km_power_seed_nodes.geojson", media_type="application/geo+json")


@app.get("/api/geodata/power/hexes/{level}")
def get_power_hexes(level: str) -> FileResponse:
    suffixes = {"regional": "", "urban": "_urban", "local": "_local"}
    if level not in suffixes:
        raise HTTPException(status_code=404, detail="Unknown hex level")
    return FileResponse(PROCESSED_DIR / f"rybnik_35km_power_hexes{suffixes[level]}_clipped.geojson", media_type="application/geo+json")
