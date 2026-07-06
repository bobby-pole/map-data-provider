import argparse
from dataclasses import asdict
from pathlib import Path
from typing import Any

import geopandas as gpd

from geo_pipeline.config import MANUAL_DIR, REPORTS_DIR, RYBNIK_AOI, AoiConfig, ensure_data_dirs
from geo_pipeline.validate import validate_geojson, write_validation_report

DEFAULT_SEED_PATH = MANUAL_DIR / f"{RYBNIK_AOI.name}_power_seed_nodes.geojson"
DEFAULT_REPORT_PATH = REPORTS_DIR / f"{RYBNIK_AOI.name}_power_seed_nodes_validation.json"

REQUIRED_PROPERTIES = {
    "seed_id",
    "name",
    "seed_type",
    "role",
    "voltage_estimate",
    "importance",
    "source",
    "source_reference",
    "confidence",
    "synthetic_allowed",
    "not_authoritative",
    "notes",
}

ALLOWED_SEED_TYPES = {"substation", "traction_substation", "plant", "industrial_node", "grid_node"}
ALLOWED_ROLES = {"anchor", "source", "sink", "junction", "candidate"}
ALLOWED_IMPORTANCE = {"high", "medium", "low"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}


def validate_power_seed_nodes(
    path: Path = DEFAULT_SEED_PATH,
    *,
    aoi: AoiConfig = RYBNIK_AOI,
) -> dict[str, Any]:
    base = validate_geojson(path, aoi=aoi, expected_geometry_types={"Point", "MultiPoint"})
    schema = _validate_seed_schema(path) if base["readable"] else _empty_schema_report()

    status = _combined_status(base["status"], schema["status"])
    return {
        "aoi": asdict(aoi),
        "status": status,
        "layer": "power_seed_nodes",
        "source_policy": {
            "source": "manual_seed",
            "not_authoritative": True,
            "purpose": "Seed input for future synthetic demo topology, not a replacement for OSM/GESUT.",
        },
        "geojson": base,
        "schema": schema,
    }


def _validate_seed_schema(path: Path) -> dict[str, Any]:
    gdf = gpd.read_file(path)
    errors: list[str] = []
    warnings: list[str] = []

    missing_columns = sorted(REQUIRED_PROPERTIES - set(gdf.columns))
    if missing_columns:
        errors.append(f"missing_properties: {', '.join(missing_columns)}")

    duplicate_ids = _duplicates(gdf["seed_id"].dropna().astype(str).tolist()) if "seed_id" in gdf.columns else []
    if duplicate_ids:
        errors.append(f"duplicate_seed_id: {', '.join(duplicate_ids)}")

    for index, row in gdf.iterrows():
        prefix = f"feature[{index}]"
        if str(row.get("source", "")) != "manual_seed":
            errors.append(f"{prefix}.source must be manual_seed")
        if not _as_bool(row.get("not_authoritative")):
            errors.append(f"{prefix}.not_authoritative must be true")
        if not _as_bool(row.get("synthetic_allowed")):
            errors.append(f"{prefix}.synthetic_allowed must be true")
        if str(row.get("seed_type", "")) not in ALLOWED_SEED_TYPES:
            errors.append(f"{prefix}.seed_type invalid")
        if str(row.get("role", "")) not in ALLOWED_ROLES:
            errors.append(f"{prefix}.role invalid")
        if str(row.get("importance", "")) not in ALLOWED_IMPORTANCE:
            errors.append(f"{prefix}.importance invalid")
        if str(row.get("confidence", "")) not in ALLOWED_CONFIDENCE:
            errors.append(f"{prefix}.confidence invalid")
        if not _is_positive_number(row.get("voltage_estimate")):
            warnings.append(f"{prefix}.voltage_estimate missing_or_non_positive")

    return {
        "status": "fail" if errors else "warn" if warnings else "pass",
        "required_properties": sorted(REQUIRED_PROPERTIES),
        "feature_count": int(len(gdf)),
        "errors": errors,
        "warnings": warnings,
    }


def _empty_schema_report() -> dict[str, Any]:
    return {
        "status": "fail",
        "required_properties": sorted(REQUIRED_PROPERTIES),
        "feature_count": 0,
        "errors": ["geojson_not_readable"],
        "warnings": [],
    }


def _combined_status(*statuses: str) -> str:
    if any(status == "fail" for status in statuses):
        return "fail"
    if any(status == "warn" for status in statuses):
        return "warn"
    return "pass"


def _duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def _as_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return bool(value)


def _is_positive_number(value: object) -> bool:
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate manual power seed nodes for synthetic topology generation.")
    parser.add_argument("--input", type=Path, default=DEFAULT_SEED_PATH, help="Manual seed GeoJSON path.")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH, help="Output validation report path.")
    args = parser.parse_args()

    ensure_data_dirs()
    report = validate_power_seed_nodes(args.input)
    write_validation_report(args.report, report)
    print({"status": report["status"], "report": str(args.report)})


if __name__ == "__main__":
    main()
