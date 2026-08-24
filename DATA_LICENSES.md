# Data licensing and attribution

This notice separates the repository licence from the licences and terms that
apply to data. It is not legal advice and is intentionally conservative: an
uncertain source is not eligible for a public provider export.

## Scope of the repository licence

[PolyForm Strict 1.0.0](./LICENSE), including the
[Portfolio Evaluation Exception](./PORTFOLIO_EVALUATION_EXCEPTION.md), applies
to Map Data Provider's original software, documentation and project-authored
review fixtures. It does **not** replace, narrow or relicense third-party data.
Each third-party dataset keeps its own licence and attribution requirements.

## OpenStreetMap-derived data

The committed OSM fixtures and every provider artifact whose provenance names
`openstreetmap` are derived from OpenStreetMap contributors and are available
under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

- Attribute the data as [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Keep the ODbL notice and link with a redistribution.
- If a public database or derivative database is distributed, meet the ODbL
  notice and share-alike obligations for that database.

The pack builder enforces this operationally. Every pack with public
OSM-derived artifacts contains `licenses/openstreetmap-odbl.md` and a matching
`data_license_notices` record in its manifest. The MapLibre presentation
renders linked attribution to the OSM copyright page and ODbL while API
metadata retains the same human-readable credit.

The optional standard OSM raster base map is separate from provider data. It is
used only for normal interactive viewing, retains in-map OSM attribution, and
is not bulk-downloaded, prefetched or packaged for offline use.

## Official GUGiK / Geoportal sources

PRG and BDOT10k may be acquired or retained as bounded source evidence only.
They are deliberately marked `public_export: prohibited` in
`backend/data/sources/registry.json` until this repository contains a dated,
product-specific record of the applicable redistribution terms. Consequently,
the public demo does not publish PRG representative points or BDOT10k-derived
artifacts.

KIUT/GESUT and orthophoto are external WMS reference overlays. The application
does not copy, cache, vectorize or include their imagery in PMTiles or data
exports. Any future redistribution requires a fresh check of service metadata,
attribution and terms. NMT/NMPT is likewise not a public vector export.

The small PRG fixture used by contract tests remains source-labelled and is not
relicensed by this repository; it is excluded from public provider artifacts.

## Project-authored manual input

`manual_power_seed` is a non-authoritative project review fixture. It is not
an analytical source and is never emitted by public provider endpoints or
exports. Its use follows the repository licence above.

## Release check

Before publishing a new demo bundle, run `pnpm run verify:provider` and inspect
each `manifest.json`:

1. Every public artifact must have eligible provenance in the source registry.
2. Any OSM public artifact must include the ODbL notice file and manifest
   record.
3. No artifact sourced from PRG, BDOT10k, KIUT/GESUT, orthophoto or NMT/NMPT
   may be public unless the registry has been deliberately re-qualified with
   documented terms and the resulting change is reviewed.
