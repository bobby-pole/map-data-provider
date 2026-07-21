"""Machine-readable CLI contract for refreshable provider cache artifacts."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any

from geo_pipeline.cache import build_rybnik_power_cache, cache_paths, read_cached_layer
from geo_pipeline.config import CACHE_DIR, RYBNIK_AOI

EXIT_INVALID_REQUEST = 2
EXIT_WORKER_FAILURE = 3


def run_worker(*, aoi: str, domain: str, input_mode: str, cache_root: Path) -> dict[str, Any]:
    if aoi != RYBNIK_AOI.name or domain != "power":
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_target", "Only rybnik_60km/power is supported.")

    target = cache_paths(aoi, domain, root=cache_root)
    if input_mode == "cache":
        cache = read_cached_layer(target)
        return _success(aoi, domain, input_mode, cache, refreshed=False)
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_input", f"Unsupported input mode: {input_mode}")

    if input_mode == "live":
        from geo_pipeline.layers.power import extract_power_grid

        extract_power_grid(write_preview=False)

    staging_root = cache_root.parent / f".{cache_root.name}-worker-{uuid.uuid4().hex}"
    try:
        staged_cache = build_rybnik_power_cache(root=staging_root)
        _replace_cache(target.root, cache_paths(aoi, domain, root=staging_root).root)
        return _success(aoi, domain, input_mode, staged_cache, refreshed=True)
    except WorkerError:
        raise
    except Exception as error:
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def _replace_cache(target: Path, staged: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = target.parent / f".{target.name}-backup-{uuid.uuid4().hex}"
    moved_existing = False
    try:
        if target.exists():
            target.replace(backup)
            moved_existing = True
        staged.replace(target)
    except Exception:
        if moved_existing and backup.exists() and not target.exists():
            backup.replace(target)
        raise
    finally:
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)


def _success(aoi: str, domain: str, input_mode: str, cache: dict[str, Any], *, refreshed: bool) -> dict[str, Any]:
    return {
        "status": "ok",
        "aoi_id": aoi,
        "domain": domain,
        "input": input_mode,
        "refreshed": refreshed,
        "feature_count": cache["metadata"]["feature_count"],
        "readiness": cache["readiness"]["readiness"],
    }


class WorkerError(Exception):
    def __init__(self, exit_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.code = code


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh or validate provider cache artifacts.")
    parser.add_argument("--aoi", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--input", choices=["fixture", "cache", "live"], default="fixture")
    parser.add_argument("--cache-root", type=Path, default=CACHE_DIR)
    args = parser.parse_args()
    try:
        print(json.dumps(run_worker(aoi=args.aoi, domain=args.domain, input_mode=args.input, cache_root=args.cache_root)))
        return 0
    except WorkerError as error:
        print(json.dumps({"status": "error", "code": error.code, "message": str(error)}), file=sys.stderr)
        return error.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
