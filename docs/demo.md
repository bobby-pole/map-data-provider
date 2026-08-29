# Provider Demo

This walkthrough demonstrates the implemented multi-domain provider suite across all 9 required G-004 domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`) for the `rybnik_35km` AOI in three to five minutes. It uses an operator-provisioned Rybnik snapshot plus offline fixtures; it does not require live Overpass or WMS access. The full snapshot is intentionally not committed to Git.

The current release produces a provider-compatible export for Steel Sentinel v2. Loading that export in the Steel Sentinel v2 repository remains separate integration work.

## Preparation

Install dependencies and run the full quality gate once:

```bash
(cd backend && uv sync --locked --dev)
pnpm install
./scripts/verify_provider.sh
```

To run the data endpoint examples outside the production container, provide a prepared-root directory that contains `rybnik_35km/` (for example, an operator-prepared local snapshot). CI fixtures prove contracts but are deliberately not a full Rybnik dataset:

```bash
export MDQ_PREPARED_ROOT=/absolute/path/to/prepared-root
```

For the public deployment, instead follow the [deployment guide](./deployment.md): the container receives an immutable bundle, verifies all declared hashes and domain-pack contracts, then promotes it into `data/prepared/` before the API starts.

Start the provider in one terminal:

```bash
cd backend-node
pnpm run dev
```

The examples below use `curl` and `jq` against `http://127.0.0.1:3001`.

For the full local Rybnik demo, first copy the operator-provisioned verified
bundle and run the API in local bounded-acquisition mode:

```bash
./scripts/pull_local_demo_bundle.sh \
  root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km
pnpm run demo:local
```

The bundle remains ignored by Git under `.local-demo-bundle/`. A partial cache
is still readable for development, but the preview shows an explicit warning
listing its missing primary domains.

The public VPS intentionally uses a different policy: it exposes one clearly
labelled, server-defined Rybnik-gmina preparation through
`POST /api/aoi/demo-acquisitions/rybnik_gmina_demo`. It does not accept a
visitor's coordinates, PRG selection, profile list or refresh flag. Inspect
`GET /api/aoi/runtime-capabilities` before integrating either mode.

To record reproducible API, PMTiles and fixture-worker delivery metrics, leave
this API running and execute the following in a second terminal:

```bash
pnpm run measure:demo
```

It sends 100 requests to each documented core endpoint and writes a dated raw
JSON report under `docs/measurements/`; see the [measurement procedure](./performance_baseline.md)
for scope and interpretation limits.

## 1. Confirm the typed provider boundary — 20 seconds

```bash
curl -sS http://127.0.0.1:3001/api/health | jq
```

Expected shape:

```json
{
  "status": "ok",
  "service": "map-data-provider",
  "version": "0.1.0"
}
```

The public API is Node/Express/TypeScript. Python remains the geospatial processing worker.

## 2. Request the cached Rybnik power layer — 30 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/layers/power \
  | jq '{
      aoi_id: .metadata.aoi_id,
      domain: .metadata.domain,
      source: .metadata.source,
      feature_count: .metadata.feature_count,
      readiness: .metadata.readiness
    }'
```

This read-only endpoint serves the prepared, validated snapshot without extraction side effects. It is the safe path for a repeatable presentation of the full Rybnik dataset.

## 3. Inspect the compact offline map presentation — 45 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/presentations/power \
  | jq '{
      aoi_id,
      domain,
      archive: {format: .archive.format, size_bytes: .archive.size_bytes, min_zoom: .archive.min_zoom, max_zoom: .archive.max_zoom},
      layers: [.layers[] | {artifact_id, source_layer, feature_count, attribution}]
    }'
```

The response is compact metadata, not the full GeoJSON collections. The local MapLibre preview uses its `archive_url` with HTTP byte ranges to read only required MVT tiles from PMTiles. The full domain-pack and GeoJSON endpoints remain the data/export path.

The delivered `rybnik_35km` presentation contains 52,976 public power features across its three layers: 6,796 lines, 2,379 assets and 43,801 supports. `power.supports` is a bounded OSM evidence fixture rather than a complete AOI support inventory. Its PMTiles archive is a derived, checked presentation artifact; treat counts and archive size as snapshot-specific.

## 4. Show why KIUT/GESUT remains reference-only — 45 seconds

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/sources \
  | jq '.sources[]
      | select(.id == "kiut_gesut_wms")'
```

The registry identifies KIUT/GESUT WMS as a raster visual reference, not provider-owned analytical geometry. The provider does not fabricate GeoJSON or MVT from WMS imagery, and it does not include the service in offline PMTiles.

## 5. Inspect issues and the map preview — 60–90 seconds

List generated evidence together with separate human review state:

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/issues \
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
curl -sS "http://127.0.0.1:3001/api/aoi/rybnik_35km/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial" \
  | jq '{
      export_version,
      aoi_id,
      domain_outcomes: [.domain_outcomes[] | {domain, status, has_domain_pack}],
      domain_pack_count: (.domain_packs | length),
      issue_count: (.issues | length)
    }'
```

The response conforms to `provider_multi_domain_export/v2`. It isolates per-domain failures into explicit `domain_outcomes`, filters public GeoJSON domain packs, attaches reviewed issue evidence matching requested domains, and deduplicates requested domain parameters.

## Optional utility-domain source-gap examples

The optional `telecom` pack exposes only explicitly tagged OSM communication towers/masts, facilities and cable routes. It never derives a network from KIUT WMS. In the delivered Rybnik snapshot, `telecom.lines` has zero features and `readiness: needs_source`; this is a visible absence of qualified analytical line coverage, not a rendering failure.

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/domain-packs/telecom \
  | jq '.layers[] | {id: .artifact.id, count: .layer.metadata.feature_count, readiness: .layer.metadata.readiness}'
```

The optional `district_heating` pack separately exposes explicit heating plants, heat-exchanger facilities and heat-network lines. A power plant or generator requires an explicit heat-output/source tag; generic industrial or pipeline features remain excluded. In the delivered Rybnik snapshot, `district_heating.lines` has zero features and `readiness: needs_source`; KIUT district-heating remains a private WMS reference rather than analytical geometry.

```bash
curl -sS http://127.0.0.1:3001/api/aoi/rybnik_35km/domain-packs/district_heating \
  | jq '.layers[] | {id: .artifact.id, count: .layer.metadata.feature_count, readiness: .layer.metadata.readiness}'
```

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

This repository owns that upstream data workflow. The multi-domain export is prepared for Steel Sentinel v2, but actual cross-repository consumption is not claimed by this release.

## Optional: demonstrate cache refresh after the core demo

The orchestration endpoint is intentionally separate from read-only layer access:

```bash
curl -sS -X POST http://127.0.0.1:3001/api/aoi/requests \
  -H 'content-type: application/json' \
  -d '{"aoi_id":"rybnik_35km","domain":"power"}' \
  | jq '{aoi: .aoi.id, domain, result, cache_status, feature_count: .metadata.feature_count}'
```

A snapshot no older than 24 hours returns `result: "cache"`. An older or missing snapshot runs the Python worker with its offline fixture and returns `result: "refresh"`; this replaces the local prepared artifact with the fixture output. Run this step only in a disposable local development directory after presenting the delivered `rybnik_35km` snapshot. The public demo rejects this mutation with `runtime_disabled`; live Overpass acquisition is used only by the separately configured AOI runtime-request path.
