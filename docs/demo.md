# Provider Demo

This walkthrough demonstrates the implemented multi-domain provider suite across all 9 required G-004 domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`) for the `rybnik_60km` AOI in three to five minutes. It uses the committed cache and offline fixtures; it does not require live Overpass or WMS access.

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

## 3. Inspect the compact offline map presentation — 45 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/presentations/power \
  | jq '{
      aoi_id,
      domain,
      archive: {format: .archive.format, size_bytes: .archive.size_bytes, min_zoom: .archive.min_zoom, max_zoom: .archive.max_zoom},
      layers: [.layers[] | {artifact_id, source_layer, feature_count, attribution}]
    }'
```

The response is compact metadata, not the full GeoJSON collections. The local MapLibre preview uses its `archive_url` with HTTP byte ranges to read only required MVT tiles from PMTiles. The full domain-pack and GeoJSON endpoints remain the data/export path.

The current committed snapshot contains 156,721 public power features across the three GeoJSON layers: 16,505 lines, 7,087 assets and 133,129 supports. `power.supports` is a bounded OSM evidence fixture rather than a complete AOI support inventory. Its PMTiles archive is a derived, checked presentation artifact; treat counts and archive size as snapshot-specific.

## 4. Show why KIUT/GESUT remains reference-only — 45 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_60km/sources \
  | jq '.sources[]
      | select(.id == "kiut_gesut_wms")'
```

The registry identifies KIUT/GESUT WMS as a raster visual reference, not provider-owned analytical geometry. The provider does not fabricate GeoJSON or MVT from WMS imagery, and it does not include the service in offline PMTiles.

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

Open `http://localhost:5173`. The MapLibre preview draws public power data from the local PMTiles archive over the default-on OpenStreetMap base map. The base map is online visual context only: turn it off to verify the local PMTiles view, and do not expect it offline. Power lines use deterministic voltage colours; toggle the separate Power supports layer and zoom to 12 for towers, portals and utility poles, or 14 for ordinary poles. Click a visible feature to inspect source, confidence, limitations and its validated OSM source tags in the single inspector panel. KIUT and orthophoto toggles remain optional external WMS references and are not available offline. Generated rule evidence remains separate from persisted human decisions and never rewrites readiness.

## 6. Export multi-domain provider package — 30 seconds

Request a consolidated export payload for all 9 supported domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`):

```bash
curl -sS "http://127.0.0.1:3001/api/aoi/rybnik_60km/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial" \
  | jq '{
      export_version,
      aoi_id,
      domain_outcomes: [.domain_outcomes[] | {domain, status, has_domain_pack}],
      domain_pack_count: (.domain_packs | length),
      issue_count: (.issues | length)
    }'
```

The response conforms to `provider_multi_domain_export/v2`. It isolates per-domain failures into explicit `domain_outcomes`, filters public GeoJSON domain packs, attaches reviewed issue evidence matching requested domains, and deduplicates requested domain parameters.

## 7. Close with the system boundary — 20 seconds

The demonstrated path is:

```text
AOI/multi-domain request
  -> cache-first provider orchestration across 9 domains
  -> OSM/BDOT10k-derived, normalized GeoJSON
  -> validation, provenance, confidence and readiness
  -> derived MVT/PMTiles map presentation
  -> explainable issue evidence and review state
  -> provider_multi_domain_export/v2 export
```

This repository owns that upstream data workflow. The multi-domain export is ready for a provider-compatible client, but actual cross-repository consumption is not claimed by this release.

## Optional: demonstrate cache refresh after the core demo

The orchestration endpoint is intentionally separate from read-only layer access:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/aoi/requests \
  -H 'content-type: application/json' \
  -d '{"aoi_id":"rybnik_60km","domain":"power"}' \
  | jq '{aoi: .aoi.id, domain, result, cache_status, feature_count: .metadata.feature_count}'
```

A snapshot no older than 24 hours returns `result: "cache"`. An older or missing snapshot runs the Python worker with its offline fixture and returns `result: "refresh"`; this replaces the local cache with the smaller fixture artifact. Run this step only after presenting the committed 16,505-feature snapshot. Neither path calls live Overpass in the current workflow.
