"""Parallel acquisition, serialized presentation build, and runtime worker orchestration."""

from __future__ import annotations

import shutil
import signal
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import (
    FIRST_COMPLETED,
    ProcessPoolExecutor,
    ThreadPoolExecutor,
    wait,
)
from pathlib import Path
from typing import Any

from shapely.geometry import shape

from geo_pipeline.adapters import AdapterError, resolve_adapter
from geo_pipeline.aoi_runtime import (
    RuntimeRequestError,
    profile_outcomes,
    resolve_runtime_request,
)
from geo_pipeline.cache import cache_paths, read_cached_layer
from geo_pipeline.config import RUNTIME_CACHE_DIR
from geo_pipeline.domain_pack import build_map_presentation, domain_pack_root, read_domain_pack
from geo_pipeline.runtime.state import (
    EXIT_INVALID_REQUEST,
    EXIT_WORKER_FAILURE,
    DomainAcquisitionTimeout,
    RuntimeProgressCallback,
    WorkerError,
    emit_runtime_progress,
    failed_runtime_outcome,
    has_retryable_failures,
    publish_runtime_response,
    read_domain_checkpoint,
    read_fresh_runtime_state,
    replace_cache,
    report_existing_runtime_outcomes,
    runtime_response,
    success,
    utc_timestamp,
    validate_ready_runtime_artifacts,
    write_runtime_state,
)
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain
from geo_pipeline.source_availability import build_runtime_source_availability
from geo_pipeline.vector_tiles import read_map_presentation

MAX_CONCURRENT_LIVE_DOMAINS = 2
MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS = 120
EXTRA_TIMEOUT_PER_AOI_PART_SECONDS = 15
MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS = 240


def domain_acquisition_timeout(aoi: dict[str, Any]) -> int:
    """Allow more time for an official AOI that has several disconnected parts.

    OSMnx must query each polygonal part individually.  The cap keeps one slow
    public endpoint from holding a retry forever while avoiding a fixed limit
    that is unrealistically small for a genuine multi-gmina selection.
    """
    geometry = shape(aoi["geometry"])
    parts = len(geometry.geoms) if geometry.geom_type == "MultiPolygon" else 1
    return min(
        MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS,
        MIN_DOMAIN_ACQUISITION_TIMEOUT_SECONDS
        + max(parts - 1, 0) * EXTRA_TIMEOUT_PER_AOI_PART_SECONDS,
    )


def run_worker(
    *,
    aoi: str,
    domain: str,
    input_mode: str,
    cache_root: Path,
    adapter_resolver: Callable[[str, str], Any] | None = None,
    cache_replacer: Callable[[Path, Path], None] | None = None,
) -> dict[str, Any]:
    """Execute single-AOI/domain fixture or live cache refresh for a registered adapter."""
    resolver = adapter_resolver or resolve_adapter
    swap_cache = cache_replacer or replace_cache
    try:
        adapter = resolver(aoi, domain)
    except AdapterError as error:
        raise WorkerError(EXIT_INVALID_REQUEST, "unsupported_target", str(error)) from error

    target = cache_paths(adapter.aoi_alias, adapter.domain, root=cache_root)
    if input_mode == "cache":
        cache = read_cached_layer(target)
        return success(adapter, input_mode, cache, refreshed=False)
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(
            EXIT_INVALID_REQUEST,
            "unsupported_input",
            f"Unsupported input mode: {input_mode}",
        )

    if input_mode == "live":
        adapter.run_live()

    staging_root = cache_root.parent / f".{cache_root.name}-worker-{uuid.uuid4().hex}"
    try:
        staged_cache = adapter.build_fixture(staging_root)
        adapter.build_domain_pack(staging_root)
        swap_cache(
            target.root,
            cache_paths(adapter.aoi_alias, adapter.domain, root=staging_root).root,
        )
        return success(adapter, input_mode, staged_cache, refreshed=True)
    except WorkerError:
        raise
    except Exception as error:
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def run_runtime_worker(
    *,
    request: dict[str, Any],
    input_mode: str,
    cache_root: Path,
    runtime_root: Path | None = None,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
    refresh_fn: Callable[..., dict[str, Any]] | None = None,
    finish_fn: Callable[..., dict[str, Any]] | None = None,
    pack_reader: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Resolve a v2 request and publish selected qualified OSM runtime packs."""
    if input_mode not in {"fixture", "live"}:
        raise WorkerError(
            EXIT_INVALID_REQUEST,
            "unsupported_input",
            f"Unsupported input mode: {input_mode}",
        )
    try:
        resolved = resolve_runtime_request(request)
    except RuntimeRequestError as error:
        raise WorkerError(EXIT_INVALID_REQUEST, "invalid_aoi_request", str(error)) from error
    state_root = (runtime_root or RUNTIME_CACHE_DIR) / "provider-runtime-v1"
    # Acquisition-only packs cannot satisfy a subsequent map-producing request.
    mode_key = ("vectors" if skip_pmtiles else "map") + f"-{input_mode}"
    state_path = state_root / f"{resolved['cache_key']}-{mode_key}.json"
    checkpoint_root = state_root / "domains" / resolved["aoi"]["cache_key"] / mode_key
    cached = read_fresh_runtime_state(state_path)
    if cached is not None:
        try:
            if input_mode == "live":
                validated = []
                for item in cached["outcomes"]:
                    if item["status"] in {"ready", "needs_source"}:
                        checkpoint = read_domain_checkpoint(
                            checkpoint_root / f"{item['domain']}.json",
                            resolved,
                            cache_root,
                            not skip_pmtiles,
                            pack_reader=pack_reader,
                        )
                        if checkpoint is None:
                            raise ValueError("A cached domain is expired, missing or corrupt")
                        validated.append(checkpoint)
                    else:
                        validated.append(item)
                cached = {**cached, "outcomes": validated}
            else:
                validate_ready_runtime_artifacts(
                    cached["outcomes"],
                    cache_root,
                    require_pmtiles=not skip_pmtiles,
                    pack_reader=pack_reader,
                )
        except Exception:
            cached = None
        if cached is not None and not has_retryable_failures(cached["outcomes"]):
            emit_runtime_progress(progress, event="cache_hit", outcomes=cached["outcomes"])
            return {**cached, "request_result": "cache"}
    try:
        outcomes = profile_outcomes(request, fixture_mode=input_mode == "fixture")
        emit_runtime_progress(progress, event="started", outcomes=[], total_domains=len(outcomes))
        if input_mode == "live":
            checkpointed: set[str] = set()
            for index, outcome in enumerate(outcomes):
                checkpoint = read_domain_checkpoint(
                    checkpoint_root / f"{outcome['domain']}.json",
                    resolved,
                    cache_root,
                    not skip_pmtiles,
                    pack_reader=pack_reader,
                )
                if checkpoint is not None:
                    outcomes[index] = checkpoint
                    checkpointed.add(outcome["domain"])
            initial_by_domain = {item["domain"]: item for item in outcomes}

            def publish_completed(completed: list[dict[str, Any]]) -> dict[str, Any] | None:
                by_domain = {item["domain"]: item for item in completed}
                partial = [
                    by_domain.get(
                        item["domain"],
                        {
                            **initial_by_domain[item["domain"]],
                            "status": "pending_qualification",
                            "artifact_aoi_id": None,
                            "detail": "This domain is still being prepared; it is not yet published.",
                            "cache_status": "missing",
                            "failure_reason": None,
                        },
                    )
                    for item in outcomes
                ]
                for item in completed:
                    if (
                        item["status"] in {"ready", "needs_source"}
                        and item["domain"] not in checkpointed
                    ):
                        write_runtime_state(
                            checkpoint_root / f"{item['domain']}.json",
                            {
                                "cached_at": utc_timestamp(),
                                "pipeline_version": resolved["pipeline_version"],
                                "outcome": item,
                            },
                        )
                        checkpointed.add(item["domain"])
                if not any(item["status"] == "ready" for item in partial):
                    return None
                partial_response = runtime_response(resolved, partial, request)
                publish_runtime_response(partial_response, cache_root)
                write_runtime_state(state_path, partial_response)
                return partial_response

            outcomes = refresh_live_runtime_outcomes(
                resolved,
                outcomes,
                cache_root,
                progress=progress,
                executor_type=executor_type,
                skip_pmtiles=skip_pmtiles,
                on_completed=publish_completed,
                refresh_fn=refresh_fn,
                finish_fn=finish_fn,
            )
        else:
            outcomes = report_existing_runtime_outcomes(outcomes, progress=progress)
        validate_ready_runtime_artifacts(outcomes, cache_root, pack_reader=pack_reader)
        aoi_id = resolved["aoi"]["aoi_id"]
        source_avail_root = cache_root.parents[0] / "source-availability"
        build_runtime_source_availability(aoi_id, out_path=source_avail_root / f"{aoi_id}.json")
        build_runtime_source_availability(
            aoi_id, out_path=cache_root / aoi_id / "source_availability.json"
        )
        response = runtime_response(resolved, outcomes, request)
        if input_mode == "live":
            publish_runtime_response(response, cache_root)
        write_runtime_state(state_path, response)
        return response
    except WorkerError:
        raise
    except Exception as error:
        # State is written only after every ready artifact validates, so a
        # failed attempt cannot replace a previous valid cached response.
        raise WorkerError(EXIT_WORKER_FAILURE, "worker_failed", str(error)) from error


def refresh_live_runtime_outcomes(
    resolved: dict[str, Any],
    outcomes: list[dict[str, Any]],
    cache_root: Path,
    *,
    progress: RuntimeProgressCallback | None = None,
    executor_type: type[ProcessPoolExecutor | ThreadPoolExecutor] = ProcessPoolExecutor,
    skip_pmtiles: bool = False,
    on_completed: Callable[[list[dict[str, Any]]], dict[str, Any] | None] | None = None,
    refresh_fn: Callable[..., dict[str, Any]] | None = None,
    finish_fn: Callable[..., dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Two acquisition processes feed one PMTiles builder through staged disk packs."""
    if not outcomes:
        return []
    acquire_task = refresh_fn or refresh_runtime_domain
    finish_task = finish_fn or finish_runtime_domain
    completed: list[dict[str, Any]] = []
    by_domain: dict[str, dict[str, Any]] = {}
    # Keep staged and published packs on the same bind mount for atomic rename.
    # Dot-prefixed directories are excluded by the snapshot catalogue identifier guard.
    staging_root = cache_root / f".runtime-stage-{uuid.uuid4().hex}"

    def finish(outcome: dict[str, Any]) -> None:
        by_domain[outcome["domain"]] = outcome
        completed.append(outcome)
        partial_result = on_completed(list(completed)) if on_completed else None
        emit_runtime_progress(
            progress,
            event="domain_completed",
            outcomes=completed,
            total_domains=len(outcomes),
            partial_result=partial_result,
            active_domain=next((item[1]["domain"] for item in futures.values()), None),
        )

    try:
        with (
            executor_type(
                max_workers=min(MAX_CONCURRENT_LIVE_DOMAINS, len(outcomes))
            ) as acquisition,
            executor_type(max_workers=1) as builder,
        ):
            futures = {}
            pending_outcomes = []
            for outcome in outcomes:
                if outcome.get("cache_status") == "fresh" or (
                    outcome.get("status") == "needs_source"
                    and outcome.get("queried_feature_count") is not None
                ):
                    finish(outcome)
                else:
                    pending_outcomes.append(outcome)
            pending = iter(pending_outcomes)

            def submit_next() -> None:
                outcome = next(pending, None)
                if outcome is None:
                    return
                emit_runtime_progress(
                    progress,
                    event="domain_started",
                    outcomes=completed,
                    total_domains=len(outcomes),
                    active_domain=outcome["domain"],
                )
                future = acquisition.submit(
                    acquire_task,
                    resolved["aoi"],
                    outcome["domain"],
                    str(staging_root),
                    True,
                )
                futures[future] = ("acquisition", outcome)

            for _ in range(min(MAX_CONCURRENT_LIVE_DOMAINS, len(pending_outcomes))):
                submit_next()
            while futures:
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in done:
                    stage, outcome = futures.pop(future)
                    if stage == "acquisition":
                        submit_next()
                    try:
                        result = future.result()
                        next_outcome = {**outcome, **result, "failure_reason": None}
                        if stage == "acquisition" and result["status"] == "ready":
                            emit_runtime_progress(
                                progress,
                                event="domain_building",
                                outcomes=completed,
                                total_domains=len(outcomes),
                                active_domain=outcome["domain"],
                            )
                            build = builder.submit(
                                finish_task,
                                resolved["aoi"],
                                next_outcome,
                                str(staging_root),
                                str(cache_root),
                                skip_pmtiles,
                            )
                            futures[build] = ("presentation", next_outcome)
                            continue
                    except BaseException as error:
                        next_outcome = failed_runtime_outcome(outcome, error)
                    finish(next_outcome)
        return [by_domain[outcome["domain"]] for outcome in outcomes]
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def finish_runtime_domain(
    aoi: dict[str, Any],
    outcome: dict[str, Any],
    staging_root: str,
    cache_root: str,
    skip_pmtiles: bool,
    *,
    pack_reader: Callable[..., dict[str, Any]] | None = None,
    presentation_builder: Callable[..., Any] | None = None,
    cache_replacer: Callable[[Path, Path], None] | None = None,
) -> dict[str, Any]:
    """Only this single-process stage builds memory-heavy map artifacts."""
    read_pack = pack_reader or read_domain_pack
    build_presentation = presentation_builder or build_map_presentation
    swap_cache = cache_replacer or replace_cache
    domain = outcome["domain"]
    started = time.monotonic()

    def timed_out(_signal: int, _frame: Any) -> None:
        raise DomainAcquisitionTimeout(f"Timed out while building '{domain}' map presentation.")

    use_alarm = hasattr(signal, "SIGALRM") and threading.current_thread() is threading.main_thread()
    previous = signal.signal(signal.SIGALRM, timed_out) if use_alarm else None
    if use_alarm:
        signal.setitimer(signal.ITIMER_REAL, MAX_DOMAIN_ACQUISITION_TIMEOUT_SECONDS)
    try:
        root = Path(staging_root)
        pack = read_pack(aoi["aoi_id"], domain, root=root)
        if not skip_pmtiles:
            build_presentation(
                pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack
            )
            read_map_presentation(
                pack_root=domain_pack_root(aoi["aoi_id"], domain, root=root), manifest=pack
            )
        duration = int((time.monotonic() - started) * 1000)
        # Do not interrupt the tiny backup/replace transaction with SIGALRM.
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
        swap_cache(Path(cache_root) / aoi["aoi_id"] / domain, root / aoi["aoi_id"] / domain)
        return {
            **outcome,
            "preparation_duration_ms": (outcome.get("preparation_duration_ms") or 0) + duration,
            "stage_durations_ms": {
                **outcome.get("stage_durations_ms", {}),
                "pmtiles": duration if not skip_pmtiles else 0,
            },
        }
    finally:
        if use_alarm:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)


def refresh_runtime_domain(
    aoi: dict[str, Any],
    domain: str,
    cache_root: str,
    skip_pmtiles: bool = False,
    *,
    refresher: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run live acquisition for one domain with isolated settings and timeouts.

    Acquisition has a POSIX deadline of 120-240s in the isolated main thread.
    Direct Overpass requests also have socket timeouts. The host orchestrator
    enforces an eight-minute deadline on the complete job and its process group.
    The separate, serialized presentation stage has its own 240s deadline.
    """
    refresh = refresher or refresh_runtime_osm_domain
    started = time.monotonic()

    def _invoke() -> dict[str, Any]:
        if skip_pmtiles:
            result = refresh(aoi=aoi, domain=domain, root=Path(cache_root), build_pmtiles=False)
        else:
            result = refresh(aoi=aoi, domain=domain, root=Path(cache_root))
        return {**result, "preparation_duration_ms": int((time.monotonic() - started) * 1000)}

    if not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
        return _invoke()

    timeout_seconds = domain_acquisition_timeout(aoi)

    def timed_out(_signal: int, _frame: Any) -> None:
        raise DomainAcquisitionTimeout(
            f"Timed out after {timeout_seconds} seconds while acquiring '{domain}'."
        )

    previous = signal.signal(signal.SIGALRM, timed_out)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        return _invoke()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
