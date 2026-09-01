#!/usr/bin/env python3
"""Prepare an MDQ-057 regional snapshot outside Git using bounded Overpass QL.

This is an operator command. It has no HTTP route and cannot broaden public
demo policy. A prior publication is copied into `previous/` before a refresh,
so an operator can restore it after an upstream failure or bad observation.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from geo_pipeline.aoi_runtime import PIPELINE_VERSION
from geo_pipeline.prepared_snapshot import publish_runtime_snapshot
from geo_pipeline.regional_snapshots import RUNTIME_DOMAINS, regional_snapshot_aoi
from geo_pipeline.runtime_osm import refresh_runtime_osm_domain


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare a checksum-validated MDQ regional snapshot."
    )
    parser.add_argument("snapshot_id", choices=["rybnik_35km"])
    parser.add_argument("--prepared-root", type=Path, required=True)
    parser.add_argument("--domain", action="append", choices=RUNTIME_DOMAINS)
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    root: Path = args.prepared_root.resolve()
    target = root / args.snapshot_id
    if args.rollback:
        return rollback(root, target)

    aoi = regional_snapshot_aoi(args.snapshot_id)
    domains = tuple(args.domain or RUNTIME_DOMAINS)
    backup_existing(root, target)
    outcomes = []
    for domain in domains:
        try:
            outcomes.append(
                refresh_runtime_osm_domain(aoi=aoi, domain=domain, root=root)
            )
        except Exception as error:  # noqa: BLE001 - publish a partial state with an explicit retry reason
            outcomes.append(
                {
                    "domain": domain,
                    "status": "failed",
                    "detail": f"Live acquisition failed: {error}. The domain remains retryable.",
                    "queried_feature_count": None,
                    "accepted_feature_count": None,
                    "derived_feature_count": None,
                    "preparation_duration_ms": None,
                    "overpass_endpoint": None,
                }
            )
    # Every ready pack validates within refresh_runtime_osm_domain; evidence is
    # atomically written before this compact manifest becomes visible.
    publish_runtime_snapshot(
        cache_root=root,
        resolved={"aoi": aoi, "pipeline_version": PIPELINE_VERSION},
        outcomes=outcomes,
        pipeline_version=PIPELINE_VERSION,
    )
    print(
        f"Published {args.snapshot_id} with {len(domains)} requested domains at {target}"
    )
    return 0


def backup_existing(root: Path, target: Path) -> None:
    if not target.is_dir():
        return
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup = root / "previous" / target.name / stamp
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(target, backup)
    print(f"Retained rollback copy: {backup}")


def rollback(root: Path, target: Path) -> int:
    previous_root = root / "previous" / target.name
    candidates = sorted(
        (path for path in previous_root.glob("*") if path.is_dir()), reverse=True
    )
    if not candidates:
        raise SystemExit(f"No rollback copy exists for {target.name}.")
    restore = candidates[0]
    failed = (
        root
        / "previous"
        / target.name
        / f"failed-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    )
    if target.exists():
        target.replace(failed)
    shutil.copytree(restore, target)
    print(f"Restored {target.name} from {restore}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
