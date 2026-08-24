# Map Data Provider

A source-aware geospatial data provider for Steel Sentinel v2 and other GIS consumers.

The primary goal is to prepare trusted, source-aware infrastructure data for [Steel Sentinel v2](../steel-sentinel-v2) across selected areas of interest. It provides OSM-derived infrastructure layers, cached data snapshots, source metadata, validation reports, confidence scoring and map-layer APIs through a reusable provider contract.

## License

This is a source-available portfolio repository, not open source. The code is
licensed under [PolyForm Strict 1.0.0](./LICENSE): noncommercial and educational
use is permitted, while redistribution, modification, and commercial use are
not. The [Portfolio Evaluation Exception](./PORTFOLIO_EVALUATION_EXCEPTION.md)
additionally permits prospective employers and recruiters to inspect, clone,
and run the project locally solely to evaluate Robert Lacheta's candidacy.

## What this project is

Map Data Provider prepares analytical map layers from available public sources for an area of interest and infrastructure domain. It normalizes them into a stable contract, caches snapshots for reproducible demos, validates geometry and attributes, and exposes readiness metadata for downstream use.

This repository focuses on the upstream provider layer: fetch, cache, validate, score and explain infrastructure layers before Steel Sentinel v2 or another GIS consumer uses them.

Primary responsibilities:

- AOI-based infrastructure layer preparation.
- OSM/Overpass ingestion and cached snapshots.
- GeoJSON normalization for GIS consumers.
- Source attribution, confidence and readiness metrics.
- KIUT/GESUT WMS-style sources as reference overlays where available.
- Manual seed layers as explicitly non-authoritative review inputs.
- API contracts for map-data consumers.

## Primary consumer: Steel Sentinel v2

Steel Sentinel v2 is the primary consumer of this provider. Map Data Provider prepares and documents the data product; Steel Sentinel v2 consumes it in its own application repository. The provider contract remains reusable for other GIS clients.

```text
Map Data Provider
  -> AOI and domain ingestion
  -> OSM-derived vector layers
  -> cached snapshots
  -> validation and confidence
  -> readiness reports
  -> GeoJSON/API exports for downstream use

Steel Sentinel v2
  -> map, analysis or data product
  -> consumes source-aware provider output
```

The intended contract lets Steel Sentinel v2 request infrastructure layers for a selected AOI without owning Overpass queries, source-specific tagging rules, KIUT/WMS limitations, caching or data-readiness logic.

## Provider demo flow

1. Run the offline provider verification and start the Node/Express API.
2. Request cached layers for any of the nine required domains or the optional `telecom` and `district_heating` domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`, `telecom`, `district_heating`) through read-only API endpoints or multi-domain export (`GET /api/aoi/:aoiId/export?domains=...`).
3. Inspect the source-labelled GeoJSON, metadata, domain outcomes, and readiness records.
4. Compare analytical, manual and reference-only source classifications.
5. Inspect generated issue evidence, human review state and feature metadata in the dev-preview.
6. Export `provider_multi_domain_export/v2` for Steel Sentinel v2 and other GIS consumers.

Follow the [3–5 minute provider demo](./docs/demo.md) for exact commands and representative output.

## Demo scenario

```text
Scenario: Steel Sentinel v2 requests source-aware multi-domain infrastructure layers

Steel Sentinel v2 requests any subset of the nine required domains (power, emergency, public, transport, bridges, water, gas, sewer, industrial) and the optional telecom and district-heating domains for the Rybnik AOI.
Map Data Provider returns cached, normalized analytical layers with their metadata, domain outcomes, and readiness records.
The provider exposes source attribution, feature count, validation status, confidence and known limitations.
Its source registry keeps manual inputs and KIUT/GESUT WMS references distinct from analytical vectors.
The returned layer pack is ready for Steel Sentinel v2; consumer-side integration remains in that repository.
```

This is a provider-first data-preparation scenario. Steel Sentinel v2 remains responsible for consuming the resulting data product.

## Tech stack

- Provider API: Node.js, Express, TypeScript
- Geospatial worker: Python 3.14, OSMnx, GeoPandas, Shapely
- Frontend: React, TypeScript, Vite, MapLibre GL JS and PMTiles dev-preview
- Geospatial data: canonical OSM-derived GeoJSON artifacts, derived MVT/PMTiles presentation archives, cached snapshots and reference overlays
- Data tooling: layer catalog, data-quality issues, validation reports, source metadata, confidence and readiness model

## Architecture direction

The provider uses a hybrid service architecture:

```text
GIS Consumer / Web Client
       │
       ▼
Node.js Express Provider (REST API + PMTiles streaming + Static SPA)
       │
       ▼
Python Geospatial Worker (OSMnx / GeoPandas / Shapely / PMTiles CLI)
```

This split is intentional. Node/Express/TypeScript owns REST APIs, cache orchestration, request validation and TypeScript contracts. Python remains the processing layer because the OSM/geospatial ecosystem around OSMnx, GeoPandas and Shapely is stronger for extraction, clipping and geometry validation.

See [the architecture documentation](./docs/architecture.md) for the current provider design, contracts and API boundaries.

## Why this is not an OpenInfraMap clone

[OpenInfraMap](https://openinframap.org/about) is a view of infrastructure mapped in OpenStreetMap. This repository solves a different problem: it prepares an AOI-scoped provider data product. It normalizes OSM features into a versioned provider contract, preserves provenance, validates data quality, records confidence/readiness and review decisions, and exports a reproducible layer pack for another application.

The dev-preview is an inspection surface for that provider workflow, not an attempt to reproduce a global infrastructure basemap or OpenInfraMap's cartographic experience.

## Product scope

Core provider capabilities:

- MapLibre AOI settings with point/radius or bounded Polish administrative selections, including a deterministic PRG-labelled union of selected counties and gminas.
- Catalogued AOI runtime profiles for the nine required domains plus optional `telecom` and `district_heating`. Telecom separates explicitly tagged towers/masts, facilities and lines; district heating separates explicitly tagged plants, heat exchangers and network lines. Missing lines remain visible source gaps, while KIUT telecom and district heating are reference-only. Existing Rybnik fixture packs remain explicit demo fallbacks; unavailable AOI data is reported as a source gap, never as empty analytical vectors.
- Layer Catalog with source, geometry type, AOI, feature count, confidence and access metadata.
- Cached OSM-derived layer artifacts so normal reads do not depend on live Overpass availability.
- Source-aware validation and readiness metrics that make data limitations visible instead of hiding them.
- Explainable data-quality issues and a persistent review-state workflow.
- Stable API/export contract for GIS consumers.
- MapLibre dev-preview with local PMTiles range reads, layer toggles and object inspection.
- Documentation that explains OSM vectors, KIUT/GESUT reference overlays, manual seeds and QGIS verification.

## Local development

### Full local Rybnik demo

The full Rybnik snapshot is deliberately outside Git. Copy the verified bundle
once into the ignored `.local-demo-bundle/` directory, then start the provider
against that directory:

```bash
./scripts/pull_local_demo_bundle.sh \
  root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km
pnpm run demo:local
```

In a second terminal, start the frontend as usual:

```bash
pnpm --dir frontend run dev
```

`pnpm run demo:local` sets `MDQ_PREPARED_ROOT` to the verified local bundle and
starts the API in read-only demo mode. If only a partial cache is present, the
preview explicitly names the missing primary domains rather than presenting it
as a complete Rybnik demo.

Node provider service:

```bash
cd backend-node
pnpm install
pnpm run dev
```

Frontend:

```bash
cd frontend
pnpm run dev
```

Open `http://localhost:5173`.

## Node provider endpoints

- `GET /api/health`
- `GET /api/aoi/catalog`
- `POST /api/aoi/catalog/boundary`
- `POST /api/aoi/runtime-requests/preflight`
- `POST /api/aoi/runtime-requests`
- `POST /api/aoi/runtime-jobs`
- `GET /api/aoi/runtime-jobs/:jobId`
- `POST /api/aoi/requests` (legacy `rybnik_35km/power` compatibility path)
- `GET /api/aoi/:aoiId/layers`
- `GET /api/aoi/:aoiId/layers/:domain`
- `GET /api/aoi/:aoiId/readiness`
- `GET /api/aoi/:aoiId/sources`
- `GET /api/aoi/:aoiId/source-availability`
- `GET /api/aoi/:aoiId/issues`
- `PATCH /api/aoi/:aoiId/issues/:issueId/review`
- `GET /api/aoi/:aoiId/domain-packs`
- `GET /api/aoi/:aoiId/domain-packs/:domain`
- `GET /api/aoi/:aoiId/export?domains=...`
- `GET /api/aoi/:aoiId/presentations`
- `GET /api/aoi/:aoiId/presentations/:domain`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId`
- `GET /api/aoi/:aoiId/presentations/:domain/features/:sourceId/circuits`
- `GET /api/aoi/:aoiId/presentations/:domain/circuits/:circuitId`
- `GET /api/aoi/:aoiId/presentations/:domain/archive` (requires an HTTP `Range` header)

Issue evidence is generated by versioned quality rules and remains separate from the persisted human review decision. Review updates support `open -> acknowledged -> resolved | accepted | ignored`; malformed or invalid transitions return `422`, while stale concurrent updates return `409` and must be retried from freshly loaded state.

The Node runtime path accepts a `provider_aoi_request/v2` point/radius or administrative selection plus requested categories. It derives a deterministic request/cache identity, coalesces equivalent local requests and reuses a fresh local runtime result for 24 hours. On an AOI cache miss it acquires any of the nine required profiles plus optional qualified `telecom` and `district_heating` profiles, validates and writes a local domain pack plus PMTiles presentation, then returns it as `ready`. Telecom admits only explicit telecommunications tags: GSM masts/towers, antenna/site facilities and `communication=line` or `cable=communication` routes. District heating admits only `industrial=heating_station`, heat-output-tagged plants/generators, `man_made=heat_exchanger`, and explicitly tagged heat lines. Empty optional-network layers remain `needs_source`. KIUT/orthophoto contexts remain `reference_only` and are never vectorized.

## Production deployment and live demo

Map Data Provider is deployed as a single multi-stage container behind the VPS Nginx Proxy Manager instance at **`maplab.robertlacheta.pl`**.

- **Read-Only Demo Mode**: Public mutations/refreshes (`POST /api/aoi/requests`, `POST /api/aoi/runtime-requests`, `POST /api/aoi/runtime-jobs`) are blocked with typed `runtime_disabled` responses.
- **Provider API**: Node.js 22 Express provider serves all REST routes, PMTiles range reads, and SPA frontend assets.
- **Geospatial Engine**: Python 3.14 + `uv` CLI worker handles offline data preparation and startup bootstrap.
- **External snapshot**: The full Rybnik snapshot is an operator-provisioned, checksum-verified demo bundle, not data committed to Git. The container validates and atomically promotes it to prepared storage before serving requests.
- **Runtime boundary**: Live AOI acquisition is available only to explicitly configured local/development workflows. It is deliberately disabled in the public demo so visitors cannot trigger Overpass acquisition or alter the snapshot.
- **Deployment Guide**: See [docs/deployment.md](docs/deployment.md) for Nginx Proxy Manager/Cloudflare, directory setup, and rollback instructions.

## Verification

Install the supported dependencies once:

```bash
(cd backend && uv sync --locked --dev)
pnpm install
```

Then run the canonical offline quality gate from the repository root:

```bash
pnpm run verify:provider
```

`pnpm install` configures the tracked native Git hook in `.githooks/`. Before every `git push`, that `pre-push` hook runs the faster `pnpm run verify:pre-push` checks; the full `pnpm run verify:provider` gate additionally runs the Python test suite and controlled failure probes. Neither gate queries live Overpass or WMS services.

GitHub Actions runs equivalent verification components in parallel for every pull request and push to `main`: the Python suite and smoke check, controlled negative probes, and the Node/frontend tests, builds and lint checks. The application verification remains offline after dependency installation and does not query live Overpass or WMS services.

The gate also runs six controlled negative probes covering contract snapshots, non-free sources, WMS vector export, stale evidence, malformed domain packs and malformed export queries. Each probe intentionally supplies invalid input and expects it to be rejected; an unexpected acceptance fails the overall gate.

Component-level commands are available for diagnosis:

```bash
(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
pnpm run verify:node
pnpm run verify:frontend
```

The Python worker can also be exercised directly with its offline fixture:

```bash
cd backend
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain power --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain emergency --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_35km --domain public --input fixture
```

## Why this matters for map data tooling

Production map data is incomplete, heterogeneous, source-dependent and uneven across locations. This project shows a practical workflow for turning raw public map data into a reusable provider contract: source labeling, cached snapshots, validation, metadata, confidence, readiness reports and map-layer APIs for GIS consumers.

The key product value is portability. A GIS consumer can be pointed at a new AOI and request infrastructure layers, while the provider exposes whether OSM data is usable, incomplete or unsuitable for its declared use.

## Data attribution and reference overlays

Distributed OSM-derived layers must retain the attribution **© OpenStreetMap contributors** and follow the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/) obligations recorded in the provider source registry. Every analytical cache snapshot records its OSM query endpoint, query version, pipeline version and snapshot timestamp alongside the layer.

KIUT/GESUT is kept as an OGC WMS visual reference overlay. WMS imagery is not converted to GeoJSON or used as analytical input by default. If a future product displays or redistributes the overlay, it must retain GUGiK/KIUT attribution and verify the current service metadata and distribution terms first.

## Map presentation and offline use

Full `provider_geojson/v1` artifacts remain the canonical cache, validation and export products. They are intentionally not the dev-preview map read path for the current 52,976-feature `rybnik_35km` power presentation or source-separated emergency artifacts. The delivered Rybnik snapshot contains 6,796 lines, 2,379 assets and 43,801 supports; these counts are snapshot-specific. It is distributed as an external, checksum-verified demo bundle rather than as a repository cache. The worker derives only manifest-approved public analytical layers into MVT and packages them in the checked `provider_map_presentation/v1` PMTiles archive. Node returns compact presentation metadata and HTTP byte ranges; MapLibre reads the local archive without a remote vector-data request. Selecting a visible feature loads one validated, allow-listed source-detail record by its stable provider source ID; it never fetches a full GeoJSON layer into the inspector.

The presentation has separate power-line, power-asset and bounded power-support layers. Power-line colours use deterministic voltage buckets. The support layer carries OSM `tower`, `pole`, `portal` and `utility_pole` classes where present in the delivered source snapshot; towers, portals and utility poles are generated from zoom 12, while ordinary poles are generated from zoom 14. These rules constrain tile generation rather than only hiding client-side features. The bounded support fixture is evidence for this preview behaviour, not a claim of complete support coverage across the AOI.

The emergency presentation uses four explicit OSM categories—hospital, fire service, police and ambulance/rescue—plus separately attributed PRG representative points for police/fire unit areas. OSM polygons remain in their original geometry and have a companion inspection-point layer. PRG points state that they derive from official unit-area geometry and never claim an exact facility footprint. No official hospital or ambulance/rescue registry is enabled; this remains a visible source gap rather than a reason to hide the delivered OSM evidence.

The public presentation has separate administration, education, post and community/social OSM layers, plus linked inspection points for original non-point geometry. A generic building, address or proximity is never promoted to a facility. The pack records BDOT10k as topographic context and the lack of a qualified PRG facility class as explicit source evidence; no source is silently selected or merged when comparison is ambiguous.

This makes public vector inspection available offline after a prepared snapshot has been mounted or bootstrapped from the external demo bundle. The preview also offers a default-on OpenStreetMap raster base map for online visual context; it is clearly separate from provider data, may be turned off and is unavailable offline. KIUT, orthophoto and other WMS/raster references remain external visual services: they are not vectorized, included in PMTiles or claimed to work offline.

## QGIS interoperability

The generated GeoJSON artifacts in an operator-provisioned prepared snapshot (for production, `data/prepared/rybnik_35km/`) can be opened in QGIS for manual inspection of geometries, attributes, CRS behavior, and layer completeness. The large snapshot is intentionally outside Git; see the [deployment guide](docs/deployment.md) for bundle preparation and storage. QGIS is used as a GIS validation reference, while the product itself remains a web-based data tooling app.

## Useful inspirations

- QGIS: layer model, attributes, geometries, CRS and manual GIS inspection.
- GeoServer / OGC services: the distinction between GeoJSON, WMS, WFS, vector tiles and service metadata.
- MapLibre GL JS and PMTiles: the implemented WebGL/vector-tile preview read model for large, cached public vector layers.
- OpenCTI/MISP conceptually: source, confidence, relation and review-state modeling, without adopting cyber-threat scope.
