# Map Data Quality Lab Architecture

## Decision

Map Data Quality Lab will be developed as a geospatial data provider for Steel Sentinel.

The selected architecture is:

- Node.js + Express + TypeScript for the provider API.
- Python for the geospatial extraction and validation worker.
- GeoJSON as the primary data contract between the provider and Steel Sentinel.
- Cached OSM-derived artifacts as the default read path for fast demos and repeatable results.
- WMS/KIUT/GESUT only as reference overlays, not analytical vectors.

## Rationale

The provider has two different jobs.

The service/API layer needs to expose stable REST contracts, validate requests, manage cache metadata, return GeoJSON quickly, provide readiness reports and integrate cleanly with Steel Sentinel and React tooling. Node.js, Express and TypeScript are a strong fit for REST services, cache orchestration, TypeScript contracts and frontend integration.

The geospatial processing layer needs to fetch OSM/Overpass data, parse and normalize tags, clip geometries to an AOI, validate geometry and attributes, and write GeoJSON/report artifacts. Python remains a better fit for this layer because OSMnx, GeoPandas, Shapely and PyProj provide mature geospatial processing tools.

This is not technology mixing for its own sake. The boundary is:

```text
Node is the product/service layer.
Python is the geospatial processing layer.
GeoJSON and JSON reports are the contract between them.
```

## Target Flow

```text
Steel Sentinel
  -> GET /api/aoi/{aoi_id}/layers/{domain}

Node/Express provider
  -> validates AOI/domain request
  -> checks cache metadata
  -> returns cached GeoJSON/readiness when available
  -> triggers Python worker when cache is missing or stale

Python geospatial worker
  -> fetches OSM/Overpass data
  -> normalizes features
  -> validates geometry and attributes
  -> writes GeoJSON, metadata and readiness reports

Node/Express provider
  -> serves the generated artifacts to Steel Sentinel
```

## Data Contract

The primary provider output is GeoJSON with explicit metadata.

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "aoi_id": "rybnik_60km",
    "domain": "power",
    "source": "osm",
    "snapshot_at": "2026-07-06T10:00:00Z",
    "feature_count": 16505,
    "readiness": "usable_with_limitations"
  },
  "features": []
}
```

Each feature should expose provider-owned fields in `properties`:

```json
{
  "source": "osm",
  "source_id": "way/123",
  "domain": "power",
  "asset_type": "line",
  "confidence": "medium",
  "missing_fields": ["voltage"],
  "limitations": ["OSM completeness varies by area"],
  "usable_for_simulation": true
}
```

### Layer catalog provenance metadata

Every catalog entry makes its source and simulation suitability explicit:

```json
{
  "source": "OpenStreetMap",
  "source_type": "analytical_vector",
  "confidence": "medium",
  "limitations": ["OSM completeness varies by area and asset type."],
  "not_authoritative": false,
  "usable_for_simulation": true
}
```

`source_type` is one of `analytical_vector`, `manual_seed` or `reference_overlay`. Confidence is a layer-level provider assessment (`high`, `medium`, `low` or `not_applicable`), not a claim of ground truth. `not_authoritative` is `true` for manual seeds and reference overlays. Manual seeds are never simulation inputs, and KIUT/GESUT WMS is catalogued as a `reference_overlay` with no GeoJSON artifact or validation report.

### Validation and readiness semantics

Provider validation statuses are normalized to `passed`, `warning`, `failed` or `unknown`. Readiness is derived separately as `ready`, `usable_with_limitations`, `needs_source` or `not_usable`.

- `ready` means the layer passed the current automated provider checks; it does not claim complete real-world coverage.
- `usable_with_limitations` keeps source or validation caveats visible, including non-authoritative manual seeds.
- `needs_source` means validation evidence or an analytical source is missing; reference-only WMS overlays fall in this category.
- `not_usable` means the artifact is empty or validation failed.

## Planned API

Initial Node/Express provider endpoints:

- `GET /api/health`
- `POST /api/aoi/requests`
- `GET /api/aoi/:aoiId/layers`
- `GET /api/aoi/:aoiId/layers/:domain`
- `GET /api/aoi/:aoiId/readiness`
- `GET /api/aoi/:aoiId/sources`
- `GET /api/aoi/:aoiId/exports/steel-sentinel-pack`

The first vertical slice is:

```text
AOI: rybnik_60km
Domain: power
Output: cached OSM-derived GeoJSON + metadata + readiness report
Consumer: Steel Sentinel
```

## Repository Plan

### Phase 1 - Stabilize Existing Provider Prototype

- Keep the current FastAPI implementation as a working prototype.
- Fix the Python smoke check dependency gap.
- Normalize validation statuses such as `pass` so readiness metrics are meaningful.
- Make source/confidence fields explicit in the existing catalog and data-quality outputs.

### Phase 2 - Define Contracts, Quality Rules and Cache

- Define provider-owned GeoJSON, metadata, readiness and issue schemas before implementing their public API.
- Define source-aware quality rules with stable identifiers, severity, evidence and applicability.
- Introduce a cache layout such as:

```text
backend/data/cache/{aoi_id}/{domain}/layer.geojson
backend/data/cache/{aoi_id}/{domain}/metadata.json
backend/data/cache/{aoi_id}/{domain}/readiness.json
```

- Record source query, attribution/license, snapshot timestamp, AOI, domain, feature count, pipeline/query version, validation status and known limitations.
- Prefer cached reads for downstream consumption.

### Phase 3 - Add Node/Express Provider API

- Add `backend-node/` with Express, TypeScript, Zod, test tooling and API routes.
- Implement read-only endpoints backed by the current cached GeoJSON/report artifacts.
- Add the source registry before exposing `/sources`.
- Add API tests for health, catalog/layers, readiness and export endpoints.

### Phase 4 - Connect Worker and Complete Provider Workflow

- Keep Python as a CLI/worker invoked by Node only when extraction or refresh is needed.
- Validate registered AOIs/domains and use explicit snapshot-freshness rules.
- Complete the cache-first request path and Steel Sentinel-compatible export.
- Verify the entire fixture-to-export pipeline without live Overpass.

### Phase 5 - Dev Preview and Issue Review

- Align the map preview with provider contracts and source metadata.
- Persist human review decisions separately from generated issue evidence.
- Support the issue lifecycle `open -> acknowledged -> resolved | accepted | ignored`.
- Keep the preview focused on data inspection rather than Steel Sentinel operational behavior.

### Phase 6 - Provider Release

- Run the Python, Node and frontend verification baseline locally and in CI.
- Publish provider setup, verification and integration documentation based only on implemented behavior.
- Treat Steel Sentinel consumer integration as external follow-up work after this release.

### Phase 7 - Evidence-Driven Scale Options

- Add a job queue when direct CLI invocation becomes too limiting.
- Add SQLite/PostGIS for metadata and larger AOI management if file cache becomes awkward.
- Add vector tile export when GeoJSON becomes too heavy for large map rendering.
- Keep WMS reference overlays separate from analytical vector data.

## Non-Goals

- Do not move Steel Sentinel C2, RAG, attack simulation or operator UI into this repo.
- Do not treat KIUT/GESUT WMS as analytical vector data.
- Do not rewrite the geospatial worker in Node just to use one language.
- Do not build vector tiles before the GeoJSON/cache provider contract is stable.

## Engineering Characteristics

This architecture provides:

- A Node.js/Express/TypeScript service boundary.
- REST APIs and TypeScript-friendly contracts.
- A React-compatible map data provider.
- OSM/GeoJSON ingestion and normalization.
- Source attribution, confidence and readiness metrics.
- Separation of service orchestration from geospatial processing.
- Explicit separation of raster reference overlays from analytical vector data.
