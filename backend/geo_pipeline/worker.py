"""Machine-readable CLI contract and public facade for provider cache/runtime workers."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path
from typing import Any

from geo_pipeline.adapters import resolve_adapter
from geo_pipeline.config import CACHE_DIR
from geo_pipeline.domain_pack import build_map_presentation, read_domain_pack
from geo_pipeline.runtime.executor import (
    EXTRA_TIMEOUT_PER_AOI_PART_SECONDS,
    MAX_CONCURRENT_LIVE_DOMAINS,
    MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS,
    MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS,
)
from geo_pipeline.runtime.executor import (
    domain_acquisition_timeout as _domain_acquisition_timeout,
)
from geo_pipeline.runtime.executor import (
    finish_runtime_domain as _impl_finish_runtime_domain,
)
from geo_pipeline.runtime.executor import (
    refresh_live_runtime_outcomes as _impl_refresh_live_runtime_outcomes,
)
from geo_pipeline.runtime.executor import (
    refresh_runtime_domain as _impl_refresh_runtime_domain,
)
from geo_pipeline.runtime.executor import (
    run_runtime_worker as _impl_run_runtime_worker,
)
from geo_pipeline.runtime.executor import (
    run_worker as _impl_run_worker,
)
from geo_pipeline.runtime.state import (
    EXIT_INVALID_REQUEST,
    EXIT_WORKER_FAILURE,
    DomainAcquisitionTimeout,
    RuntimeProgressCallback,
    WorkerError,
)
from geo_pipeline.runtime.state import (
    emit_runtime_progress as _emit_runtime_progress,
)
from geo_pipeline.runtime.state import (
    failed_runtime_outcome as _failed_runtime_outcome,
)
from geo_pipeline.runtime.state import (
    has_retryable_failures as _has_retryable_failures,
)
from geo_pipeline.runtime.state import (
    is_complete_runtime_state as _is_complete_runtime_state,
)
from geo_pipeline.runtime.state import (
    publish_runtime_response as _publish_runtime_response,
)
from geo_pipeline.runtime.state import (
    read_domain_checkpoint as _impl_read_domain_checkpoint,
)
from geo_pipeline.runtime.state import (
    read_fresh_runtime_state as _read_fresh_runtime_state,
)
from geo_pipeline.runtime.state import (
    replace_cache as _replace_cache,
)
from geo_pipeline.runtime.state import (
    report_existing_runtime_outcomes as _report_existing_runtime_outcomes,
)
from geo_pipeline.runtime.state import (
    runtime_response as _runtime_response,
)
from geo_pipeline.runtime.state import (
    success as _success,
)
from geo_pipeline.runtime.state import (
    utc_timestamp as _utc_timestamp,
)
from geo_pipeline.runtime.state import (
    validate_ready_runtime_artifacts as _impl_validate_ready_runtime_artifacts,
)
from geo_pipeline.runtime.state import (
    write_runtime_state as _write_runtime_state,
)
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain


def run_worker(*, aoi: str, domain: str, input_mode: str, cache_root: Path) -> dict[str, Any]:
    """Execute single-AOI/domain worker contract with monkeypatch-aware hooks."""
    return _impl_run_worker(
        aoi=aoi,
        domain=domain,
        input_mode=input_mode,
        cache_root=cache_root,
        adapter_resolver=resolve_adapter,
        cache_replacer=_replace_cache,
    )


def _validate_ready_runtime_artifacts(
    outcomes: list[dict[str, Any]], cache_root: Path, *, require_pmtiles: bool = False
) -> None:
    _impl_validate_ready_runtime_artifacts(
        outcomes, cache_root, require_pmtiles=require_pmtiles, pack_reader=read_domain_pack
    )


def _read_domain_checkpoint(
    path: Path, resolved: dict[str, Any], cache_root: Path, require_pmtiles: bool
) -> dict[str, Any] | None:
    return _impl_read_domain_checkpoint(
        path, resolved, cache_root, require_pmtiles, pack_reader=read_domain_pack
    )


def _finish_runtime_domain(
    aoi: dict[str, Any],
    outcome: dict[str, Any],
    staging_root: str,
    cache_root: str,
    skip_pmtiles: bool,
) -> dict[str, Any]:
    return _impl_finish_runtime_domain(
        aoi,
        outcome,
        staging_root,
        cache_root,
        skip_pmtiles,
        pack_reader=read_domain_pack,
        presentation_builder=build_map_presentation,
        cache_replacer=_replace_cache,
    )


def _refresh_runtime_domain(
    aoi: dict[str, Any], domain: str, cache_root: str, skip_pmtiles: bool = False
) -> dict[str, Any]:
    return _impl_refresh_runtime_domain(
        aoi, domain, cache_root, skip_pmtiles, refresher=refresh_runtime_osm_domain
    )


def _refresh_live_runtime_outcomes(
    resolved: dict[str, Any],
    outcomes: list[dict[str, Any]],
    cache_root: Path,
    *,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
    on_completed: Callable[[list[dict[str, Any]]], dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    return _impl_refresh_live_runtime_outcomes(
        resolved,
        outcomes,
        cache_root,
        progress=progress,
        executor_type=executor_type,
        skip_pmtiles=skip_pmtiles,
        on_completed=on_completed,
        refresh_fn=_refresh_runtime_domain,
        finish_fn=_finish_runtime_domain,
    )


def run_runtime_worker(
    *,
    request: dict[str, Any],
    input_mode: str,
    cache_root: Path,
    runtime_root: Path | None = None,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
) -> dict[str, Any]:
    """Resolve a v2 request and publish selected qualified OSM runtime packs."""
    return _impl_run_runtime_worker(
        request=request,
        input_mode=input_mode,
        cache_root=cache_root,
        runtime_root=runtime_root,
        progress=progress,
        executor_type=executor_type,
        skip_pmtiles=skip_pmtiles,
        refresh_fn=_refresh_runtime_domain,
        finish_fn=_finish_runtime_domain,
        pack_reader=read_domain_pack,
    )


def main() -> int:
    """CLI entrypoint invoked by Node backend and provider verification tools."""
    parser = argparse.ArgumentParser(description="Refresh or validate provider cache artifacts.")
    parser.add_argument("--aoi")
    parser.add_argument("--domain")
    parser.add_argument("--input", choices=["fixture", "cache", "live"], default="fixture")
    parser.add_argument("--cache-root", type=Path, default=CACHE_DIR)
    parser.add_argument("--runtime-request", help="JSON provider_aoi_request/v2 payload")
    parser.add_argument(
        "--progress-jsonl",
        action="store_true",
        help="Write runtime preparation progress as prefixed JSON lines to stderr.",
    )
    parser.add_argument(
        "--skip-pmtiles",
        action="store_true",
        help="Do not build a PMTiles presentation (public demo mode).",
    )
    args = parser.parse_args()
    try:
        if args.runtime_request:
            if args.aoi or args.domain:
                raise WorkerError(
                    EXIT_INVALID_REQUEST,
                    "invalid_aoi_request",
                    "Runtime request cannot be combined with --aoi or --domain.",
                )
            try:
                request = json.loads(args.runtime_request)
            except json.JSONDecodeError as error:
                raise WorkerError(
                    EXIT_INVALID_REQUEST,
                    "invalid_aoi_request",
                    "Runtime request must be valid JSON.",
                ) from error

            def report_progress(event: dict[str, Any]) -> None:
                if args.progress_jsonl:
                    print(f"MDQ_PROGRESS:{json.dumps(event)}", file=sys.stderr, flush=True)

            print(
                json.dumps(
                    run_runtime_worker(
                        request=request,
                        input_mode=args.input,
                        cache_root=args.cache_root,
                        progress=report_progress,
                        skip_pmtiles=args.skip_pmtiles,
                    )
                )
            )
            return 0
        if not args.aoi or not args.domain:
            raise WorkerError(
                EXIT_INVALID_REQUEST,
                "invalid_request",
                "--aoi and --domain are required without --runtime-request.",
            )
        print(
            json.dumps(
                run_worker(
                    aoi=args.aoi,
                    domain=args.domain,
                    input_mode=args.input,
                    cache_root=args.cache_root,
                )
            )
        )
        return 0
    except WorkerError as error:
        print(
            json.dumps({"status": "error", "code": error.code, "message": str(error)}),
            file=sys.stderr,
        )
        return error.exit_code


__all__ = [
    "EXIT_INVALID_REQUEST",
    "EXIT_WORKER_FAILURE",
    "EXTRA_TIMEOUT_PER_AOI_PART_SECONDS",
    "MAX_CONCURRENT_LIVE_DOMAINS",
    "MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS",
    "MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS",
    "DomainAcquisitionTimeout",
    "RuntimeProgressCallback",
    "WorkerError",
    "_domain_acquisition_timeout",
    "_emit_runtime_progress",
    "_failed_runtime_outcome",
    "_finish_runtime_domain",
    "_has_retryable_failures",
    "_is_complete_runtime_state",
    "_publish_runtime_response",
    "_read_domain_checkpoint",
    "_read_fresh_runtime_state",
    "_refresh_live_runtime_outcomes",
    "_refresh_runtime_domain",
    "_replace_cache",
    "_report_existing_runtime_outcomes",
    "_runtime_response",
    "_success",
    "_utc_timestamp",
    "_validate_ready_runtime_artifacts",
    "_write_runtime_state",
    "build_map_presentation",
    "main",
    "read_domain_pack",
    "refresh_runtime_osm_domain",
    "resolve_adapter",
    "run_runtime_worker",
    "run_worker",
]

if __name__ == "__main__":
    raise SystemExit(main())
