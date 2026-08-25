# Map Data Provider — Reproducible delivery measurements

**Measurement contract:** `mdq_demo_delivery_measurement/v1`
**Scope:** the immutable, read-only `rybnik_35km` demo bundle

This document intentionally does not publish a fixed latency, cache-ratio or
viewport number. Those values depend on the verified bundle, host, CPU,
runtime and request path. A number is evidence only when its dated raw JSON is
committed with the revision, method and raw observations that produced it.

## What is measured

`pnpm run measure:demo` makes **100 sequential requests per endpoint** by
default and records nearest-rank p50, p95 and p99 latencies. The report also
contains:

- response status and transferred byte totals for `/api/health`, layer list,
  presentation list, readiness, a power domain pack and the nine-domain export;
- PMTiles `Range: bytes=0-16383` response sizes and status distribution;
- HTTP PMTiles revalidation hits: the archive is requested again with its
  `ETag`; `304 Not Modified` is counted as a hit and `206` as a miss;
- fixture worker preparation duration, per-domain processed feature count and
  success/failure rate;
- 100 warm runtime-cache lookups against temporary, fixture-built artifacts;
- runtime outcome totals for `ready`, `needs_source` and `failed`.

Every HTTP and warm-cache observation is retained in the JSON alongside its
aggregate. Percentiles can therefore be recomputed without rerunning the
bundle.

The production ordinary API endpoints are protected by a 240-request-per-minute
limit per client. `pnpm run demo:local` sets its local-only budget to 1,200 so a
default 100-sample run does not wait on this protection; the production Compose
configuration does not set that override. When testing an endpoint with the
ordinary production limit, the benchmark honours an HTTP `429` response and
its `Retry-After` header, waits, then repeats the same sample. That wait is not
included in the request latency percentile, and `methodology.rate_limit_retries`
records how often it occurred. PMTiles archive range requests do not consume
this ordinary API request budget.

The fixture-worker portion is deliberately isolated in a temporary directory.
It never modifies a demo bundle, the checked-in cache or VPS storage. It is a
deterministic pipeline measurement, not an Overpass/network acquisition
benchmark.

## Run a measurement

First prepare a current local copy of the immutable bundle and start the API:

```bash
./scripts/pull_local_demo_bundle.sh \
  root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km
pnpm run demo:local
```

In a second terminal, run:

```bash
pnpm run measure:demo
```

The command checks that the API is reachable at `http://127.0.0.1:3001` and
writes a dated raw report to:

```text
docs/measurements/YYYY-MM-DD-rybnik_35km-local.json
```

Do not replace an older report: a new date or a distinct suffix preserves the
historical evidence. Review the diff, then commit the JSON with the code and
bundle revision it measures. The command never stages or commits results on
the operator's behalf.

## Publish the evidence in the demo

The report records both `bundle_id` and a SHA-256 digest of the exact
`demo_bundle_manifest.json` used during measurement. First commit the
application and benchmark code, then run the measurement from that committed
revision; its `git_revision` will identify the code actually measured. Review
and commit the resulting JSON as a separate evidence-only commit, then deploy
both commits with the same external bundle. The production image copies
committed reports and exposes a compact summary at:

```text
GET /api/metrics/delivery
```

The full report is available at `GET /api/metrics/delivery/raw`. Both endpoints
return `404` when no report matches the manifest of the actively mounted
bundle. The MapLibre preview's **Delivery evidence** rail icon shows the same
summary and links to the raw JSON. This fail-closed match prevents a report
from a previous snapshot being presented as evidence for newly deployed data.

## Optional controls

```bash
# Measure a different locally reachable deployment.
MDQ_MEASURE_BASE_URL=https://maplab.robertlacheta.pl pnpm run measure:demo

# When measuring a remote deployment, explicitly select the exact local copy
# of the bundle served there.
MDQ_MEASURE_BUNDLE_MANIFEST=/absolute/path/to/rybnik_35km/demo_bundle_manifest.json \
  MDQ_MEASURE_BASE_URL=https://maplab.robertlacheta.pl pnpm run measure:demo

# Use a smaller diagnostic sample; this is not a portfolio baseline.
MDQ_MEASURE_SAMPLES=10 pnpm run measure:demo

# Write a report outside the repository while investigating.
MDQ_MEASURE_REPORT_DIR=/tmp/mdq-measurements pnpm run measure:demo
```

For a public deployment, run the command only against an endpoint and bundle
you are authorized to test. The tool makes read-only `GET` requests, but a
100-request sample per endpoint is still intentional load.

## Interpretation boundary

- `304` in the PMTiles revalidation section proves a conditional HTTP request
  was revalidated against the archive `ETag`; it does **not** claim a CDN or
  browser disk-cache hit.
- PMTiles bytes are bytes transferred by the tested API. They are not a claim
  about an entire MapLibre viewport, which can require several tile ranges.
- The worker data comes from deterministic fixtures and reports generated
  artifact feature counts. It must not be interpreted as live OSM coverage or
  live Overpass performance.
- Browser paint/settle time is intentionally out of scope until it is captured
  by a browser trace with a documented hardware and viewport setup.

## Portfolio wording after a report is committed

Once a dated report exists, the following statement is supportable with a link
to that report:

> Established reproducible API and PMTiles delivery metrics covering p50/p95
> latency, ETag revalidation ratio and PMTiles range payload size.

Do not claim a fixed p50/p95, cache ratio, worker throughput or viewport FPS
without linking the measurement JSON and stating its environment.
