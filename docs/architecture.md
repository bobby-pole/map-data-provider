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

This is the target consumer flow. The provider side is implemented in this repository; loading its export inside Steel Sentinel remains external integration work.

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

### Steel Sentinel GeoJSON Layer Contract v1

The primary provider output is a GeoJSON `FeatureCollection` with provider-owned metadata. Version 1 is `steel_sentinel_geojson/v1`; consumers integrate with the fields below rather than with raw Overpass or OSM tag conventions.

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "contract_version": "steel_sentinel_geojson/v1",
    "aoi_id": "rybnik_60km",
    "domain": "power",
    "layer_id": "power.lines",
    "source": "OpenStreetMap",
    "source_type": "analytical_vector",
    "snapshot_at": "2026-07-06T10:00:00Z",
    "feature_count": 16505,
    "readiness": "usable_with_limitations",
    "confidence": "medium",
    "limitations": ["OSM completeness varies by area and asset type."],
    "usable_for_simulation": true
  },
  "features": []
}
```

Each feature exposes these required provider-owned fields in `properties`:

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

Required root metadata is `contract_version`, `aoi_id`, `domain`, `layer_id`, `source`, `source_type`, `snapshot_at`, `feature_count`, `readiness`, `confidence`, `limitations` and `usable_for_simulation`. `snapshot_at` is an ISO-8601 timestamp with a timezone. `feature_count` must equal the number of GeoJSON features. `source_type` is one of `analytical_vector`, `manual_seed` or `reference_overlay`; `confidence` is one of `high`, `medium`, `low` or `not_applicable`; and readiness uses the documented provider vocabulary.

Required feature fields are `source`, `source_id`, `domain`, `asset_type`, `confidence`, `missing_fields`, `limitations` and `usable_for_simulation`. `source_id` is a stable provider identifier such as `way/32043840`; `asset_type` is a provider-normalized role such as `line`, not a raw-tag dependency. `missing_fields` is derived feature-level evidence, while limitations and simulation suitability are explicit provider assessments.

`osm_tags` is optional. It preserves useful source values such as `power`, `voltage`, `operator` or an original OSM `source` tag for inspection, but Steel Sentinel must not require it. A representative offline fixture lives at `backend/data/fixtures/rybnik_60km/power/contract-sample.geojson`; it is a contract sample, not the complete cache layout. `MDQ-004` introduces the canonical cache artifacts and metadata/readiness files.

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

### Data-quality rule and issue contract

Provider rules use version `1.0` and return one of `passed`, `triggered` or `not_applicable`. Applicability is explicit: analytical vectors are evaluated for empty output, invalid or unsupported geometry, missing required attributes, suspicious duplicates, source metadata and validation status; manual seeds receive geometry, empty-layer, source-metadata and manual-review rules; reference overlays receive only source-metadata and reference-only rules. A WMS/reference overlay is therefore never reported as an empty or invalid analytical GeoJSON layer.

| Rule ID | Applies to | Severity when triggered | Trigger |
| --- | --- | --- | --- |
| `layer.empty` | analytical vector, manual seed | high | Feature count is zero. |
| `geometry.invalid` | analytical vector, manual seed | high | Validation reports invalid geometries. |
| `attributes.missing_required` | analytical vector | medium | Required normalized attributes are missing. |
| `features.duplicates` | analytical vector | medium | Validation reports suspicious duplicate features. |
| `geometry.unsupported` | analytical vector, manual seed | medium | Unsupported geometry types are present. |
| `source.inconsistent` | every source type | high | Provider source metadata is invalid or inconsistent. |
| `validation.status` | analytical vector, manual seed | medium | Normalized validation status is not `passed`. |
| `manual.non_authoritative` | manual seed | medium | Non-empty manual review input is present. |
| `reference.overlay` | reference overlay | medium | Raster/reference-only overlay is present. |

Every triggered rule produces a source-aware issue:

```json
{
  "id": "DQ-POWER-HEXES-REGIONAL-QUALITY",
  "rule_id": "validation.status",
  "rule_version": "1.0",
  "severity": "medium",
  "source_type": "analytical_vector",
  "domain": "power",
  "layer_id": "power.hexes.regional",
  "affected_object": {"type": "layer", "id": "power.hexes.regional"},
  "evidence": "Validation report status: missing (normalized: unknown).",
  "recommendation": "Inspect validation evidence and document limitations before analytical use.",
  "status": "open"
}
```

`rule_id` and `rule_version` are stable machine-facing identifiers. Severity is `low`, `medium` or `high`; readiness consumes the highest applicable severity directly, never issue title or recommendation text. `status` remains the generated initial state. The Node review workflow stores the human decision separately and joins it only when AOI, issue ID, rule ID, rule version and layer ID still match.

`GET /api/aoi/:aoiId/issues` returns the generated evidence plus a review object. `PATCH /api/aoi/:aoiId/issues/:issueId/review` applies `open -> acknowledged -> resolved | accepted | ignored`, an optional note and optimistic concurrency through `expected_updated_at`. Invalid payloads or transitions return `422`; a stale update returns `409`. JSON replacement is atomic and writes are serialized in the local Node process. The MVP store is restart-safe but intentionally not a multi-instance database.

### Cache-first AOI/domain layout

The canonical analytical-vector cache is file based and keyed by AOI and domain:

```text
backend/data/cache/{aoi_id}/{domain}/
  layer.geojson
  metadata.json
  readiness.json
```

`layer.geojson` is the complete `steel_sentinel_geojson/v1` provider layer. `metadata.json` records the cache-layout and GeoJSON contract versions, AOI, domain, source query, snapshot timestamp, feature count, normalized validation status, confidence and limitations. `readiness.json` records the bounded readiness decision, quality status, highest applicable issue severity, count and evaluation timestamp. The initial committed snapshot is `rybnik_60km/power`, built from the existing OSM-derived power-lines artifact; it is read and validated locally without invoking Overpass extraction. Existing processed artifacts remain available to the FastAPI prototype during this migration.

`MDQ-019` adds an additive `domain-pack-v2/manifest.json` under the same AOI/domain root. `provider_domain_pack/v2` can retain multiple role-named processed or derived vector layers, native vector/raster artifacts, remote-service records, validation/readiness files and ordered source provenance. File artifacts are constrained to the pack root and validated for existence, SHA-256 integrity and GeoJSON feature counts. Public-export selection admits only artifacts whose source provenance is qualified, analytical and distributable under `source_registry/v2`; WMS/WMTS reference imagery and pending or rejected candidates remain in the pack as evidence but are excluded. The committed Rybnik power v2 pack is generated from the v1 snapshot, so existing v1 readers and Node routes remain compatible until the generic v2 API work.

`MDQ-020` defines `provider_aoi/v1` before generic adapter or API work. A bounded circle request records its EPSG:4326 boundary, source CRS, radius/area limits and request provenance; an approved administrative reference records its PRG identifier and offline fixture/snapshot provenance without claiming a live WFS read. The provider derives canonical AOI identity from normalized geometry, contract version and identity-relevant provenance. Cache paths accept only validated provider identifiers; `rybnik_60km` remains a compatibility alias and v1 cache key for the committed power snapshot while retaining its derived geometry identity.

## Source Registry and Attribution

`backend/data/sources/registry.json` is the portable `source_registry/v2` contract shared by Python, Node and later exports. Each record keeps independent `data_kind`, `format`, `authority`, `access_method`, `usage_role`, `qualification` and `distribution` fields, plus endpoint/reference, attribution, licence, availability caveats and limitations. This prevents an official source, a vector format and public access from being mistaken for the same property.

| Registered family | Data and format | Current role and public-export decision |
| --- | --- | --- |
| OpenStreetMap | vector / `osm_query` | Qualified free analytical evidence; public export is allowed with ODbL attribution. |
| Local manual seed | vector / `geojson` | Non-authoritative review input; excluded from analytical export. |
| PRG | vector / `wfs_gml` | Official candidate pending `MDQ-021` qualification; acquisition and export are prohibited. |
| BDOT10k | vector / `gpkg_geoparquet` | Official download candidate pending qualification; not treated as a direct feature WFS API. |
| KIUT/GESUT | rendered imagery / `wms` | Official reference-only overlay; rendered imagery is excluded from analytical GeoJSON and public export. |
| Geoportal orthophoto | rendered imagery / `wmts` | Pending reference candidate; imagery is excluded from object-vector export. |
| NMT/NMPT | raster / `geotiff_ascii_grid` | Pending analytical-raster candidate; it cannot be served by vector-only endpoints. |

Every analytical cache record references its registry ID and retains `source_url`, `source_query`, `snapshot_at`, `pipeline_version` and `query_version`. The existing `rybnik_60km/power` cache keeps its v1 provenance shape and resolves it through the v2 OpenStreetMap record. A later domain pack may retain ordered source-provenance records without merging source identities; a public export accepts only sources that are qualified free, analytical, non-rendered and explicitly allowed by their distribution policy.

KIUT/GESUT is an OGC WMS visual reference service. Its rendered images are not provider GeoJSON and must not be converted into analytical vectors or default simulation inputs. The provider does not redistribute WMS imagery; a future redistribution must retain GUGiK/KIUT attribution and verify the current service terms and metadata. The current Node `/sources` and v1 pack responses serialize the three legacy source classes during migration; generic v2 source and export responses belong to later tickets.

## Planned API

The Node/Express/TypeScript provider now serves typed, read-only local artifacts through `GET /api/health`, `GET /api/aoi/:aoiId/layers`, `GET /api/aoi/:aoiId/layers/:domain`, `GET /api/aoi/:aoiId/readiness` and `GET /api/aoi/:aoiId/sources`. These routes validate identifiers and file contracts, return 422 for malformed input and 404 for a missing cache, and do not invoke Python, Overpass or WMS.

`POST /api/aoi/requests` currently supports only `rybnik_60km/power`, whose registered boundary reference uses EPSG:4326. The provider treats a cache as fresh for 24 hours after `snapshot_at`; a missing or stale cache invokes the Python worker fixture path and returns whether the artifact came from cache or refresh.

`GET /api/aoi/:aoiId/exports/steel-sentinel-pack` returns `steel_sentinel_pack/v1`: the selected cached GeoJSON layer, cache metadata, readiness and the complete source registry in one read-only response. The pack preserves the `analytical_vector`, `manual_seed` and `reference_overlay` distinctions.

Implemented Node/Express provider endpoints:

- `GET /api/health`
- `POST /api/aoi/requests`
- `GET /api/aoi/:aoiId/layers`
- `GET /api/aoi/:aoiId/layers/:domain`
- `GET /api/aoi/:aoiId/readiness`
- `GET /api/aoi/:aoiId/sources`
- `GET /api/aoi/:aoiId/issues`
- `PATCH /api/aoi/:aoiId/issues/:issueId/review`
- `GET /api/aoi/:aoiId/exports/steel-sentinel-pack`

The first vertical slice is:

```text
AOI: rybnik_60km
Domain: power
Output: cached OSM-derived GeoJSON + metadata + readiness report
Consumer: Steel Sentinel
```

The current release implements the provider side of this slice: a cache-first Rybnik power request, one normalized OSM-derived power layer, source/readiness/issue contracts, durable review state, `steel_sentinel_pack/v1` export, dev-preview inspection and a shared local/CI verification gate. It does not claim a completed Steel Sentinel client. Consumer-side loading remains a separate repository task.

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
