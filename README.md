# Map Data Quality Lab

A source-aware geospatial data provider for GIS consumers.

The goal is to make GIS consumers portable across areas of interest by providing OSM-derived infrastructure layers, cached data snapshots, source metadata, validation reports, confidence scoring and map-layer APIs. This repository owns the upstream map-data layer; operational systems remain outside its scope.

## What this project is

Map Data Quality Lab is a map-data provider. Given an area of interest and an infrastructure domain, it prepares analytical map layers from available public sources, normalizes them into a stable contract, caches snapshots for reproducible demos, validates geometry and attributes, and exposes readiness metadata for downstream use.

This repository focuses on the upstream provider layer: fetch, cache, validate, score and explain infrastructure layers before a GIS consumer uses them.

Primary responsibilities:

- AOI-based infrastructure layer preparation.
- OSM/Overpass ingestion and cached snapshots.
- GeoJSON normalization for GIS consumers.
- Source attribution, confidence and readiness metrics.
- KIUT/GESUT WMS-style sources as reference overlays where available.
- Manual seed layers as explicitly non-authoritative review inputs.
- API contracts for map-data consumers.

## What this project is not

This repo intentionally excludes C2/RAG/simulation UI scope. It is not a defence dashboard, a wargaming UI, an AI assistant or an operator interface. This provider answers what data exists, where it came from, how reliable it is and how it can be consumed.

## Intended relationship with consumers

A consumer uses this service as a geospatial backend:

```text
Map Data Quality Lab
  -> AOI and domain ingestion
  -> OSM-derived vector layers
  -> cached snapshots
  -> validation and confidence
  -> readiness reports
  -> GeoJSON/API exports

GIS consumer
  -> map, analysis or data product
  -> chooses how to use source-aware output
```

The intended contract is that a consumer can request infrastructure layers for a selected AOI without owning Overpass queries, source-specific tagging rules, KIUT/WMS limitations, caching or data-readiness logic.

## Provider demo flow

1. Run the offline provider verification and start the Node/Express API.
2. Request the `rybnik_60km/power`, `rybnik_60km/emergency` or `rybnik_60km/public` cached layer through the read-only endpoint.
3. Inspect the source-labelled GeoJSON, metadata and readiness record.
4. Compare analytical, manual and reference-only source classifications.
5. Inspect generated issue evidence, human review state and feature metadata in the dev-preview.
6. Export `provider_pack/v1` for a provider-compatible client.

Follow the [3–5 minute provider demo](./docs/demo.md) for exact commands and representative output.

## Demo scenario

```text
Scenario: a provider-compatible client requests a source-aware infrastructure layer

A compatible client requests the `power`, `emergency` or `public` domain for the Rybnik AOI.
Map Data Quality Lab returns cached, normalized analytical layers with their metadata and readiness record. The power pack preserves OSM source evidence and a separate KIUT/GESUT reference-only WMS overlay. The emergency pack keeps OSM hospital/fire/police/ambulance-rescue geometry distinct from supplementary PRG police/fire unit-area representative points. The public pack exposes only explicit OSM administration, education, post and community/social semantics; BDOT10k buildings remain context, not facilities.
The provider exposes source attribution, feature count, validation status, confidence and known limitations.
Its source registry keeps manual inputs and KIUT/GESUT WMS references distinct from analytical vectors.
The returned layer pack is ready for a provider-compatible client; consumer-specific integration remains external work.
```

This is intentionally a provider scenario. Simulation, operator decisions and cascading effects are outside this repository.

## Tech stack

- Provider API: Node.js, Express, TypeScript
- Geospatial worker: Python 3.14, OSMnx, GeoPandas, Shapely
- Python-pipeline prototype API: FastAPI
- Frontend: React, TypeScript, Vite, MapLibre GL JS and PMTiles dev-preview
- Geospatial data: canonical OSM-derived GeoJSON artifacts, derived MVT/PMTiles presentation archives, cached snapshots and reference overlays
- Data tooling: layer catalog, data-quality issues, validation reports, source metadata, confidence and readiness model

## Architecture direction

The provider uses a hybrid service architecture:

```text
provider-compatible consumers
  -> can consume REST/GeoJSON from the provider

Node.js / Express / TypeScript provider API
  -> exposes AOI, layer, readiness, source and export endpoints
  -> owns cache metadata, API contracts, request validation and service-level tests
  -> returns cached GeoJSON and readiness reports to data consumers
  -> serves validated PMTiles byte ranges and compact presentation manifests to the local preview

Python geospatial worker
  -> fetches OSM/Overpass data
  -> clips and normalizes geometries
  -> validates attributes and geometry quality
  -> writes cached GeoJSON artifacts, reports and deterministic derived MVT/PMTiles presentation archives
```

This split is intentional. Node/Express/TypeScript owns REST APIs, cache orchestration, request validation and TypeScript contracts. Python remains the processing layer because the OSM/geospatial ecosystem around OSMnx, GeoPandas and Shapely is stronger for extraction, clipping and geometry validation.

See [the architecture documentation](./docs/architecture.md) for decisions and the implementation plan.

## Why this is not an OpenInfraMap clone

[OpenInfraMap](https://openinframap.org/about) is a view of infrastructure mapped in OpenStreetMap. This repository solves a different problem: it prepares an AOI-scoped provider data product. It normalizes OSM features into a versioned provider contract, preserves provenance, validates data quality, records confidence/readiness and review decisions, and exports a reproducible layer pack for another application.

The dev-preview is an inspection surface for that provider workflow, not an attempt to reproduce a global infrastructure basemap or OpenInfraMap's cartographic experience.

## Product scope

Core provider capabilities:

- MapLibre AOI settings with point/radius or bounded Polish administrative selections, including a deterministic PRG-labelled union of selected counties and gminas.
- Catalogued AOI runtime profiles for `power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer` and `industrial`. Existing Rybnik fixture packs remain explicit demo fallbacks; unavailable AOI data is reported as a source gap, never as empty analytical vectors.
- Layer Catalog with source, geometry type, AOI, feature count, confidence and access metadata.
- Cached OSM-derived layer artifacts so normal reads do not depend on live Overpass availability.
- Source-aware validation and readiness metrics that make data limitations visible instead of hiding them.
- Explainable data-quality issues and a persistent review-state workflow.
- Stable API/export contract for GIS consumers.
- MapLibre dev-preview with local PMTiles range reads, layer toggles and object inspection.
- Documentation that explains OSM vectors, KIUT/GESUT reference overlays, manual seeds and QGIS verification.

Out of scope for this repo:

- C2 dashboard UX.
- Incident simulation.
- Dependency graph and cascading failures.
- Wargaming.
- RAG/AI assistant.
- Operational recommendations.

Those belong to consumer-specific systems outside this repository.

## Local development

Current FastAPI prototype:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

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
- `POST /api/aoi/requests`
- `GET /api/aoi/{aoi_id}/layers`
- `GET /api/aoi/{aoi_id}/layers/{domain}`
- `GET /api/aoi/{aoi_id}/readiness`
- `GET /api/aoi/{aoi_id}/sources`
- `GET /api/aoi/{aoi_id}/issues`
- `PATCH /api/aoi/{aoi_id}/issues/{issue_id}/review`
- `GET /api/aoi/{aoi_id}/presentations`
- `GET /api/aoi/{aoi_id}/presentations/{domain}`
- `GET /api/aoi/{aoi_id}/presentations/{domain}/features/{source_id}`
- `GET /api/aoi/{aoi_id}/presentations/{domain}/archive` (requires an HTTP `Range` header)

Issue evidence is generated by versioned quality rules and remains separate from the persisted human review decision. Review updates support `open -> acknowledged -> resolved | accepted | ignored`; malformed or invalid transitions return `422`, while stale concurrent updates return `409` and must be retried from freshly loaded state.

## FastAPI prototype endpoints

- `GET /api/health`
- `GET /api/layers/catalog`
- `GET /api/data-quality/issues`
- `GET /api/data-quality/metrics`
- `GET /api/geodata/power/lines`
- `GET /api/geodata/power/nodes`
- `GET /api/geodata/power/manual-seeds`
- `GET /api/geodata/power/hexes/{level}`


`POST /api/aoi/requests` remains the legacy `rybnik_60km/power` compatibility path. `GET /api/aoi/catalog` returns the dated, source-labelled bounded PRG administrative selection catalogue. `POST /api/aoi/runtime-requests` accepts a `provider_aoi_request/v2` point/radius or administrative selection plus requested categories. It derives a deterministic request/cache identity, coalesces equivalent local requests and reuses a fresh local runtime result for 24 hours. On an AOI cache miss it may acquire the qualified public OSM `power`, `emergency` and `public` profiles, validates and writes an ignored local domain pack plus PMTiles presentation, then returns it as `ready`. The public profile permits only explicit administration, education, post and community/social semantics; building context cannot create a facility. The remaining unfinished domain profiles stay `needs_source`; KIUT/orthophoto contexts remain `reference_only` and are never vectorized.

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

`pnpm install` configures the tracked native Git hook in `.githooks/`. Before every `git push`, that `pre-push` hook runs `pnpm run verify:provider`. The full gate covers Python pipeline stages and contracts, the FastAPI smoke check, Node API/build/lint, the layer-pack export, issue-review persistence and conflicts, plus frontend review tests/build/lint. It does not query live Overpass or WMS services.

GitHub Actions is intentionally fast: for every pull request and push to `main` it checks Python syntax and runs Node/frontend unit tests, type-check/build and lint. The full Python suite, smoke check and controlled negative probe run locally before a push instead.

The gate also runs a controlled negative probe and confirms that an intentionally invalid issue-snapshot contract makes its pytest command fail. A probe that unexpectedly passes fails the overall gate.

Component-level commands are available for diagnosis:

```bash
(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
pnpm run verify:node
pnpm run verify:frontend
```

The Python worker can also be exercised directly with its offline fixture:

```bash
cd backend
uv run --offline python -m geo_pipeline.worker --aoi rybnik_60km --domain power --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_60km --domain emergency --input fixture
uv run --offline python -m geo_pipeline.worker --aoi rybnik_60km --domain public --input fixture
```

## Why this matters for map data tooling

Production map data is incomplete, heterogeneous, source-dependent and uneven across locations. This project shows a practical workflow for turning raw public map data into a reusable provider contract: source labeling, cached snapshots, validation, metadata, confidence, readiness reports and map-layer APIs for GIS consumers.

The key product value is portability. A GIS consumer can be pointed at a new AOI and request infrastructure layers, while the provider exposes whether OSM data is usable, incomplete or unsuitable for its declared use.

## Data attribution and reference overlays

Distributed OSM-derived layers must retain the attribution **© OpenStreetMap contributors** and follow the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/) obligations recorded in the provider source registry. Every analytical cache snapshot records its OSM query endpoint, query version, pipeline version and snapshot timestamp alongside the layer.

KIUT/GESUT is kept as an OGC WMS visual reference overlay. WMS imagery is not converted to GeoJSON or used as analytical/analytical input by default. If a future product displays or redistributes the overlay, it must retain GUGiK/KIUT attribution and verify the current service metadata and distribution terms first.

## Map presentation and offline use

Full `provider_geojson/v1` artifacts remain the canonical cache, validation and export products. They are intentionally not the dev-preview map read path for the 23,604-feature Rybnik power snapshot or source-separated emergency artifacts. The worker derives only manifest-approved public analytical layers into MVT and packages them in the checked `provider_map_presentation/v1` PMTiles archive. Node returns compact presentation metadata and HTTP byte ranges; MapLibre reads the local archive without a remote vector-data request. Selecting a visible feature loads one validated, allow-listed source-detail record by its stable provider source ID; it never fetches a full GeoJSON layer into the inspector.

The presentation has separate power-line, power-asset and bounded power-support layers. Power-line colours use deterministic voltage buckets. The support layer carries OSM `tower`, `pole`, `portal` and `utility_pole` classes where present in the committed source snapshot; towers, portals and utility poles are generated from zoom 12, while ordinary poles are generated from zoom 14. These rules constrain tile generation rather than only hiding client-side features. The bounded support fixture is evidence for this preview behaviour, not a claim of complete support coverage across the AOI.

The emergency presentation uses four explicit OSM categories—hospital, fire service, police and ambulance/rescue—plus separately attributed PRG representative points for police/fire unit areas. OSM polygons remain in their original geometry and have a companion inspection-point layer. PRG points state that they derive from official unit-area geometry and never claim an exact facility footprint. No official hospital or ambulance/rescue registry is enabled; this remains a visible source gap rather than a reason to hide the committed OSM evidence.

The public presentation has separate administration, education, post and community/social OSM layers, plus linked inspection points for original non-point geometry. A generic building, address or proximity is never promoted to a facility. The pack records BDOT10k as topographic context and the lack of a qualified PRG facility class as explicit source evidence; no source is silently selected or merged when comparison is ambiguous.

This makes public vector inspection available offline after the repository cache is present. The preview also offers a default-on OpenStreetMap raster base map for online visual context; it is clearly separate from provider data, may be turned off and is unavailable offline. KIUT, orthophoto and other WMS/raster references remain external visual services: they are not vectorized, included in PMTiles or claimed to work offline.

## QGIS interoperability

The generated GeoJSON artifacts under `backend/data/processed/` can be opened in QGIS for manual inspection of geometries, attributes, CRS behavior, and layer completeness. QGIS is used as a GIS validation reference, while the product itself remains a web-based data tooling app.

## Useful inspirations

- QGIS: layer model, attributes, geometries, CRS and manual GIS inspection.
- GeoServer / OGC services: the distinction between GeoJSON, WMS, WFS, vector tiles and service metadata.
- MapLibre GL JS and PMTiles: the implemented WebGL/vector-tile preview read model for large, cached public vector layers.
- OpenCTI/MISP conceptually: source, confidence, relation and review-state modeling, without adopting cyber-threat scope.
