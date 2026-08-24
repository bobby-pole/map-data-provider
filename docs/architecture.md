# Map Data Quality Lab Architecture

## Decision

Map Data Quality Lab is developed as a consumer-neutral geospatial data provider.

The selected architecture is:

- Node.js + Express + TypeScript for the provider API.
- Python for the geospatial extraction and validation worker.
- GeoJSON as the primary data contract between the provider and GIS consumers.
- MVT packaged in PMTiles as a derived, offline-first map presentation read model.
- Cached OSM-derived artifacts as the default read path for fast demos and repeatable results.
- WMS/KIUT/GESUT only as reference overlays, not analytical vectors.

## Rationale

The provider has two different jobs.

The service/API layer needs to expose stable REST contracts, validate requests, manage cache metadata, return GeoJSON quickly, provide readiness reports and integrate cleanly with GIS consumers and React tooling. Node.js, Express and TypeScript are a strong fit for REST services, cache orchestration, TypeScript contracts and frontend integration.

The geospatial processing layer needs to fetch OSM/Overpass data, parse and normalize tags, clip geometries to an AOI, validate geometry and attributes, and write GeoJSON/report artifacts. Python remains a better fit for this layer because OSMnx, GeoPandas, Shapely and PyProj provide mature geospatial processing tools.

This is not technology mixing for its own sake. The boundary is:

```text
Node is the product/service layer.
Python is the geospatial processing layer.
GeoJSON and JSON reports are the contract between them.
```

The map preview has a separate, deliberately narrower read model. Python derives MVT only from manifest-approved public analytical GeoJSON and packages it into a versioned PMTiles archive. Node serves compact presentation metadata and archive byte ranges; MapLibre renders only requested tiles. An optional default-on OpenStreetMap raster base map supplies online visual context, but it is not provider data, not cached and not an offline dependency. This does not replace canonical GeoJSON exports or introduce a spatial database, a BBOX query API or live tile generation.

## Target Flow

This is the target consumer flow. The provider side is implemented in this repository; loading its export inside a consumer remains external integration work.

```text
GIS consumer
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
  -> serves the generated artifacts to the consumer
```

## Data Contract

### Provider GeoJSON Layer Contract v1

The primary provider output is a GeoJSON `FeatureCollection` with provider-owned metadata. Version 1 is `provider_geojson/v1`; consumers integrate with the fields below rather than with raw Overpass or OSM tag conventions.

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "contract_version": "provider_geojson/v1",
    "aoi_id": "rybnik_35km",
    "domain": "power",
    "layer_id": "power.lines",
    "source": "OpenStreetMap",
    "source_type": "analytical_vector",
    "snapshot_at": "2026-07-06T10:00:00Z",
    "feature_count": 16505,
    "readiness": "usable_with_limitations",
    "confidence": "medium",
    "limitations": ["OSM completeness varies by area and asset type."]
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
  "limitations": ["OSM completeness varies by area"]
}
```

`osm_tags` is optional. It preserves useful source values such as `power`, `voltage`, `operator` or an original OSM `source` tag for inspection, but consumers must not require it. A representative offline fixture lives at `backend/data/fixtures/rybnik_35km/power/contract-sample.geojson`; it is a contract sample, not the complete cache layout. The provider also publishes canonical cache artifacts together with metadata and readiness files.

### Layer catalog provenance metadata

Every catalog entry makes its source and analytical eligibility explicit:

```json
{
  "source": "OpenStreetMap",
  "source_type": "analytical_vector",
  "confidence": "medium",
  "limitations": ["OSM completeness varies by area and asset type."],
  "not_authoritative": false
}
```

`source_type` is one of `analytical_vector`, `manual_seed` or `reference_overlay`. Confidence is a layer-level provider assessment (`high`, `medium`, `low` or `not_applicable`), not a claim of ground truth. `not_authoritative` is `true` for manual seeds and reference overlays. Manual seeds are never analytical inputs, and KIUT/GESUT WMS is catalogued as a `reference_overlay` with no GeoJSON artifact or validation report.

### Validation and readiness semantics

Provider validation statuses are normalized to `passed`, `warning`, `failed` or `unknown`. Readiness is derived separately as `ready`, `usable_with_limitations`, `needs_source` or `not_usable`.

- `ready` means the layer passed the current automated provider checks; it does not claim complete real-world coverage.
- `usable_with_limitations` keeps source or validation caveats visible, including non-authoritative manual seeds.
- `needs_source` means validation evidence or an analytical source is missing; reference-only WMS overlays fall in this category.
- `not_usable` means the artifact is empty or validation failed.

### Data-quality rule and issue contract

Provider rules use version `1.0` and return one of `passed`, `triggered` or `not_applicable`. Applicability is explicit: analytical vectors are evaluated for empty output, invalid or unsupported geometry, missing required attributes, suspicious duplicates, source metadata and validation status; manual seeds receive geometry, empty-layer, source-metadata and manual-review rules; reference overlays receive only source-metadata and reference-only rules. A WMS/reference overlay is therefore never reported as an empty or invalid analytical GeoJSON layer.

| Rule ID                       | Applies to                     | Severity when triggered | Trigger                                              |
| ----------------------------- | ------------------------------ | ----------------------- | ---------------------------------------------------- |
| `layer.empty`                 | analytical vector, manual seed | high                    | Feature count is zero.                               |
| `geometry.invalid`            | analytical vector, manual seed | high                    | Validation reports invalid geometries.               |
| `attributes.missing_required` | analytical vector              | medium                  | Required normalized attributes are missing.          |
| `features.duplicates`         | analytical vector              | medium                  | Validation reports suspicious duplicate features.    |
| `geometry.unsupported`        | analytical vector, manual seed | medium                  | Unsupported geometry types are present.              |
| `source.inconsistent`         | every source type              | high                    | Provider source metadata is invalid or inconsistent. |
| `validation.status`           | analytical vector, manual seed | medium                  | Normalized validation status is not `passed`.        |
| `manual.non_authoritative`    | manual seed                    | medium                  | Non-empty manual review input is present.            |
| `reference.overlay`           | reference overlay              | medium                  | Raster/reference-only overlay is present.            |

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
  "affected_object": { "type": "layer", "id": "power.hexes.regional" },
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

`layer.geojson` is the complete `provider_geojson/v1` provider layer. `metadata.json` records the cache-layout and GeoJSON contract versions, AOI, domain, source query, snapshot timestamp, feature count, normalized validation status, confidence and limitations. `readiness.json` records the bounded readiness decision, quality status, highest applicable issue severity, count and evaluation timestamp. The initial committed snapshot is `rybnik_35km/power`, built from the existing OSM-derived power-lines artifact; it is read and validated locally without invoking Overpass extraction. Legacy prototype endpoints have been fully retired in favor of the unified Node API.

### Domain packs, map presentations and runtime

The `provider_domain_pack/v2` manifest stores role-named processed and derived
vector layers, native artifacts, remote-service records, validation/readiness
files and ordered source provenance. Pack-relative paths, SHA-256 integrity and
feature counts are validated before a layer is exposed. Public export admits
only qualified, analytical and distributable vector provenance; WMS/WMTS
references, pending candidates and rejected material remain evidence rather
than public analytical data.

The `provider_map_presentation/v1` manifest describes a checked PMTiles archive
derived from public domain-pack layers. It records the parent-manifest digest,
archive integrity, bounds, zoom range, compact layer descriptors, attribution
and source provenance. The archive is a read-optimized render derivative, not a
replacement for the source pack or the public GeoJSON export. The current
`rybnik_35km` preview includes the required provider domains and keeps support,
inspection-point and source-detail behavior bounded by their delivered
contracts.

The provider currently supports nine required domain profiles and optional
`telecom` and `district_heating` profiles. Each profile uses explicit source
semantics; an absent qualified network remains a visible `needs_source` state.
OSM-derived analytical vectors, PRG/BDOT10k context, manual evidence and KIUT
reference overlays retain separate provenance and are never silently merged or
vectorized from WMS imagery.

AOI requests use `provider_aoi_request/v2` for a bounded point/radius or a
source-labelled administrative selection. The runtime derives a deterministic
request identity, coalesces equivalent local requests, reuses a fresh result for
24 hours, and preserves the previous published state when preparation fails.
Cache misses use the separately governed OSM/Overpass acquisition profiles,
validate an atomic domain pack and derive the PMTiles presentation. Committed
Rybnik artifacts remain deterministic demo fallbacks, while live acquisition is
limited to the runtime-request path.

The Python worker resolves the approved AOI/domain adapter and versioned query
catalog before staging the compatibility cache and domain pack. Publication is
atomic, and the Node API exposes only validated artifacts and manifests.

## Source Registry and Attribution

`backend/data/sources/registry.json` is the portable `source_registry/v2` contract shared by Python, Node and later exports. Each record keeps independent `data_kind`, `format`, `authority`, `access_method`, `usage_role`, `qualification` and `distribution` fields, plus endpoint/reference, attribution, licence, availability caveats and limitations. This prevents an official source, a vector format and public access from being mistaken for the same property.

| Registered family    | Data and format               | Current role and public-export decision                                                                          |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap        | vector / `osm_query`          | Qualified free analytical evidence; public export is allowed with ODbL attribution.                              |
| Local manual seed    | vector / `geojson`            | Non-authoritative review input; excluded from analytical export.                                                 |
| PRG                  | vector / `wfs_gml`            | Qualified free official boundary/address vector; WFS/GML is distinct from its viewing WMS.                       |
| BDOT10k              | vector / `gpkg_geoparquet`    | Qualified free official package download; WMS GetFeatureInfo discovers packages and is not a direct feature API. |
| KIUT/GESUT           | rendered imagery / `wms`      | Official reference-only overlay; rendered imagery is excluded from analytical GeoJSON and public export.         |
| Geoportal orthophoto | rendered imagery / `wms`      | Qualified free visual reference; imagery remains excluded from object-vector export.                             |
| NMT/NMPT             | raster / `geotiff_ascii_grid` | Qualified free raster input for later bounded derived products; it cannot be served by vector-only endpoints.    |

Every analytical cache record references its registry ID and retains `source_url`, `source_query`, `snapshot_at`, `pipeline_version` and `query_version`. The existing `rybnik_35km/power` cache keeps its v1 provenance shape and resolves it through the v2 OpenStreetMap record. Before a source is acquired, locally imported, processed analytically or exported, the provider evaluates that requested use against the registry. Only qualified free sources pass acquisition/import; analytical processing also requires an analytical, analysis-eligible non-rendered source; public export additionally requires explicit distribution permission. Free registration is not a rejection by itself. Reference-only records are allowed for reference use, reported as not comparable for analytical comparison, and rejected for analytical processing or public export. A later domain pack may retain ordered source-provenance records without merging source identities.

KIUT/GESUT is an OGC WMS visual reference service. Its rendered images are not provider GeoJSON and must not be converted into analytical vectors or default analytical inputs. The provider does not redistribute WMS imagery; a future redistribution must retain GUGiK/KIUT attribution and verify the current service terms and metadata. The current Node `/sources` and v1 pack responses serialize the three legacy source classes during migration. Generic v2 reads and exports return only source records actually used by public analytical artifacts.

`backend/data/sources/source_strategy.json` is the dated `source_strategy/v1` decision matrix. It maps every planned domain to adopted analytical evidence and reference-only context, or records a visible source gap. It assigns PRG to administrative AOI/boundary work, BDOT10k to bounded topographic classes, KIUT to utility coverage/visual reference, orthophoto to visual reference and NMT/NMPT to later explicitly defined raster-derived context. It does not authorize adapters or convert WMS/WMTS imagery into vectors.

The fixture-first `prg_adapter/v1` uses the allow-listed PRG WFS 2.0 feature types `A01`–`A03` for voivodeship, county and gmina boundaries, and `K01`–`K07` for selected police and fire classes. It preserves raw GML evidence, original feature IDs and EPSG:2180 metadata while normalizing output to EPSG:4326 GeoJSON. A non-boundary police/fire geometry is clipped to the selected AOI but never reclassified as OSM data or assumed to be a building point. Capabilities/schema drift, empty results and unavailable service responses remain structured source outcomes; offline verification reads only committed fixtures.

The fixture-first `bdot10k_adapter/v1` imports a preselected official 2021-schema GPKG or GeoParquet class artifact; it never treats the BDOT10k package-discovery WMS as a vector feature API. Its narrow allow-list maps `OT_SKDR_L` to transport, `OT_BUIN_L` to bridge context, `OT_SWRS_L` to water context, `OT_BUBD_A` to building context, and `OT_KUPG_A`/`OT_KUPG_P` to industrial context. Readers request only identity/context columns and a source-CRS AOI bound before a second EPSG:4326 clip. Output preserves the `idIIP` identifier, source class, EPSG:2180, artifact SHA-256, dated snapshot, GUGiK attribution and limitations. A missing class/identifier/CRS, incompatible geometry or digest mismatch is explicit schema/artifact drift, not an empty ready layer. The committed fixtures are bounded contract evidence, not a national-data snapshot or a facility-semantics claim.

The fixture-first `kiut_wms_adapter/v1` parses a dated KIUT WMS capabilities snapshot to expose only safe reference descriptors for electricity, water, gas, sewer, telecom and district-heating layers. It accepts a fixed GUGiK endpoint and allow-listed layer names, reports `available_reference`, `unsupported_scale`, `uncovered` or `service_unavailable`, and builds fixed-parameter GetMap/legend URLs for a preview. It records the `gesut` published extent as possible coverage only: it does not prove local utility completeness. KIUT imagery is never cached as an analytical artifact, converted into GeoJSON, used for default analysis or publicly exported.

The fixture-first `geoportal_orthophoto_wms_adapter/v1` parses the fixed high-resolution Geoportal WMS 1.3.0 `Raster` layer for an optional preview background. It reports `available_reference`, `uncovered` or `service_unavailable`, restricts GetMap URLs to the fixed official endpoint and layer, and records published coverage plus explicit `not_published` image-date and resolution states when WMS capabilities do not provide them. Orthophoto remains rendered reference imagery: it is not cached, object-vectorized, analytically processed or included in public exports.

The fixture-first `nmt_nmpt_raster_adapter/v1` accepts a bounded NMT/NMPT ASCII Grid as native raster evidence in EPSG:2180. It retains native and AOI-processed checksums, validates CRS, cell resolution, nodata and AOI coverage, and converts only AOI geometry to source CRS before clipping; it does not resample raster values. Its single derived-vector product, `terrain_sample_points/v1`, emits labelled cell-centre elevation context with `cell_centroid/v1` provenance and never claims flood risk or object semantics. Native rasters are cache-only artifacts and cannot be marked for public export or served through vector-only reads.

`provider_source_availability/v1` is a dated, cache-only AOI report. It separates availability, AOI coverage, feature state, freshness, eligibility and actionable source gaps for every registered source; empty, unavailable, uncovered, reference-only and not-eligible states are never inferred from a message. The Node read endpoint and preview consume the committed report only. Optional diagnostics are explicit wrappers that fail safely and are never reached by cached reads or the offline verification gate.

`cross_source_comparison/v1` records deterministic comparison evidence without conflating features. The initial power rule prefers a shared stable source ID, otherwise uses a bounded geometry distance only when both eligible analytical vectors expose the same comparable asset type; an absent candidate is explicitly `source_only`. It emits `matched`, `conflicting`, `source_only`, `ambiguous` or `not_comparable` with rule/version evidence and preserved source/feature identifiers. Reference WMS, manual review and rejected sources are explicitly not comparable; disagreement is not a claim that either source is wrong. The validation boundary turns only conflict, source-only and ambiguity outcomes into structured quality issues; readiness consumes those enums directly and reduces the result to `usable_with_limitations`, while a matched or not-comparable result alone does not invent a problem.

## API and runtime boundary

The Node/Express/TypeScript provider now serves typed, read-only local artifacts through `GET /api/health`, `GET /api/aoi/:aoiId/layers`, `GET /api/aoi/:aoiId/layers/:domain`, `GET /api/aoi/:aoiId/readiness` and `GET /api/aoi/:aoiId/sources`. These routes validate identifiers and file contracts, return 422 for malformed input and 404 for a missing cache, and do not invoke Python, Overpass or WMS.

`POST /api/aoi/requests` remains the legacy compatibility path for
`rybnik_35km/power`, whose registered boundary reference uses EPSG:4326. The
provider treats a cache as fresh for 24 hours after `snapshot_at`; a missing or
stale cache invokes the Python worker fixture path and returns whether the
artifact came from cache or refresh. Live OSM/Overpass acquisition belongs to
the separate `POST /api/aoi/runtime-requests` path.

`GET /api/aoi/catalog` returns the bounded offline PRG administrative selection catalogue. `POST /api/aoi/runtime-requests` validates `provider_aoi_request/v2`, then calls the local runtime worker only after validation. A cache miss for any required profile or optional `telecom` makes a bounded live OSM/Overpass request, then publishes a validated local domain pack and PMTiles presentation; it makes no WMS or raster request. Telecom accepts only explicit OSM communication semantics and preserves an empty line layer as `needs_source`. Other profiles remain typed source gaps until their separately governed adapters are complete.

`GET /api/aoi/:aoiId/domain-packs` and `GET /api/aoi/:aoiId/domain-packs/:domain` provide read-only `provider_domain_pack_read/v2` responses from registered manifests. Node validates request and manifest identity, pack-relative paths, source provenance, SHA-256 checksums, feature counts and provider GeoJSON metadata before returning any layer. The response exposes only explicitly public processed, derived or representative-point GeoJSON vectors. Native artifacts, rasters, remote services and reference-only records remain inside the cache as provenance evidence and cannot enter an analytical endpoint.

`GET /api/aoi/:aoiId/export` provides a consolidated multi-domain export payload conforming to `provider_multi_domain_export/v2`. The route accepts a mandatory `domains` parameter (e.g., `GET /api/aoi/:aoiId/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial`), validates requested domains against an allow-list of profiles, rejects empty domain segments with HTTP 422 `invalid_request`, deduplicates requested profiles, and attaches explicit per-domain outcomes (`ready` vs `needs_source`), public GeoJSON domain packs, and relevant reviewed issues filtered by requested domains.

`GET /api/aoi/:aoiId/presentations` and `GET /api/aoi/:aoiId/presentations/:domain` provide compact `provider_map_presentation_read/v1` metadata without reading or serializing analytical GeoJSON collections. `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId` returns one validated source-detail feature and its allow-listed attributes; it validates an OSM `node`, `way` or `relation` ID and never returns an entire layer. `GET /api/aoi/:aoiId/presentations/:domain/archive` requires one satisfiable HTTP byte range and responds with checked PMTiles bytes, an ETag and `Content-Range`. Node validates presentation identity, parent-manifest digest, public-source provenance, archive size and SHA-256 before serving it. These routes are read-only and never invoke Python, Overpass, WMS or a tile generator.

Implemented Node/Express provider endpoints:

- `GET /api/health`
- `POST /api/aoi/requests`
- `GET /api/aoi/:aoiId/layers`
- `GET /api/aoi/:aoiId/layers/:domain`
- `GET /api/aoi/:aoiId/readiness`
- `GET /api/aoi/:aoiId/sources`
- `GET /api/aoi/:aoiId/issues`
- `PATCH /api/aoi/:aoiId/issues/:issueId/review`
- `GET /api/aoi/:aoiId/domain-packs`
- `GET /api/aoi/:aoiId/domain-packs/:domain`
- `GET /api/aoi/:aoiId/export`
- `GET /api/aoi/:aoiId/presentations`
- `GET /api/aoi/:aoiId/presentations/:domain`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId`
- `GET /api/aoi/:aoiId/presentations/:domain/archive` (HTTP range only)

The first vertical slice is:

```text
AOI: rybnik_35km
Domain: power
Output: public OSM power-line and power-asset GeoJSON, private source/representative evidence, validation/readiness and KIUT reference provenance
Consumer: GIS consumer
```

The current release implements the provider side of all 9 required domain slices (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`): cache-first requests, source/readiness/issue contracts, durable review state, bounded multi-artifact domain packs, manifest-driven v2 reads/exports, and `provider_multi_domain_export/v2` consolidation. The MapLibre dev-preview derives its layer toggles, counts, domain-specific styling, attribution and limitations from compact presentation metadata, resolves one selected feature into its validated source detail, and reads public MVT from local PMTiles ranges; KIUT remains a separate external reference-only overlay. The preview is a non-operational provider inspection tool. Consumer-side loading remains a separate repository task.

## Delivery boundary and future options

The implemented delivery is a cache-first, source-aware provider: Python owns
geospatial acquisition and validation, Node owns typed read/API orchestration,
and the frontend reads the checked PMTiles presentation while retaining source
and readiness context. The repository does not claim consumer-side Steel
Sentinel integration.

Future infrastructure choices remain evidence-driven. A job queue, SQLite or
PostGIS, and additional server-side spatial-query capabilities should be added
only when measured AOI volume, concurrency, cache management or product needs
exceed the current file-cache and local-runtime boundary.

## Non-Goals

- Do not move C2, RAG, attack simulation or operator UI into this repo.
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
