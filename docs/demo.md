# Provider Demo

This walkthrough demonstrates the implemented `rybnik_60km/power` provider slice in three to five minutes. It uses the committed cache and offline fixtures; it does not require live Overpass or WMS access.

The current release produces a provider-compatible export. Loading that export inside the downstream application repository remains separate integration work.

## Preparation

Install dependencies and run the full quality gate once:

```bash
(cd backend && uv sync --locked --dev)
pnpm install
./scripts/verify_provider.sh
```

Start the provider in one terminal:

```bash
cd backend-node
pnpm run dev
```

The examples below use `curl` and `jq` against `http://127.0.0.1:3001`.

## 1. Confirm the typed provider boundary — 20 seconds

```bash
curl -sS http://127.0.0.1:3001/api/health | jq
```

Expected shape:

```json
{
  "status": "ok",
  "service": "map-data-quality-provider",
  "version": "0.1.0"
}
```

The public API is Node/Express/TypeScript. Python remains the geospatial worker and FastAPI prototype.

## 2. Request the cached Rybnik power layer — 30 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/layers/power \
  | jq '{
      aoi_id: .metadata.aoi_id,
      domain: .metadata.domain,
      source: .metadata.source,
      feature_count: .metadata.feature_count,
      readiness: .metadata.readiness
    }'
```

This read-only endpoint serves the committed, validated cache without extraction side effects. It is the safe path for a repeatable presentation of the full Rybnik snapshot.

## 3. Inspect the provider-compatible layer pack — 60 seconds

```bash
  | jq '{
      contract_version,
      aoi_id,
      domains,
      power: {
        feature_count: .layers.power.metadata.feature_count,
        source: .layers.power.metadata.source,
        confidence: .layers.power.metadata.confidence,
        readiness: .layers.power.readiness.readiness,
        limitations: .layers.power.metadata.limitations
      },
      source_types: [.sources.sources[].source_type] | unique
    }'
```

The current committed snapshot reports 16,505 OSM-derived power features, `medium` confidence and `usable_with_limitations` readiness. Treat the count as snapshot-specific: the returned value is authoritative for the checked-out artifact.

The response demonstrates the provider boundary:

- `provider_pack/v1` is stable and independent of Overpass tagging conventions.
- `analytical_vector`, `manual_seed` and `reference_overlay` remain distinguishable.
- passed validation does not claim complete real-world infrastructure coverage.

## 4. Show why KIUT/GESUT remains reference-only — 45 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/sources \
  | jq '.sources[]
      | select(.id == "kiut_gesut_wms")
```

The registry identifies KIUT/GESUT WMS as a raster visual reference, not provider-owned analytical geometry. The provider does not fabricate GeoJSON from WMS imagery and does not mark it eligible for analytical use.

## 5. Inspect issues and the map preview — 60–90 seconds

List generated evidence together with separate human review state:

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/issues \
  | jq '.issues[] | {id, rule_id, source_type, severity, review}'
```

Optionally start the React preview in another terminal:

```bash
cd frontend
pnpm run dev
```

Open `http://localhost:5173`. Use a feature popup to inspect source, confidence, missing fields and limitations; then use the issue-state filter to show the review workflow. Generated rule evidence remains separate from persisted human decisions and never rewrites readiness.

## 6. Close with the system boundary — 20 seconds

The demonstrated path is:

```text
AOI/domain request
  -> cache-first provider orchestration
  -> OSM-derived, normalized GeoJSON
  -> validation, provenance, confidence and readiness
  -> explainable issue evidence and review state
  -> provider_pack/v1 export
```

This repository owns that upstream data workflow. The export is ready for a provider-compatible client, but actual cross-repository consumption is not claimed by this release.

## Optional: demonstrate cache refresh after the core demo

The orchestration endpoint is intentionally separate from read-only layer access:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/aoi/requests \
  -H 'content-type: application/json' \
  -d '{"aoi_id":"rybnik_60km","domain":"power"}' \
  | jq '{aoi: .aoi.id, domain, result, cache_status, feature_count: .metadata.feature_count}'
```

A snapshot no older than 24 hours returns `result: "cache"`. An older or missing snapshot runs the Python worker with its offline fixture and returns `result: "refresh"`; this replaces the local cache with the smaller fixture artifact. Run this step only after presenting the committed 16,505-feature snapshot. Neither path calls live Overpass in the current workflow.
