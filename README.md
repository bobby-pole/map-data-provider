# Map Data Quality Lab

A source-aware geospatial data provider for Steel Sentinel.

The goal is to make Steel Sentinel portable across areas of interest by providing OSM-derived infrastructure layers, cached data snapshots, source metadata, validation reports, confidence scoring and map-layer APIs. Steel Sentinel remains the operational UI, simulation and RAG system; this repo owns the upstream map-data layer.

## What this project is

Map Data Quality Lab is the map-data provider behind Steel Sentinel. Given an area of interest and an infrastructure domain, it prepares analytical map layers from available public sources, normalizes them into a stable contract, caches snapshots for reproducible demos, validates geometry and attributes, and exposes readiness metadata for downstream simulation.

This repository focuses on the upstream provider layer: fetch, cache, validate, score and explain infrastructure layers before Steel Sentinel uses them for operational visualization and simulation.

Primary responsibilities:

- AOI-based infrastructure layer preparation.
- OSM/Overpass ingestion and cached snapshots.
- GeoJSON normalization for Steel Sentinel consumers.
- Source attribution, confidence and readiness metrics.
- KIUT/GESUT WMS-style sources as reference overlays where available.
- Manual seed layers as explicitly non-authoritative review inputs.
- API contracts for Steel Sentinel map and simulation modules.

## What this project is not

This repo intentionally excludes the Steel Sentinel C2/RAG/simulation UI scope. It is not a defence dashboard, a wargaming UI, an AI assistant or the operator interface. Those responsibilities belong to Steel Sentinel. This provider answers what data exists, where it came from, how reliable it is and how it can be consumed.

## Intended relationship with Steel Sentinel

Steel Sentinel is the target consumer of this service as a geospatial backend:

```text
Map Data Quality Lab
  -> AOI and domain ingestion
  -> OSM-derived vector layers
  -> cached snapshots
  -> validation and confidence
  -> readiness reports
  -> GeoJSON/API exports

Steel Sentinel
  -> 2D/3D operational map
  -> infrastructure status visualization
  -> disruption scenarios
  -> cascading effects
  -> response units
  -> timeline and RAG
```

The intended contract is that Steel Sentinel can request infrastructure layers for a selected AOI without owning Overpass queries, source-specific tagging rules, KIUT/WMS limitations, caching or data-readiness logic.

## Provider demo flow

1. Start the Node/Express provider API; FastAPI remains a prototype for the Python pipeline only.
2. Request an AOI/domain layer package, starting with `Rybnik + 60 km` and `power`.
3. The provider checks cached OSM-derived artifacts before running new extraction work.
4. If cache is missing or stale, the provider triggers the Python geospatial worker.
5. Inspect the layer catalog, cached artifacts and validation reports.
6. Review confidence/readiness metrics and known source limitations.
7. Export or consume the prepared GeoJSON layer pack through Steel Sentinel.

## Demo scenario

```text
Scenario: a Steel Sentinel-compatible client requests a power infrastructure layer

A compatible client requests the `power` domain for the Rybnik AOI.
Map Data Quality Lab returns cached OSM-derived lines, nodes, manual seed metadata and quality hexes.
The provider exposes source attribution, feature counts, validation status, confidence and known limitations.
KIUT/GESUT layers are documented as visual reference overlays, not analytical vectors.
The returned layer pack is ready for later Steel Sentinel map rendering and simulation integration.
```

This is intentionally a provider scenario. Simulation, operator decisions and cascading effects happen in Steel Sentinel.

## Tech stack

- Provider API target: Node.js, Express, TypeScript
- Geospatial worker: Python 3.14, OSMnx, GeoPandas, Shapely
- Python-pipeline prototype API: FastAPI
- Frontend: React, TypeScript, Vite, Leaflet dev-preview
- Geospatial data: OSM-derived GeoJSON artifacts, cached snapshots and reference overlays
- Data tooling: layer catalog, data-quality issues, validation reports, source metadata, confidence and readiness model

## Architecture direction

The provider uses a hybrid service architecture:

```text
Steel Sentinel
  -> consumes REST/GeoJSON from the provider

Node.js / Express / TypeScript provider API
  -> exposes AOI, layer, readiness, source and export endpoints
  -> owns cache metadata, API contracts, request validation and service-level tests
  -> returns cached GeoJSON and readiness reports quickly to Steel Sentinel

Python geospatial worker
  -> fetches OSM/Overpass data
  -> clips and normalizes geometries
  -> validates attributes and geometry quality
  -> writes cached GeoJSON artifacts and reports
```

This split is intentional. Node/Express/TypeScript owns REST APIs, cache orchestration, request validation and TypeScript contracts. Python remains the processing layer because the OSM/geospatial ecosystem around OSMnx, GeoPandas and Shapely is stronger for extraction, clipping and geometry validation.

See [the architecture documentation](./docs/architecture.md) for decisions and the implementation plan.

## Product scope

Core provider capabilities:

- AOI/domain request model, starting with `power` for Rybnik + 60 km.
- Layer Catalog with source, geometry type, AOI, feature count, confidence and access metadata.
- Cached OSM-derived layer artifacts so normal reads do not depend on live Overpass availability.
- Source-aware validation and readiness metrics that make data limitations visible instead of hiding them.
- Explainable data-quality issues and a persistent review-state workflow.
- Stable API/export contract for Steel Sentinel.
- Dev-preview map and object popups showing attributes, source attribution, confidence and known limitations.
- Documentation that explains OSM vectors, KIUT/GESUT reference overlays, manual seeds and QGIS verification.

Out of scope for this repo:

- C2 dashboard UX.
- Incident simulation.
- Dependency graph and cascading failures.
- Wargaming.
- RAG/AI assistant.
- Operational recommendations.

Those belong to Steel Sentinel.

## Local development

Current FastAPI prototype:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

Node provider scaffold (currently `GET /api/health` only):

```bash
cd backend-node
npm install --package-lock=false
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Node provider endpoints

- `GET /api/health`
- `GET /api/aoi/{aoi_id}/layers`
- `GET /api/aoi/{aoi_id}/layers/{domain}`
- `GET /api/aoi/{aoi_id}/readiness`
- `GET /api/aoi/{aoi_id}/sources`

## FastAPI prototype endpoints

- `GET /api/health`
- `GET /api/layers/catalog`
- `GET /api/data-quality/issues`
- `GET /api/data-quality/metrics`
- `GET /api/geodata/power/lines`
- `GET /api/geodata/power/nodes`
- `GET /api/geodata/power/manual-seeds`
- `GET /api/geodata/power/hexes/{level}`

Future Node provider endpoints:

- `GET /api/aoi/{aoi_id}/exports/steel-sentinel-pack`

`POST /api/aoi/requests` is implemented for `rybnik_60km/power`. A cache is fresh for 24 hours from `snapshot_at`; a missing or stale cache invokes the Python worker with its offline fixture input and reports whether the result came from cache or refresh.

## Verification

Current Python/FastAPI smoke check:

```bash
cd backend
uv run python tests/smoke_check.py
```

Node/Express scaffold checks:

```bash
cd backend-node
npm run build
npm test
npm run lint
```

Python worker CLI (offline fixture refresh):

```bash
cd backend
uv run --offline python -m geo_pipeline.worker --aoi rybnik_60km --domain power --input fixture
```

Frontend checks:

```bash
cd frontend
npm run build
npm run lint
```

## Why this matters for map data tooling

Production map data is incomplete, heterogeneous, source-dependent and uneven across locations. This project shows a practical workflow for turning raw public map data into a reusable provider contract: source labeling, cached snapshots, validation, metadata, confidence, readiness reports and map-layer APIs for downstream applications.

The key product value is portability. Steel Sentinel can be pointed at a new AOI and request infrastructure layers, while the provider exposes whether OSM data is usable, incomplete or unsuitable for simulation.

## Data attribution and reference overlays

Distributed OSM-derived layers must retain the attribution **© OpenStreetMap contributors** and follow the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/) obligations recorded in the provider source registry. Every analytical cache snapshot records its OSM query endpoint, query version, pipeline version and snapshot timestamp alongside the layer.

KIUT/GESUT is kept as an OGC WMS visual reference overlay. WMS imagery is not converted to GeoJSON or used as analytical/simulation input by default. If a future product displays or redistributes the overlay, it must retain GUGiK/KIUT attribution and verify the current service metadata and distribution terms first.

## QGIS interoperability

The generated GeoJSON artifacts under `backend/data/processed/` can be opened in QGIS for manual inspection of geometries, attributes, CRS behavior, and layer completeness. QGIS is used as a GIS validation reference, while the product itself remains a web-based data tooling app.

## Useful inspirations

- QGIS: layer model, attributes, geometries, CRS and manual GIS inspection.
- GeoServer / OGC services: the distinction between GeoJSON, WMS, WFS, vector tiles and service metadata.
- MapLibre GL JS: a future option for WebGL/vector-tile rendering after the MVP data workflow is stable.
- OpenCTI/MISP conceptually: source, confidence, relation and review-state modeling, without adopting cyber-threat scope.
