# Project Status

Updated: 2026-08-08

## Current snapshot

- Active goal: `G-004 - Multi-source, multi-domain provider` (`Achieved`); `G-003` and `G-004` achieved across all 9 required domains.
- Current milestone: multi-source release verification & portfolio deployment
- Active ticket: None.
- Last completed ticket: `MDQ-044 - Add Multi-Source Release Verification and Demo`.
- Next dependency-safe ticket: `MDQ-052 - Deploy Read-Only Portfolio Demo on VPS`.
- Prepared follow-up: `MDQ-052 - Deploy Read-Only Portfolio Demo on VPS` (`G-006`).
- Blockers: None.

## Release evidence

- 2026-08-08 - Completed `MDQ-044`: delivered multi-source release verification and demo suite for Goal `G-004`. Unified `./scripts/verify_provider.sh` as the single repository-owned gate verifying all 9 domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`), integrated negative probes (non-free vector rejection, WMS vector export rejection, contract failures, stale evidence rejection, malformed domain pack rejection, malformed export query rejection), aligned CI workflow (`.github/workflows/provider-verification.yml`), recorded scale measurements (171,372 features, 144.8 MB GeoJSON corpus), and updated documentation. Full provider verification passed: 193 Python tests, 51 Node tests, 19 frontend tests, 6 failure probes, smoke check, and clean builds.

- 2026-08-07 - Completed `MDQ-043`: delivered multi-domain AOI request and export workflow. Added `GET /api/aoi/:aoiId/export` route returning `provider_multi_domain_export/v2` payloads with domain filtering, public-export artifact safety, and reviewed issue context. Added multi-domain JSON export button to the dev-preview UI. Verification passed: 46 Node unit tests and 19 Frontend tests.

- 2026-08-07 - Completed `MDQ-040`: delivered fixture-first and bounded-AOI OSM industrial facilities, land-use, and building context layers. Added military context using BDOT10k `OT_PTKM_A` classes and OSM evidence, and resolved legacy cache extraction conflations. `industrial-osm/v2`, `geo_pipeline/industrial/v2` and `geo_pipeline/runtime/v13` correctly separate semantic layers, enforce required identifications, and publish the full industrial domain pack v2 including comparison metadata. Verification passed: 192 Python tests, 45 Node tests, 19 frontend tests, plus successful UI smoke checks.

- 2026-08-07 - Started `MDQ-040`: verifying industrial domain pack acquisition. Corrected OSM fixture property propagation to meet GeoJSON contract requirements for legacy cache extraction and normalization.

- 2026-08-07 - Completed `MDQ-039`: delivered fixture-first and bounded-AOI OSM sewer facilities/pipelines with explicit sewer/wastewater semantics, derived inspection points, KIUT sewer as a reference-only overlay and visible source-completeness limitations. `sewer-osm/v2`, `geo_pipeline/sewer/v2` and `geo_pipeline/runtime/v12` reject generic, water, gas, stormwater and drainage infrastructure, invalidate unsafe results and publish domain pack v2 plus PMTiles presentation. Full provider verification passed: 188 Python tests, 45 Node tests, 19 frontend tests, smoke check and expected contract-failure probe. The only build observation is the existing non-failing Vite chunk-size warning.

- 2026-08-07 - Completed `MDQ-037` semantic correction: `water-osm/v2` and `geo_pipeline/water/v2` acquire and normalize only explicit water semantics. Generic pipelines and pumping stations without water tags, including gas and sewer representations, are excluded. `geo_pipeline/runtime/v10` invalidates obsolete runtime results; water source evidence records the exclusion rule; and the runtime power descriptor is derived from the canonical live query. Full provider verification passed: 181 Python tests, 45 Node tests, 19 frontend tests, smoke check and expected contract-failure probe. The only build observation is the existing non-failing Vite chunk-size warning.

- 2026-08-07 - Correcting `MDQ-037`: the prior water query admitted generic `man_made=pipeline` and `man_made=pumping_station` candidates because the OSMnx tag profile uses OR semantics. `water-osm/v2` now acquires only explicit water tags, the normalizer requires `pumping=water` or `substance=water` for pumping stations and `substance=water` for generic pipeline geometry, and `geo_pipeline/runtime/v10` invalidates obsolete results. The correction also derives the power API profile from the canonical live query to prevent descriptor drift.

- 2026-08-07 - Completed `MDQ-038`: delivered fixture-first and bounded-AOI OSM gas facilities/pipelines with explicit gas semantics, derived inspection points, KIUT gas as a reference-only overlay and visible source-completeness limitations. `gas-osm/v2` plus `geo_pipeline/runtime/v9` reject generic unlabelled pipelines/valves, invalidate obsolete results and expose OSM candidate, accepted analytical-object and derived inspection-point counts in the AOI preparation view. Full provider verification passed: 180 Python tests, 45 Node tests, 19 frontend tests, smoke check and expected contract-failure probe. The only build observation is the existing non-failing Vite chunk-size warning.

- 2026-08-07 - Corrected `MDQ-038` runtime observability after a successful OSM request could be mistaken for unchanged rendered data. `geo_pipeline/runtime/v9` invalidates count-less state records and returns OSM candidate, accepted analytical-object and derived-inspection-point counts for every refreshed result; committed fixtures retain explicit unavailable counts. The preparation view now shows those counts and the selected circle radius. Focused verification passed: 20 Python gas/runtime tests, 45 Node tests, and 19 frontend tests including build and lint.

- 2026-08-06 - Started `MDQ-038`: corrected the gas OSM acquisition profile after the preview exposed its minimal contract fixture. `gas-osm/v2` retrieves explicit gas substance and valve tags without a broad `man_made=pipeline` query, requires `substance=gas` for valves, invalidates the v1 gas cache identity and keeps the fixture limitation visible until a dated full-AOI source snapshot is available. The runtime worker now validates every ready result against its exact generated `artifact_aoi_id`, rather than the static Rybnik fixture. The AOI UI distinguishes a fresh local cache hit from a new OSM acquisition and, on failure, explicitly states that no snapshot was published and the displayed map was kept. Focused verification passed: 19 Python gas/runtime tests, 45 Node tests, and 19 frontend tests (including build and lint). The full provider script remains pending because its existing large power-pack test did not complete in this execution environment.

- 2026-08-04 - Completed `MDQ-037`: delivered the fixture-first `rybnik_60km/water` domain pack with independently queryable OSM water facilities, pipelines and watercourse categories, derived representative inspection points for non-point geometry, private source/context evidence and explicit BDOT10k topographic limits. Updated worker live refresh and versioned pipeline key to `geo_pipeline/runtime/v7`. Verification passed: 172 Python, 43 Node and 17 frontend tests; clean smoke check and expected contract-failure probe.

- 2026-08-04 - Completed `MDQ-036`: delivered the fixture-first `rybnik_60km/bridges` domain pack with independently queryable OSM bridges, viaducts and crossings categories, derived representative inspection points for non-point geometry, private source/context evidence and explicit BDOT10k topographic limits. Updated worker live refresh and versioned pipeline key to `geo_pipeline/runtime/v6`. Verification passed: 170 Python, 43 Node and 17 frontend tests; clean smoke check and expected contract-failure probe.

- 2026-08-04 - Expanded `MDQ-052` from a static VPS deploy into the artifact-lifecycle and measured-preview-performance deployment ticket. The repository will retain compact contract fixtures and generation/bootstrap logic only; full-AOI source snapshots, GeoJSON, domain packs and PMTiles move to checksum-verified mounted artifact storage. MDQ remains the online provider for a future Steel Sentinel demo, while Steel Sentinel owns its separate offline tile/object download and retention workflow during `SS-INT-001`.

- 2026-08-04 - Corrected `MDQ-053` rendering: compact PMTiles now preserve normalized `road_class`, so MapLibre can render and filter Major, Secondary, Local and Service roads rather than filtering every road away. `transport-osm/v3` invalidates affected runtime results, and the preview permanently displays its numeric zoom beside the low-zoom guidance. Verification passed: 168 Python, 43 Node and 17 frontend tests; smoke check and expected contract-failure probe.

- 2026-08-04 - Completed `MDQ-035`: delivered the fixture-first `rybnik_60km/transport` domain pack with independently queryable OSM roads, railways, stations and aviation categories, linked representative inspection points for non-point geometry, private source/context evidence and explicit BDOT10k topographic limits. The existing AOI runtime now prepares the same bounded `transport-osm/v1` profile for a selected AOI. Offline transport tests, AOI/runtime tests, Node/frontend checks and the full local provider gate passed.

- 2026-08-02 - Completed `MDQ-031`: added versioned deterministic comparison evidence for qualified power vectors. Stable IDs are preferred and bounded geometry plus `asset_type` comparison is limited to comparable records; conflict, source-only and ambiguous outcomes feed structured validation issues and readiness limitations without merging features. WMS, manual-review material and rejected sources remain explicitly not comparable.

- 2026-08-02 - Completed `MDQ-030`: added a dated cache-only source-availability and AOI-coverage report for every registered source, separating availability, coverage, feature state, freshness, eligibility and actionable source gaps. The Node endpoint and preview read only the committed report; optional live probes are isolated from the offline gate.

- 2026-08-02 - Completed `MDQ-028`: added a deterministic NMT/NMPT ASCII Grid adapter with native/processed raster checksums, EPSG:2180 clipping without resampling, CRS/resolution/nodata/AOI validation, and labelled `terrain_sample_points/v1` derived context. Native raster artifacts are now rejected for public vector export.

- 2026-08-02 - Started `MDQ-028`: implementing a deterministic NMT/NMPT ASCII Grid adapter with native/processed checksums, source-CRS clipping, explicit nodata and coverage validation, and a bounded non-risk derived-context interface.

- 2026-08-02 - Completed `MDQ-027`: added the fixture-first Geoportal high-resolution orthophoto WMS adapter and independent Leaflet reference toggle; it exposes published coverage, fixed endpoint/layer safety and explicit missing date/resolution metadata without imagery export, vectorization or download. The accepted manual-seed review is committed as unmodified review state, not provenance.

- 2026-08-02 - Started `MDQ-027`: verifying the official Geoportal high-resolution orthophoto WMS metadata and adding a fixture-first, reference-only preview descriptor.

- 2026-08-02 - Completed `MDQ-026`: added a fixture-first KIUT WMS reference adapter and Leaflet toggles for six allow-listed utility layers, with explicit available/uncovered/unsupported-scale/service-unavailable states and no analytical imagery export.

- 2026-08-02 - Started `MDQ-026`: verifying KIUT WMS capabilities and implementing a fixture-first reference-overlay/coverage descriptor with no analytical GeoJSON output.

- 2026-08-02 - Completed `MDQ-025`: added the bounded, fixture-first BDOT10k GPKG/GeoParquet adapter; verified current 2021-schema classes, source-CRS bounded reads, EPSG:4326 clipping, native-artifact checksum manifests, provenance and explicit schema/artifact drift.

- 2026-08-02 - Started `MDQ-025`: implemented a fixture-first BDOT10k GPKG/GeoParquet adapter for verified current `OT_*` class downloads. WMS GetFeatureInfo remains package discovery only, not a feature API.

- All `G-001` tickets are `Done` with ticket-specific specifications, plans and verification evidence.
- Release-train PRs #3 through #16 are merged to `main` from separate branches in dependency order.
- `./scripts/verify_provider.sh` passes on `main`; PRs #15 and #16 also passed the shared GitHub Actions gate.
- The next provider release is defined in `G-004`, `MDQ-018` through `MDQ-040`, and `MDQ-043` through `MDQ-044`; `MDQ-041` and `MDQ-042` are conditional `G-005` work, while Steel Sentinel consumer integration remains external.

## Recent progress

- 2026-08-03 - Completed `MDQ-034`: delivered the fixture-first `rybnik_60km/public` domain pack with independently queryable OSM administration, education, post and community/social categories, linked representative points for non-point geometry, private source/context evidence and explicit BDOT10k/PRG limits. The existing AOI runtime now prepares the same bounded `public-osm/v1` profile for a selected AOI, without inferring a facility from a building. Offline public tests, AOI/runtime tests, Node/frontend checks and the full local provider gate passed.

- 2026-08-03 - Started `MDQ-034`: preparing the public-services vertical slice after the verified AOI runtime correction landed on `main`.

- 2026-08-03 - Correcting `MDQ-051`: early local runtime-cache entries omitted `contexts` and nullable `artifact_aoi_id`, causing a Node response-schema 502 on cache hit. The correction versions the request identity and rejects incomplete legacy state as a cache miss before it can reach the API. It also replaces the status-only non-fixture path with bounded, qualified OSM acquisition for power/emergency, local atomic domain-pack/PMTiles publication and preview switching to the prepared AOI.

- 2026-08-03 - Completed `MDQ-051`: added `provider_aoi_request/v2`, a bounded PRG-labelled Polish administrative catalogue, stable AOI/request identity, fixture-first catalogued OSM profiles for all required domains, local atomic runtime-result cache and in-process job coalescing. The MapLibre preview now has an AOI settings entry point with point/radius or administrative selection, a visible outline and source-aware category/context states. Only validated Rybnik power/emergency fixture artifacts return `ready`; other AOIs and unfinished domain slices remain explicit source gaps. KIUT/orthophoto stay reference-only, BDOT10k remains topographic context, PRG administrative context and NMT/NMPT derived/raster context. Full local verification passed: 156 Python, 43 Node and 15 frontend tests, plus browser smoke.

- 2026-08-03 - Started `MDQ-051`: validating the AOI/runtime boundary and preparing the required functional specification and technical plan before implementation. The release train order is `MDQ-051`, then `MDQ-034` through `MDQ-040`.

- 2026-08-03 - Prepared `MDQ-051` as one provider-first, end-to-end AOI ticket. It covers the MapLibre settings entry point, point/radius and Polish administrative union selection, deterministic AOI/cache identity, catalogued AOI-aware provider profiles for every required category, local request/job lifecycle and cache-backed analytical or source-labelled reference/context artifacts. Live acquisition remains optional and outside CI; fixtures remain the offline contract evidence. Domain-specific quality completion remains in `MDQ-034` through `MDQ-040`.

- 2026-08-03 - Completed `MDQ-033`: delivered the fixture-first `rybnik_60km/emergency` domain pack. It publishes explicit OSM hospital/fire/police/ambulance-rescue geometries and their inspection points, while PRG K02/K07 police/fire unit areas remain separate source-labelled representative points with original geometry type and response checksum. The generic PMTiles/API preview now inspects points and polygons without conflating sources; no official hospital or ambulance/rescue registry, WMS vectorization or live emergency refresh is claimed. Full offline provider verification passed.

- 2026-08-03 - Completed `MDQ-050`: committed source-verified OSM support, circuit and attribute snapshots; delivered zoom-aware MapLibre voltage cartography, support symbols, source-backed compact popups, circuit selection with verified member highlighting and explicit source-node endpoint evidence. PR #36 passed the required GitHub unit-tests check and merged as `da905e4`.

- 2026-08-03 - Completed `MDQ-048`: added a bounded OSM power-support layer, strict inspectable OSM tag projection, deterministic voltage cartography and a single MapLibre inspector backed by a validated single-feature detail endpoint. Support MVT generation begins at zoom 12 for towers, portals and utility poles and zoom 14 for ordinary poles; it does not send a full support set to the browser at lower zooms. The full offline gate passed: 140 Python, 37 Node and 12 frontend tests.

- 2026-08-02 - Completed `MDQ-047`: derived deterministic, manifest-bound MVT layers into a local PMTiles archive for the public power pack, with 7–14 zoom range, checksum/provenance validation and bounded HTTP range reads. The MapLibre inspection preview now requests compact presentation metadata and only visible tile ranges; canonical GeoJSON/export remains unchanged and KIUT/orthophoto remain external reference-only WMS overlays. Recorded fixture benchmark: 29,732,815-byte full-GeoJSON baseline versus a 13,811,248-byte reusable PMTiles archive addressing 5,608 tiles, so initial map reads no longer load 23,592 features into JavaScript. The offline gate, tests and browser check passed.

- 2026-08-02 - Started `MDQ-047`: implementing an offline MVT/PMTiles presentation artifact and a MapLibre provider preview, while preserving full GeoJSON as the canonical data/export artifact and WMS as a reference-only overlay.

- 2026-08-02 - Completed `MDQ-032`: migrated the Rybnik power demo to a multi-source domain pack with public OSM line and asset layers, private OSM evidence and representative points, plus KIUT WMS provenance retained solely as a non-exportable validation reference. The offline gate passed with 137 Python tests, 34 Node tests and 8 frontend tests.

- 2026-08-02 - Started `MDQ-032`: completing the Rybnik power vertical slice as a multi-source domain pack with preserved OSM source evidence, clipped analytical layers, representative points and KIUT reference-only provenance.

- 2026-08-02 - Completed `MDQ-024`: added the fixture-first PRG WFS/GML adapter, allow-listed A01–A03 and K01–K07 classes, structured source outcomes, EPSG:2180 provenance and bounded clipping; canonical verification stays offline.

- 2026-08-02 - Started `MDQ-024`: verifying the public PRG WFS capability/schema and adding a deterministic administrative-boundary and public-service adapter after MDQ-029 merged as PR #24.

- 2026-08-02 - Completed `MDQ-029`: added a structured free-source eligibility evaluator before OSM acquisition and cache import, enforced it at analytical-cache/public-domain-pack boundaries, and proved free-registration, reference-only, paid, agreement-only and legally unclear outcomes offline.

- 2026-08-02 - Started `MDQ-029`: adding the reusable free-source eligibility boundary before the PRG, BDOT10k, KIUT, orthophoto and NMT/NMPT adapters in the G-004 release train.

- 2026-08-02 - Completed `MDQ-046`: removed Steel Sentinel compatibility exports and simulation fields, renamed the provider GeoJSON contract, regenerated cache/domain-pack artifacts and made the public documentation consumer-neutral.

- 2026-08-02 - Started `MDQ-046`: removing Steel Sentinel compatibility names, simulation semantics and legacy exports so the repository remains a consumer-neutral provider.

- 2026-08-02 - Completed `MDQ-045`: refactored the Leaflet preview into a compact map/layer/feature inspector, kept issue review collapsed, retained the v2 API boundary and verified actual feature selection in the browser.

- 2026-08-02 - Started `MDQ-045`: simplifying the Leaflet provider preview into a compact map, layer and feature-inspection workflow before the next source adapter.

- 2026-08-01 - Completed `MDQ-023`: added manifest-gated v2 Node reads and exports, retained bounded v1 power compatibility, and converted the non-operational preview to manifest-driven toggles, counts, popups, attribution and limitations. The generic path revalidates provenance and excludes restricted/reference artifacts.

- 2026-08-01 - Started `MDQ-023`: replacing the literal power/Rybnik provider shell with validated domain-pack v2 reads, policy-safe export and a manifest-driven, non-operational preview.

- 2026-08-01 - Completed `MDQ-022`: registered the power worker adapter and versioned OSM query catalog, staged fixture/live output and atomically published the v2 domain pack while retaining v1 compatibility; merged as PR #21 after the shared GitHub Actions check passed.

- 2026-08-01 - Completed `MDQ-021`: qualified OSM, PRG, BDOT10k, orthophoto and NMT/NMPT roles with dated primary evidence; kept KIUT reference-only and made utility-vector gaps explicit.

- 2026-08-01 - Started `MDQ-021`: recording dated primary-source evidence and explicit source-role decisions before source adapters.

- 2026-08-01 - Completed `MDQ-020`: added deterministic `provider_aoi/v1` circle and approved PRG-reference resolution, safe cache keys and the Rybnik compatibility alias without live PRG access.

- 2026-08-01 - Started `MDQ-020`: defining deterministic AOI geometry, identity and safe cache-key behavior before generic adapters or v2 API routes.

- 2026-08-01 - Completed `MDQ-019`: added the native-artifact domain-pack v2 manifest, integrity/export policy checks and Rybnik power compatibility pack while retaining v1 readers.
- 2026-08-01 - Started `MDQ-019`: defining a native-artifact, multi-layer domain-pack cache while preserving the v1 Rybnik power cache path.

- 2026-08-01 - Completed `MDQ-018`: replaced the v1 source registry with portable `source_registry/v2` semantics, registered required source families, preserved v1 power-cache and Node API compatibility, and verified Python/TypeScript parity offline.
- 2026-08-01 - Started `MDQ-018`: defining the versioned multi-source registry and public-distribution contract before cache v2, parameterized AOIs or source adapters.

- 2026-07-17 - Defined the provider product boundary, target hybrid architecture and Mapbox portfolio narrative.
- 2026-07-17 - Completed `OPS-001`: added durable goals, execution status, decisions and autonomous ticket execution guidance.
- 2026-07-17 - Completed `OPS-002`: normalized `Now / Next / Later` outcomes, ticket dependencies and readiness; added the quality-rule and issue-review roadmap work.
- 2026-07-17 - Completed `MDQ-001`: added 14 offline tests, standardized Python 3.14.4, updated the FastAPI/Uvicorn/HTTPX2 baseline and removed framework deprecation warnings.
- 2026-07-17 - Separated public Steel Sentinel provider documentation from local portfolio and execution context.
- 2026-07-21 - Started `MDQ-002`: defining normalized validation statuses and source-aware readiness semantics.
- 2026-07-21 - Completed `MDQ-002`: normalized validation status aliases, exposed catalog readiness and metrics, removed false-positive issues for passing reports, and added offline coverage for OSM, manual and reference-only sources.
- 2026-07-21 - Started `MDQ-003`: defining source classification, confidence, limitations and simulation suitability for catalog entries.
- 2026-07-21 - Completed `MDQ-003`: added source type, confidence, limitations and simulation suitability to catalog entries; made KIUT/GESUT WMS explicit as a reference overlay; updated TypeScript contract and public architecture documentation.
- 2026-07-21 - Started `MDQ-005`: defining the provider-owned Steel Sentinel GeoJSON layer contract before cache and Node-provider work.
- 2026-07-21 - Completed `MDQ-005`: added a versioned provider-owned GeoJSON normalizer and validator, a representative Rybnik contract fixture, offline schema tests and public contract documentation.
- 2026-07-22 - Started `MDQ-016`: defining source-aware, versioned data-quality rules and issue evidence before cache layout work.
- 2026-07-22 - Completed `MDQ-016`: added versioned, source-aware quality rules with explicit applicability and outcomes; API issues now carry rule evidence and structured severity informs readiness.
- 2026-07-22 - Started `MDQ-004`: creating the cache-first AOI/domain artifact layout for the Rybnik power provider layer.
- 2026-07-22 - Completed `MDQ-004`: committed a full normalized Rybnik power-lines cache with provenance and readiness records plus offline cache read validation.
- 2026-07-22 - Started `MDQ-006`: scaffolding the Node/Express/TypeScript provider service layer against the completed file-cache contract.
- 2026-07-22 - Completed `MDQ-006`: added the independently runnable Node/Express/TypeScript service shell with a Zod-validated health endpoint, route/service/type separation and isolated API tests.
- 2026-07-22 - Started `MDQ-013`: defining a portable source registry and provenance rules before the Node provider exposes cached artifacts and sources.
- 2026-07-22 - Completed `MDQ-013`: added a portable source registry for OSM, manual input and KIUT/GESUT WMS; analytical cache provenance is now validated and public attribution/reference-overlay rules are documented.
- 2026-07-22 - Started `MDQ-007`: exposing only validated local cache and source-registry artifacts through the Node provider API.
- 2026-07-22 - Completed `MDQ-007`: added typed, read-only Node routes for cached layers, readiness and source records with validated error responses and no extraction side effects.
- 2026-07-22 - Completed `MDQ-017`: added a durable provider-owned issue-review store, lifecycle and conflict-safe Node API, generated-evidence snapshot checks, and a non-operational preview review panel.
- 2026-07-22 - Completed `MDQ-014`: unified Python, Node and frontend verification in one offline gate; added a controlled contract-failure probe and a passing pull-request GitHub Actions workflow.
- 2026-07-22 - Completed `MDQ-015`: published an endpoint-verified 3–5 minute provider demo, corrected the one-layer export narrative, documented the OpenInfraMap distinction and finalized the private CV/interview wording.
- 2026-07-22 - Prepared the proposed `G-004` source-first, multi-domain roadmap: native source contracts, parameterized AOIs, PRG/BDOT10k/KIUT/orthophoto/NMT adapters, a free-source-only eligibility gate, nine required domain vertical slices and a verified multi-domain export; telecom and district heating remain conditional `G-005` work.

## Status update rules

- Keep this file a short current snapshot; do not copy the complete backlog here.
- Update it when a ticket starts, completes or becomes genuinely blocked.
- Record progress only after files or verification evidence exist.
- Use `docs/local/tickets.md` for ticket-level status and `docs/local/GOALS.md` for outcome-level status.
