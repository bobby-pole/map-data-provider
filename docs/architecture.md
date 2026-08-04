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
}
```



`osm_tags` is optional. It preserves useful source values such as `power`, `voltage`, `operator` or an original OSM `source` tag for inspection, but consumers must not require it. A representative offline fixture lives at `backend/data/fixtures/rybnik_60km/power/contract-sample.geojson`; it is a contract sample, not the complete cache layout. `MDQ-004` introduces the canonical cache artifacts and metadata/readiness files.

### Layer catalog provenance metadata

Every catalog entry makes its source and analytical eligibility explicit:

```json
{
  "source": "OpenStreetMap",
  "source_type": "analytical_vector",
  "confidence": "medium",
  "limitations": ["OSM completeness varies by area and asset type."],
  "not_authoritative": false,
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

`layer.geojson` is the complete `provider_geojson/v1` provider layer. `metadata.json` records the cache-layout and GeoJSON contract versions, AOI, domain, source query, snapshot timestamp, feature count, normalized validation status, confidence and limitations. `readiness.json` records the bounded readiness decision, quality status, highest applicable issue severity, count and evaluation timestamp. The initial committed snapshot is `rybnik_60km/power`, built from the existing OSM-derived power-lines artifact; it is read and validated locally without invoking Overpass extraction. Existing processed artifacts remain available to the FastAPI prototype during this migration.

`MDQ-019` adds an additive `domain-pack-v2/manifest.json` under the same AOI/domain root. `provider_domain_pack/v2` can retain multiple role-named processed or derived vector layers, native vector/raster artifacts, remote-service records, validation/readiness files and ordered source provenance. File artifacts are constrained to the pack root and validated for existence, SHA-256 integrity and GeoJSON feature counts. Public-export selection admits only artifacts whose source provenance is qualified, analytical and distributable under `source_registry/v2`; WMS/WMTS reference imagery and pending or rejected candidates remain in the pack as evidence but are excluded. `MDQ-032` completes the committed Rybnik power pack with public OSM `power.lines` and `power.assets` layers, private dated OSM source evidence and line representative points, plus a private KIUT electricity `remote_service` record. KIUT cannot enter a public analytical artifact; the existing v1 cache remains compatible while the manifest is the generic v2 read source.

`MDQ-047` adds `presentation/manifest.json`, `presentation/benchmark.json` and a version-3 PMTiles archive below the same domain-pack root. `provider_map_presentation/v1` records the parent domain-manifest digest, archive SHA-256/size/bounds/zoom range, compact layer descriptors, attribution, source provenance and the measured full-GeoJSON baseline. Generation checks every public input checksum and source-eligibility record before writing tiles; private evidence, manual/review material, WMS/raster references and non-exportable sources cannot enter the archive. The archive is a render derivative, not a replacement source or public GeoJSON export.

`MDQ-048` adds a public `power.supports` OSM vector layer from a bounded committed source fixture. Its source tag allow-list preserves only map-inspection fields: power/class, identity and operator, voltage, frequency, circuit/conductor, location/design, and explicitly named equipment fields. The presentation keeps compact selection properties only; the source-detail route resolves one validated record by stable OSM source ID from the canonical public artifact. Lines receive deterministic low, medium, high, extra-high, multiple, missing or unparseable voltage states. Tiles for `tower`, `portal` and `utility_pole` start at zoom 12; ordinary `pole` tiles start at zoom 14. The fixture does not establish exhaustive AOI support coverage or electrical topology.

`MDQ-033` adds the fixture-first `rybnik_60km/emergency` vertical slice. It publishes separate OSM `hospital`, `fire_service`, `police` and `ambulance_rescue` artifacts using only explicit source tags; OSM areas retain their original geometry and a derived inspection-point artifact. Supplementary PRG `K02` police and `K07` fire records are published only as source-labelled representative points because their source geometry is an official unit area rather than a verified facility footprint. PRG and OSM IDs, provenance, attribution and limitations remain distinct; no matching, deduplication or facility-location inference occurs. The generic Node feature-detail route accepts valid provider IDs, while circuit endpoints remain power/OSM-specific. The PMTiles read model includes all public processed, derived and representative-vector artifacts, and the generic MapLibre renderer supports point and polygon inspection. No qualified official hospital or ambulance/rescue registry is enabled; OSM evidence remains visible with that gap explicitly recorded.

`MDQ-034` adds the fixture-first `rybnik_60km/public` vertical slice. It publishes independent OSM `administration`, `education`, `post` and `community_social` artifacts only from explicit allow-listed amenity/office semantics. A building footprint, address or spatial proximity cannot create a facility. Original polygons remain unchanged and receive linked representative inspection points. BDOT10k is retained only as labelled topographic context; the lack of a qualified PRG facility class is a visible source gap. Candidate comparison evidence remains private and ambiguous rather than causing geometry fusion, source deletion or a winner selection. The existing bounded runtime OSM path now serves the same `public-osm/v1` profile for a selected AOI.

`MDQ-035` adds the fixture-first `rybnik_60km/transport` vertical slice. It publishes independent OSM `roads`, `railways`, `stations` and `aviation` artifacts only from explicit allow-listed highway, railway and aeroway semantics. Provider-normalized classes do not depend on raw OSM or BDOT codes in client components. Non-point geometries receive linked representative inspection points. BDOT10k road and railway lines remain labelled topographic context; the lack of a qualified PRG transport network or facility class is an explicit source gap. Candidate comparison evidence remains private and ambiguous without silent conflation, geometry fusion, or source deletion. The existing bounded runtime OSM path now serves the same `transport-osm/v3` profile for a selected AOI.

`MDQ-053` closes the live runtime vertical slice for transport and introduces on-demand line inspection. `geo_pipeline/runtime/v5` and `transport-osm/v3` ensure a cache entry created for the older major-road-only profile or an MVT payload without `road_class` cannot be reused. Road features are categorized into `major`, `secondary`, `local` and `service` classes while preserving raw `highway` tags. In the MapLibre preview, transport line networks (`roads`, `railways`) and representative points are hidden by default; once roads are intentionally enabled, each class has its own filter and `service` remains off by default. Zoom level guidance (zoom < 11) and a persistent numeric zoom indicator make the rendering threshold explicit. Selecting a road or railway feature highlights its exact original LineString geometry, displays source attributes, and marks verified start/end coordinates without claiming network routing or connectivity.

`MDQ-020` defines `provider_aoi/v1` before generic adapter or API work. A bounded circle request records its EPSG:4326 boundary, source CRS, radius/area limits and request provenance; an approved administrative reference records its PRG identifier and offline fixture/snapshot provenance without claiming a live WFS read. The provider derives canonical AOI identity from normalized geometry, contract version and identity-relevant provenance. Cache paths accept only validated provider identifiers; `rybnik_60km` remains a compatibility alias and v1 cache key for the committed power snapshot while retaining its derived geometry identity.

`MDQ-051` adds `provider_aoi_request/v2` above that stable v1 compatibility contract. The MapLibre settings panel accepts either a point/radius contained within Poland or a deterministic union of source-labelled units from the bounded PRG administrative catalogue. A request identity includes normalized true AOI geometry, PRG catalogue version/snapshot and unit IDs where relevant, ordered category/query versions and the pipeline version. The local runtime coalesces equivalent in-progress Node requests and caches a complete validated result for 24 hours below ignored `backend/cache/`; a failed run never replaces prior state. On a cache miss, qualified OSM `power`, `emergency`, `public` and completed `transport` profiles acquire only the resolved true AOI, normalize and clip their vectors, validate an atomic local domain pack and derive PMTiles for the preview. Each remaining required OSM category has an explicit source-gap outcome until its domain ticket completes. Existing `rybnik_60km` artifacts remain deterministic demo fallbacks. BDOT10k is labelled topographic context, PRG is official administrative context, KIUT/orthophoto stay reference-only and NMT/NMPT remains raster-derived context. None enters an analytical-vector artifact through the runtime.

`MDQ-022` introduces a Python adapter catalog and versioned OSM query catalog. The worker resolves an approved AOI/domain adapter before creating paths, returns its source registry ID and query version, and stages the v1 compatibility cache with its v2 domain pack before atomic replacement. Registered fixture adapters are `rybnik_60km/power`, `rybnik_60km/emergency`, `rybnik_60km/public` and `rybnik_60km/transport`; each live acquisition path remains separately governed and the public fixture adapter directs selected-AOI acquisition through the bounded runtime contract.

## Source Registry and Attribution

`backend/data/sources/registry.json` is the portable `source_registry/v2` contract shared by Python, Node and later exports. Each record keeps independent `data_kind`, `format`, `authority`, `access_method`, `usage_role`, `qualification` and `distribution` fields, plus endpoint/reference, attribution, licence, availability caveats and limitations. This prevents an official source, a vector format and public access from being mistaken for the same property.

| Registered family | Data and format | Current role and public-export decision |
| --- | --- | --- |
| OpenStreetMap | vector / `osm_query` | Qualified free analytical evidence; public export is allowed with ODbL attribution. |
| Local manual seed | vector / `geojson` | Non-authoritative review input; excluded from analytical export. |
| PRG | vector / `wfs_gml` | Qualified free official boundary/address vector; WFS/GML is distinct from its viewing WMS. |
| BDOT10k | vector / `gpkg_geoparquet` | Qualified free official package download; WMS GetFeatureInfo discovers packages and is not a direct feature API. |
| KIUT/GESUT | rendered imagery / `wms` | Official reference-only overlay; rendered imagery is excluded from analytical GeoJSON and public export. |
| Geoportal orthophoto | rendered imagery / `wms` | Qualified free visual reference; imagery remains excluded from object-vector export. |
| NMT/NMPT | raster / `geotiff_ascii_grid` | Qualified free raster input for later bounded derived products; it cannot be served by vector-only endpoints. |

Every analytical cache record references its registry ID and retains `source_url`, `source_query`, `snapshot_at`, `pipeline_version` and `query_version`. The existing `rybnik_60km/power` cache keeps its v1 provenance shape and resolves it through the v2 OpenStreetMap record. Before a source is acquired, locally imported, processed analytically or exported, the provider evaluates that requested use against the registry. Only qualified free sources pass acquisition/import; analytical processing also requires an analytical, analysis-eligible non-rendered source; public export additionally requires explicit distribution permission. Free registration is not a rejection by itself. Reference-only records are allowed for reference use, reported as not comparable for analytical comparison, and rejected for analytical processing or public export. A later domain pack may retain ordered source-provenance records without merging source identities.

KIUT/GESUT is an OGC WMS visual reference service. Its rendered images are not provider GeoJSON and must not be converted into analytical vectors or default analytical inputs. The provider does not redistribute WMS imagery; a future redistribution must retain GUGiK/KIUT attribution and verify the current service terms and metadata. The current Node `/sources` and v1 pack responses serialize the three legacy source classes during migration. Generic v2 reads and exports return only source records actually used by public analytical artifacts.

`backend/data/sources/source_strategy.json` is the dated `source_strategy/v1` decision matrix. It maps every planned domain to adopted analytical evidence and reference-only context, or records a visible source gap. It assigns PRG to administrative AOI/boundary work, BDOT10k to bounded topographic classes, KIUT to utility coverage/visual reference, orthophoto to visual reference and NMT/NMPT to later explicitly defined raster-derived context. It does not authorize adapters or convert WMS/WMTS imagery into vectors.

The fixture-first `prg_adapter/v1` uses the allow-listed PRG WFS 2.0 feature types `A01`–`A03` for voivodeship, county and gmina boundaries, and `K01`–`K07` for selected police and fire classes. It preserves raw GML evidence, original feature IDs and EPSG:2180 metadata while normalizing output to EPSG:4326 GeoJSON. A non-boundary police/fire geometry is clipped to the selected AOI but never reclassified as OSM data or assumed to be a building point. Capabilities/schema drift, empty results and unavailable service responses remain structured source outcomes; offline verification reads only committed fixtures.

The fixture-first `bdot10k_adapter/v1` imports a preselected official 2021-schema GPKG or GeoParquet class artifact; it never treats the BDOT10k package-discovery WMS as a vector feature API. Its narrow allow-list maps `OT_SKDR_L` to transport, `OT_BUIN_L` to bridge context, `OT_SWRS_L` to water context, `OT_BUBD_A` to building context, and `OT_KUPG_A`/`OT_KUPG_P` to industrial context. Readers request only identity/context columns and a source-CRS AOI bound before a second EPSG:4326 clip. Output preserves the `idIIP` identifier, source class, EPSG:2180, artifact SHA-256, dated snapshot, GUGiK attribution and limitations. A missing class/identifier/CRS, incompatible geometry or digest mismatch is explicit schema/artifact drift, not an empty ready layer. The committed fixtures are bounded contract evidence, not a national-data snapshot or a facility-semantics claim.

The fixture-first `kiut_wms_adapter/v1` parses a dated KIUT WMS capabilities snapshot to expose only safe reference descriptors for electricity, water, gas, sewer, telecom and district-heating layers. It accepts a fixed GUGiK endpoint and allow-listed layer names, reports `available_reference`, `unsupported_scale`, `uncovered` or `service_unavailable`, and builds fixed-parameter GetMap/legend URLs for a preview. It records the `gesut` published extent as possible coverage only: it does not prove local utility completeness. KIUT imagery is never cached as an analytical artifact, converted into GeoJSON, used for default analysis or publicly exported.

The fixture-first `geoportal_orthophoto_wms_adapter/v1` parses the fixed high-resolution Geoportal WMS 1.3.0 `Raster` layer for an optional preview background. It reports `available_reference`, `uncovered` or `service_unavailable`, restricts GetMap URLs to the fixed official endpoint and layer, and records published coverage plus explicit `not_published` image-date and resolution states when WMS capabilities do not provide them. Orthophoto remains rendered reference imagery: it is not cached, object-vectorized, analytically processed or included in public exports.

The fixture-first `nmt_nmpt_raster_adapter/v1` accepts a bounded NMT/NMPT ASCII Grid as native raster evidence in EPSG:2180. It retains native and AOI-processed checksums, validates CRS, cell resolution, nodata and AOI coverage, and converts only AOI geometry to source CRS before clipping; it does not resample raster values. Its single derived-vector product, `terrain_sample_points/v1`, emits labelled cell-centre elevation context with `cell_centroid/v1` provenance and never claims flood risk or object semantics. Native rasters are cache-only artifacts and cannot be marked for public export or served through vector-only reads.

`provider_source_availability/v1` is a dated, cache-only AOI report. It separates availability, AOI coverage, feature state, freshness, eligibility and actionable source gaps for every registered source; empty, unavailable, uncovered, reference-only and not-eligible states are never inferred from a message. The Node read endpoint and preview consume the committed report only. Optional diagnostics are explicit wrappers that fail safely and are never reached by cached reads or the offline verification gate.

`cross_source_comparison/v1` records deterministic comparison evidence without conflating features. The initial power rule prefers a shared stable source ID, otherwise uses a bounded geometry distance only when both eligible analytical vectors expose the same comparable asset type; an absent candidate is explicitly `source_only`. It emits `matched`, `conflicting`, `source_only`, `ambiguous` or `not_comparable` with rule/version evidence and preserved source/feature identifiers. Reference WMS, manual review and rejected sources are explicitly not comparable; disagreement is not a claim that either source is wrong. The validation boundary turns only conflict, source-only and ambiguity outcomes into structured quality issues; readiness consumes those enums directly and reduces the result to `usable_with_limitations`, while a matched or not-comparable result alone does not invent a problem.

## Planned API

The Node/Express/TypeScript provider now serves typed, read-only local artifacts through `GET /api/health`, `GET /api/aoi/:aoiId/layers`, `GET /api/aoi/:aoiId/layers/:domain`, `GET /api/aoi/:aoiId/readiness` and `GET /api/aoi/:aoiId/sources`. These routes validate identifiers and file contracts, return 422 for malformed input and 404 for a missing cache, and do not invoke Python, Overpass or WMS.

`POST /api/aoi/requests` currently supports only `rybnik_60km/power`, whose registered boundary reference uses EPSG:4326. The provider treats a cache as fresh for 24 hours after `snapshot_at`; a missing or stale cache invokes the Python worker fixture path and returns whether the artifact came from cache or refresh.

`GET /api/aoi/catalog` returns the bounded offline PRG administrative selection catalogue. `POST /api/aoi/runtime-requests` validates `provider_aoi_request/v2`, then calls the local runtime worker only after validation. A cache miss for qualified `power`, `emergency`, `public`, `transport` or `bridges` makes a bounded live OSM/Overpass request, then publishes a validated local domain pack and PMTiles presentation; it makes no WMS or raster request. Other profiles remain typed source gaps until their separately governed adapters are complete.


`GET /api/aoi/:aoiId/domain-packs` and `GET /api/aoi/:aoiId/domain-packs/:domain` provide read-only `provider_domain_pack_read/v2` responses from registered manifests. Node validates request and manifest identity, pack-relative paths, source provenance, SHA-256 checksums, feature counts and provider GeoJSON metadata before returning any layer. The response exposes only explicitly public processed, derived or representative-point GeoJSON vectors. Native artifacts, rasters, remote services and reference-only records remain inside the cache as provenance evidence and cannot enter an analytical endpoint.

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
- `GET /api/aoi/:aoiId/presentations`
- `GET /api/aoi/:aoiId/presentations/:domain`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId`
- `GET /api/aoi/:aoiId/presentations/:domain/archive` (HTTP range only)

The first vertical slice is:

```text
AOI: rybnik_60km
Domain: power
Output: public OSM power-line and power-asset GeoJSON, private source/representative evidence, validation/readiness and KIUT reference provenance
Consumer: GIS consumer
```

The current release implements the provider side of this slice: a cache-first Rybnik power request, source/readiness/issue contracts, durable review state, bounded `provider_pack/v1` compatibility, a multi-artifact power domain pack and manifest-driven v2 reads/exports. The MapLibre dev-preview derives its layer toggles, counts, voltage style, attribution and limitations from compact presentation metadata, resolves one selected feature into its validated source detail, and reads public MVT from local PMTiles ranges; KIUT remains a separate external reference-only overlay. The preview is a non-operational provider inspection tool. Consumer-side loading remains a separate repository task.

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
- Prefer cached reads for consumer use.

### Phase 3 - Add Node/Express Provider API

- Add `backend-node/` with Express, TypeScript, Zod, test tooling and API routes.
- Implement read-only endpoints backed by the current cached GeoJSON/report artifacts.
- Add the source registry before exposing `/sources`.
- Add API tests for health, catalog/layers, readiness and export endpoints.

### Phase 4 - Connect Worker and Complete Provider Workflow

- Keep Python as a CLI/worker invoked by Node only when extraction or refresh is needed.
- Validate registered AOIs/domains and use explicit snapshot-freshness rules.
- Complete the cache-first request path and provider-compatible export.
- Verify the entire fixture-to-export pipeline without live Overpass.

### Phase 5 - Dev Preview and Issue Review

- Align the map preview with provider contracts and source metadata.
- Persist human review decisions separately from generated issue evidence.
- Support the issue lifecycle `open -> acknowledged -> resolved | accepted | ignored`.
- Keep the preview focused on data inspection rather than consumer operational behavior.

### Phase 6 - Provider Release

- Run the Python, Node and frontend verification baseline locally and in CI.
- Publish provider setup, verification and integration documentation based only on implemented behavior.
- Treat consumer integration as external follow-up work after this release.

### Phase 7 - Evidence-Driven Scale Options

- Add a job queue when direct CLI invocation becomes too limiting.
- Add SQLite/PostGIS for metadata and larger AOI management if file cache becomes awkward.
- Extend the established PMTiles/MVT read model only when later measured domain or AOI needs require it; consider PostGIS only for dynamic AOIs or server-side spatial-query evidence.
- Keep WMS reference overlays separate from analytical vector data.

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
