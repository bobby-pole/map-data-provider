"""Measure deterministic fixture preparation and runtime-cache behaviour.

This script is called by ``pnpm run measure:demo``.  It deliberately creates
all data under a temporary directory: benchmark runs do not mutate a checked-in
cache, a local demo bundle, or a VPS bundle.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Any

# The script runs from backend/scripts, whereas the application package is at
# backend/geo_pipeline. Keep the invocation independent of the caller's cwd.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from geo_pipeline.worker import WorkerError, run_runtime_worker, run_worker

DOMAINS = (
    "power",
    "emergency",
    "public",
    "transport",
    "bridges",
    "water",
    "gas",
    "sewer",
    "industrial",
    "telecom",
    "district_heating",
)

AOI_REQUEST: dict[str, Any] = {
    "aoi": {
        "type": "point_radius",
        "longitude": 18.546285,
        "latitude": 50.102174,
        "radius_m": 35_000,
    },
    "profiles": list(DOMAINS),
}


def milliseconds(start: float) -> float:
    return round((time.perf_counter() - start) * 1_000, 3)


def percentile(samples: list[float], value: float) -> float:
    """Return nearest-rank percentile for a non-empty sample."""
    ordered = sorted(samples)
    index = max(0, min(len(ordered) - 1, int((len(ordered) * value + 99) // 100) - 1))
    return ordered[index]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-samples", type=int, default=100)
    args = parser.parse_args()
    if args.cache_samples < 1:
        parser.error("--cache-samples must be at least 1")

    with tempfile.TemporaryDirectory(prefix="mdq-measure-") as temporary_directory:
        root = Path(temporary_directory)
        cache_root = root / "prepared"
        runtime_root = root / "runtime"
        domain_runs: list[dict[str, Any]] = []

        for domain in DOMAINS:
            started = time.perf_counter()
            try:
                result = run_worker(
                    aoi="rybnik_35km",
                    domain=domain,
                    input_mode="fixture",
                    cache_root=cache_root,
                )
                domain_runs.append(
                    {
                        "domain": domain,
                        "status": "success",
                        "duration_ms": milliseconds(started),
                        "processed_feature_count": result["feature_count"],
                        "readiness": result["readiness"],
                    }
                )
            except WorkerError as error:
                domain_runs.append(
                    {
                        "domain": domain,
                        "status": "failure",
                        "duration_ms": milliseconds(started),
                        "error_code": error.code,
                        "error": str(error),
                    }
                )

        failures = [run for run in domain_runs if run["status"] == "failure"]
        if failures:
            print(json.dumps({"status": "error", "domain_runs": domain_runs}), file=sys.stderr)
            return 3

        preparation_started = time.perf_counter()
        first_runtime = run_runtime_worker(
            request=AOI_REQUEST,
            input_mode="fixture",
            cache_root=cache_root,
            runtime_root=runtime_root,
        )
        preparation_duration_ms = milliseconds(preparation_started)

        cache_samples: list[float] = []
        cache_results: Counter[str] = Counter()
        for _ in range(args.cache_samples):
            started = time.perf_counter()
            runtime_result = run_runtime_worker(
                request=AOI_REQUEST,
                input_mode="fixture",
                cache_root=cache_root,
                runtime_root=runtime_root,
            )
            cache_samples.append(milliseconds(started))
            cache_results[runtime_result["request_result"]] += 1

        outcome_statuses = Counter(outcome["status"] for outcome in first_runtime["outcomes"])
        success_count = len(domain_runs)
        total_features = sum(run["processed_feature_count"] for run in domain_runs)
        report = {
            "measurement_version": "mdq_fixture_worker_measurement/v1",
            "fixture_mode": True,
            "aoi_request": AOI_REQUEST,
            "fixture_preparation": {
                "duration_ms": preparation_duration_ms,
                "domains": len(DOMAINS),
                "processed_feature_count": total_features,
                "domain_runs": domain_runs,
            },
            "worker": {
                "successes": success_count,
                "failures": 0,
                "success_rate": 1.0,
            },
            "runtime_cache": {
                "initial_request_result": first_runtime["request_result"],
                "samples": args.cache_samples,
                "hits": cache_results["cache"],
                "misses": args.cache_samples - cache_results["cache"],
                "hit_ratio": round(cache_results["cache"] / args.cache_samples, 6),
                "latency_ms": {
                    "p50": percentile(cache_samples, 50),
                    "p95": percentile(cache_samples, 95),
                    "p99": percentile(cache_samples, 99),
                },
                "observations_ms": cache_samples,
            },
            "runtime_outcomes": {
                "ready": outcome_statuses["ready"],
                "needs_source": outcome_statuses["needs_source"],
                "failed": outcome_statuses["failed"],
            },
        }
        print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
