# Map Data Quality Lab

A source-aware geospatial data provider for downstream application.

The goal is to make downstream application portable across areas of interest by providing OSM-derived infrastructure layers, cached data snapshots, source metadata, validation reports, confidence scoring and map-layer APIs. downstream application remains the operational UI, simulation and RAG system; this repo owns the upstream map-data layer.

## What this project is

Map Data Quality Lab is the map-data provider behind downstream application. Given an area of interest and an infrastructure domain, it prepares analytical map layers from available public sources, normalizes them into a stable contract, caches snapshots for reproducible demos, validates geometry and attributes, and exposes readiness metadata for downstream simulation.

This repository focuses on the upstream provider layer: fetch, cache, validate, score and explain infrastructure layers before downstream application uses them for downstream visualization and simulation.

Primary responsibilities:

- AOI-based infrastructure layer preparation.
- OSM/Overpass ingestion and cached snapshots.
- GeoJSON normalization for downstream application consumers.
- Source attribution, confidence and readiness metrics.
- KIUT/GESUT WMS-style sources as reference overlays where available.
- Manual seed layers as explicitly non-authoritative review inputs.
- API contracts for downstream application map and simulation modules.

## What this project is not

This repo intentionally excludes the downstream application C2/RAG/simulation UI scope. It is not a defence dashboard, a wargaming UI, an AI assistant or the operator interface. Those responsibilities belong to downstream application. This provider answers what data exists, where it came from, how reliable it is and how it can be consumed.

## Intended relationship with downstream application

downstream application is the target consumer of this service as a geospatial backend:

```text
Map Data Quality Lab
  -> AOI and domain ingestion
  -> OSM-derived vector layers
  -> cached snapshots
  -> validation and confidence
  -> readiness reports
  -> GeoJSON/API exports

downstream application
  -> 2D/3D operational map
  -> infrastructure status visualization
  -> disruption scenarios
  -> cascading effects
  -> response units
  -> timeline and RAG
```

The intended contract is that downstream application can request infrastructure layers for a selected AOI without owning Overpass queries, source-specific tagging rules, KIUT/WMS limitations, caching or data-readiness logic.

## Provider demo flow

1. Run the offline provider verification and start the Node/Express API.
2. Request `rybnik_60km/power` through the read-only cached-layer endpoint.
3. Inspect the cached OSM-derived GeoJSON, metadata and readiness record.
4. Compare analytical, manual and reference-only source classifications.
5. Inspect generated issue evidence, human review state and feature metadata in the dev-preview.
6. Export `provider_pack/v1` for a provider-compatible client.

Follow the [3–5 minute provider demo](./docs/demo.md) for exact commands and representative output.

## Demo scenario

```text
Scenario: a provider-compatible client requests a power infrastructure layer

A compatible client requests the `power` domain for the Rybnik AOI.
Map Data Quality Lab returns cached, normalized OSM-derived power-line and power-asset layers with their metadata and readiness record. The power domain pack retains private source evidence and representative points, while KIUT/GESUT remains a separate reference-only WMS overlay.
The provider exposes source attribution, feature count, validation status, confidence and known limitations.
Its source registry keeps manual inputs and KIUT/GESUT WMS references distinct from analytical vectors.
The returned layer pack is ready for a provider-compatible client; actual downstream application consumption remains external integration work.
```

This is intentionally a provider scenario. Simulation, operator decisions and cascading effects happen in downstream application.

## Tech stack

- Provider API: Node.js, Express, TypeScript
- Geospatial worker: Python 3.14, OSMnx, GeoPandas, Shapely
- Python-pipeline prototype API: FastAPI
- Frontend: React, TypeScript, Vite, Leaflet dev-preview
- Geospatial data: OSM-derived GeoJSON artifacts, cached snapshots and reference overlays
- Data tooling: layer catalog, data-quality issues, validation reports, source metadata, confidence and readiness model

## Architecture direction

The provider uses a hybrid service architecture:

```text
provider-compatible consumers
  -> can consume REST/GeoJSON from the provider

Node.js / Express / TypeScript provider API
  -> exposes AOI, layer, readiness, source and export endpoints
  -> owns cache metadata, API contracts, request validation and service-level tests
  -> returns cached GeoJSON and readiness reports quickly to downstream application

Python geospatial worker
  -> fetches OSM/Overpass data
  -> clips and normalizes geometries
  -> validates attributes and geometry quality
  -> writes cached GeoJSON artifacts and reports
```

This split is intentional. Node/Express/TypeScript owns REST APIs, cache orchestration, request validation and TypeScript contracts. Python remains the processing layer because the OSM/geospatial ecosystem around OSMnx, GeoPandas and Shapely is stronger for extraction, clipping and geometry validation.

See [the architecture documentation](./docs/architecture.md) for decisions and the implementation plan.

## Why this is not an OpenInfraMap clone

[OpenInfraMap](https://openinframap.org/about) is a view of infrastructure mapped in OpenStreetMap. This repository solves a different problem: it prepares an AOI-scoped downstream data product. It normalizes OSM features into a versioned provider contract, preserves provenance, validates data quality, records confidence/readiness and review decisions, and exports a reproducible layer pack for another application.

The dev-preview is an inspection surface for that provider workflow, not an attempt to reproduce a global infrastructure basemap or OpenInfraMap's cartographic experience.

## Product scope

Core provider capabilities:

- AOI/domain request model, starting with `power` for Rybnik + 60 km.
- Layer Catalog with source, geometry type, AOI, feature count, confidence and access metadata.
- Cached OSM-derived layer artifacts so normal reads do not depend on live Overpass availability.
- Source-aware validation and readiness metrics that make data limitations visible instead of hiding them.
- Explainable data-quality issues and a persistent review-state workflow.
- Stable API/export contract for downstream application.
- Dev-preview map and object popups showing attributes, source attribution, confidence and known limitations.
- Documentation that explains OSM vectors, KIUT/GESUT reference overlays, manual seeds and QGIS verification.

Out of scope for this repo:

- C2 dashboard UX.
- Incident simulation.
- Dependency graph and cascading failures.
- Wargaming.
- RAG/AI assistant.
- Operational recommendations.

Those belong to downstream application.

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


`POST /api/aoi/requests` is implemented for `rybnik_60km/power`. A cache is fresh for 24 hours from `snapshot_at`; a missing or stale cache invokes the Python worker with its offline fixture input and reports whether the result came from cache or refresh.

## Verification

Install the supported dependencies once:

```bash
(cd backend && uv sync --locked --dev)
pnpm install
```

Then run the canonical offline quality gate from the repository root:

```bash
./scripts/verify_provider.sh
```

The same script runs in GitHub Actions for every pull request and push to `main`. It covers Python pipeline stages and contracts, the FastAPI smoke check, Node API/build/lint, the layer-pack export, issue-review persistence and conflicts, plus frontend review tests/build/lint. It does not query live Overpass or WMS services.

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
```

## Why this matters for map data tooling

Production map data is incomplete, heterogeneous, source-dependent and uneven across locations. This project shows a practical workflow for turning raw public map data into a reusable provider contract: source labeling, cached snapshots, validation, metadata, confidence, readiness reports and map-layer APIs for downstream applications.

The key product value is portability. downstream application can be pointed at a new AOI and request infrastructure layers, while the provider exposes whether OSM data is usable, incomplete or unsuitable for simulation.

## Data attribution and reference overlays

Distributed OSM-derived layers must retain the attribution **© OpenStreetMap contributors** and follow the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/) obligations recorded in the provider source registry. Every analytical cache snapshot records its OSM query endpoint, query version, pipeline version and snapshot timestamp alongside the layer.

KIUT/GESUT is kept as an OGC WMS visual reference overlay. WMS imagery is not converted to GeoJSON or used as analytical/analytical input by default. If a future product displays or redistributes the overlay, it must retain GUGiK/KIUT attribution and verify the current service metadata and distribution terms first.

## QGIS interoperability

The generated GeoJSON artifacts under `backend/data/processed/` can be opened in QGIS for manual inspection of geometries, attributes, CRS behavior, and layer completeness. QGIS is used as a GIS validation reference, while the product itself remains a web-based data tooling app.

## Useful inspirations

- QGIS: layer model, attributes, geometries, CRS and manual GIS inspection.
- GeoServer / OGC services: the distinction between GeoJSON, WMS, WFS, vector tiles and service metadata.
- MapLibre GL JS: a future option for WebGL/vector-tile rendering after the MVP data workflow is stable.
- OpenCTI/MISP conceptually: source, confidence, relation and review-state modeling, without adopting cyber-threat scope.
