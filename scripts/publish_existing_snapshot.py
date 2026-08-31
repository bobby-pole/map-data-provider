#!/usr/bin/env python3
"""Attach an immutable MDQ snapshot record to an existing prepared bundle."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from geo_pipeline.aoi import resolve_aoi
from geo_pipeline.aoi_runtime import PIPELINE_VERSION, PROFILES
from geo_pipeline.prepared_snapshot import publish_existing_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-root", type=Path, required=True)
    parser.add_argument("--aoi-id", choices=["rybnik_35km"], required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    resolved = resolve_aoi(args.aoi_id).as_dict()
    # The legacy alias resolves to a content-hash AOI ID; the portable bundle
    # directory and its public API identity are intentionally the named alias.
    resolved["aoi_id"] = args.aoi_id
    resolved["cache_key"] = args.aoi_id
    publish_existing_snapshot(
        cache_root=args.prepared_root.resolve(),
        aoi=resolved,
        snapshot_id=args.aoi_id,
        version=args.version,
        pipeline_version=PIPELINE_VERSION,
        domains=tuple(profile.domain for profile in PROFILES),
    )
    print(f"Published immutable snapshot record for {args.aoi_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
