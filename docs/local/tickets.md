# Map Data Quality Lab Tickets

Status: active

Product baselines: `README.md`, `docs/architecture.md`

Backlog source of truth: this file

Portfolio goal: Mapbox-relevant geospatial data provider with a Steel Sentinel-compatible export contract

## Project Operations

### OPS-001 - Add Goal-Driven Execution Workflow

Priority: P0

Status: Done

Goal: `G-001`

Depends on: None

Type: developer workflow

Repo area: `docs/local/`, `.codex/skills/`

Objective: let Robert assign a ticket through a persistent Codex `/goal` and have the agent carry it from preparation through verified completion using durable repository context.

Specification:

- [`specs/OPS-001/functional_spec.md`](./specs/OPS-001/functional_spec.md)
- [`specs/OPS-001/technical_plan.md`](./specs/OPS-001/technical_plan.md)

Acceptance criteria:

- [x] Repository guidance defines canonical context, goal execution and evidence-based completion.
- [x] Outcome goals, current status and durable decisions have separate tracked sources of truth.
- [x] The project spec-driven skill supports end-to-end goal execution without weakening spec-only or plan-only modes.
- [x] Skill and documentation verification pass.
- [x] No `MDQ-*` product behavior is changed.

Verification: skill validation passed, required workflow references were resolved and `git diff --check` reported no errors on 2026-07-17.

### OPS-002 - Normalize Goals, Roadmap and Ticket Dependencies

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `OPS-001`

Type: developer workflow

Repo area: `docs/local/`, `docs/architecture.md`

Objective: convert the accepted product direction and course-inspired context-management practices into one complete, dependency-aware execution roadmap.

Specification:

- [`specs/OPS-002/functional_spec.md`](./specs/OPS-002/functional_spec.md)
- [`specs/OPS-002/technical_plan.md`](./specs/OPS-002/technical_plan.md)

Acceptance criteria:

- [x] Goals use outcome-oriented `Now / Next / Later` horizons with milestone exit evidence.
- [x] Every ticket declares its goal and dependencies, and only executable work is `Ready`.
- [x] Missing quality-rule and issue-review work is represented by bounded tickets.
- [x] AOI, provenance, CI and integration-narrative gaps are covered by owning tickets.
- [x] Architecture phases and suggested execution order respect ticket dependencies.
- [x] No application behavior is changed.

Verification: all 20 ticket records have complete planning metadata; 18 product/external tickets have a dependency-valid execution order; `MDQ-001` is the only `Ready` ticket; local Markdown links and whitespace checks passed on 2026-07-17.

## Working Rules

- Keep this repo focused on map-data provider responsibilities.
- Keep Steel Sentinel C2, RAG, operational UI, disruption simulation, units and cascading effects out of this repo.
- Use source-role metadata rather than assuming every analytical vector comes from OSM.
- Treat KIUT/GESUT WMS as reference overlays only; PRG and BDOT10k may be official analytical vectors after adapter validation.
- Keep manual seeds explicitly non-authoritative.
- Preserve native raw formats and use provider-owned GeoJSON/JSON manifests as the normalized consumer contract.
- Target architecture: Node.js + Express + TypeScript provider API, Python geospatial worker.
- Work on one product ticket at a time and make its result immediately testable before advancing.
- Mark a ticket `Ready` only when its dependencies are `Done`, scope and acceptance criteria are clear, and no material product decision is unresolved.
- Keep future work `Todo`; `docs/local/PROJECT_STATUS.md` names the single next executable ticket instead of duplicating the backlog.

## Required Verification Gates

Before Steel Sentinel consumes provider output, tests must verify every stage of the pipeline:

- Source input: source definitions, access/distribution metadata and fixtures are valid and domain-scoped.
- Extraction: Python worker can produce or register native raw and cached domain artifacts for an AOI without treating WMS as vector data.
- Normalization: provider-owned fields and multi-source provenance are present, while source-specific schemas do not become the consumer contract.
- Validation: geometry, feature counts, source metadata and required properties are checked.
- Readiness: confidence, missing fields, limitations and `usable_for_simulation` are derived consistently.
- Cache: cached reads do not trigger duplicate extraction work.
- Node API: all public provider endpoints return the documented contracts and errors.
- Export: `steel-sentinel-pack` contains domain layers, metadata, readiness and all source records used by the pack.
- Consumer contract: Steel Sentinel can rely on provider data without calling Overpass, Geoportal or other upstream source services directly.

## Multi-Source Domain Definition of Done

Every required domain ticket in `G-004` must deliver a complete, testable vertical slice:

- A versioned source/query mapping identifies every qualified free analytical and reference source used by the domain.
- Raw evidence is stored or referenced in its native format. Vector inputs also produce normalized and AOI-clipped provider GeoJSON; raster and WMS inputs retain an explicit native/reference contract instead of fake GeoJSON.
- The domain pack contains one or more role-named layers plus a representative-points layer where that improves inspection. If points are not meaningful, the manifest records an explicit reason.
- Validation covers geometry or raster/service metadata, empty output, duplicates, required normalized attributes, CRS/AOI consistency, source provenance and known coverage gaps.
- Readiness and issues distinguish missing source data from invalid data and never claim real-world completeness from a passing schema check.
- Node API and Steel Sentinel-compatible export expose the domain manifest, processed layers, readiness, sources and limitations.
- The provider dev-preview has a catalog-driven toggle, metadata popup, feature count and visible source/limitation information for the domain.
- Offline fixtures exercise the complete worker-to-cache-to-API-to-preview contract; live source probes remain optional diagnostics rather than release-gate dependencies.
- No layer is presented as live operational state, infrastructure criticality or a simulation result.

Proposed tickets intentionally receive their own `functional_spec.md` and `technical_plan.md` only when execution starts. This keeps ticket scope canonical here without manufacturing implementation detail before dependencies are complete.

## Milestone 1 - Stabilize Current Provider Prototype

### MDQ-001 - Fix Python Prototype Verification

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `OPS-002`

Type: maintenance

Repo area: `backend/`

Objective: make the current FastAPI/Python prototype verifiable before adding the Node provider layer.

Specification:

- [`specs/MDQ-001/functional_spec.md`](./specs/MDQ-001/functional_spec.md)
- [`specs/MDQ-001/technical_plan.md`](./specs/MDQ-001/technical_plan.md)

Scope:

- Add the missing test dependency required by `fastapi.testclient`.
- Ensure `uv run python tests/smoke_check.py` passes.
- Keep the existing FastAPI endpoints working while they serve as the prototype.
- Add or keep pytest-compatible tests for the Python-side service and pipeline helpers.
- Standardize local development on Python 3.14 and update FastAPI, Starlette-through-FastAPI, Uvicorn and the TestClient transport to Python 3.14-compatible stable releases.
- Keep the verification suite free from framework deprecation warnings under the selected Python runtime.
- Do not add new product behavior in this ticket.

Acceptance criteria:

- [x] `cd backend && uv run python tests/smoke_check.py` passes.
- [x] The smoke check verifies health, catalog, issues and metrics endpoints.
- [x] Python tests can be run repeatedly without live Overpass access.
- [x] Dependency changes are documented in `backend/pyproject.toml`.
- [x] Python 3.14 is selected explicitly and the lockfile resolves only the supported 3.14 runtime range.
- [x] FastAPI, Uvicorn and HTTPX2 are updated to stable Python 3.14-compatible releases.
- [x] Smoke and pytest complete without framework deprecation warnings.

Verification: Python 3.14.4 is selected by `backend/.python-version`; the lockfile resolves Python `3.14.*`, FastAPI 0.139.2, Starlette 1.3.1, Uvicorn 0.51.0 and HTTPX2 2.7.0. Offline smoke passed with `PYTHONWARNINGS=error`; pytest reported `14 passed` with `-W error`; the exact documented smoke command passed; a real Uvicorn process returned `200 {"status":"ok"}` from `/api/health`; lock and locked offline sync checks passed.

### MDQ-002 - Normalize Validation Status and Readiness Semantics

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-001`

Type: backend/data-quality

Repo area: `backend/app/main.py`, `backend/data/reports/`

Objective: make quality/readiness metrics meaningful by treating existing report statuses correctly.

Scope:

- Normalize validation statuses such as `pass`, `ok`, `success`, `valid`.
- Avoid generating quality issues for passing reports purely because the status string is `pass`.
- Define provider-facing readiness values such as `ready`, `usable_with_limitations`, `needs_source`, `not_usable`.
- Keep issue generation source-aware: OSM-derived, manual seed, reference-only.
- Add tests for status normalization, issue generation and readiness derivation.

Acceptance criteria:

- Catalog entries expose normalized quality/readiness fields.
- Passing validation reports do not generate false-positive quality issues.
- Manual seed and KIUT/WMS reference-only issues remain explicit.
- Smoke check covers the normalized metrics.
- Tests cover at least one passing OSM layer, one manual seed layer and one WMS/reference-only source.

Specification:

- [`specs/MDQ-002/functional_spec.md`](./specs/MDQ-002/functional_spec.md)
- [`specs/MDQ-002/technical_plan.md`](./specs/MDQ-002/technical_plan.md)

Verification: `PYTHONWARNINGS=error uv run --offline python tests/smoke_check.py` passed with `layers=4 issues=3`; `uv run --offline pytest -q -W error` reported `29 passed` on 2026-07-21. API evidence: passing OSM layers are `ready`, manual seeds are `usable_with_limitations`, the unvalidated hex report is `needs_source`, and the manual/WMS issues remain explicit.

### MDQ-003 - Add Source, Confidence and Limitations to Provider Outputs

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-002`

Type: data contract

Repo area: `backend/app/main.py`, `frontend/src/types/api.ts`

Objective: expose the metadata Steel Sentinel needs to decide whether provider layers are suitable for simulation.

Scope:

- Extend layer catalog entries with `source_type`, `confidence`, `limitations` and `usable_for_simulation`.
- Ensure manual seed layers are marked `not_authoritative`.
- Ensure KIUT/GESUT references are marked `reference_overlay` and not analytical vectors.
- Update TypeScript types used by the dev-preview frontend.
- Add contract tests or snapshot tests for catalog and feature metadata.

Acceptance criteria:

- Catalog API exposes source/confidence/limitations consistently.
- Frontend types compile against the expanded provider contract.
- OSM, manual seed and WMS/reference data are distinguishable without reading docs.
- Contract tests fail if required metadata fields are removed.

Specification:

- [`specs/MDQ-003/functional_spec.md`](./specs/MDQ-003/functional_spec.md)
- [`specs/MDQ-003/technical_plan.md`](./specs/MDQ-003/technical_plan.md)

Verification: `PYTHONWARNINGS=error uv run --offline python tests/smoke_check.py` passed with `layers=5 issues=3`; `uv run --offline pytest -q -W error` reported `30 passed`; `npm run build` and `npm run lint` passed on 2026-07-21. Contract coverage verifies OSM as `analytical_vector`, manual seeds as `manual_seed`, KIUT/GESUT WMS as `reference_overlay`, and fails when required metadata is absent.

## Milestone 2 - Define GeoJSON, Quality Rules and Cache Contract

### MDQ-016 - Define Data-Quality Rules and Issue Contract

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-002`, `MDQ-003`, `MDQ-005`

Type: data-quality contract

Repo area: `backend/geo_pipeline/`, `backend/app/`, `docs/architecture.md`

Objective: turn validation output into explainable, source-aware issues that the API and dev-preview can rely on.

Scope:

- Define rule identifiers and applicability by source type and domain.
- Cover invalid geometry, missing required attributes, empty layers, suspicious duplicates, unsupported geometry types and inconsistent source metadata.
- Define issue fields including severity, evidence, recommendation, affected feature/layer and rule version.
- Prevent reference overlays or manual seeds from being judged by analytical-vector rules that do not apply to them.
- Add fixture-based tests for triggered, non-triggered and not-applicable rules.

Acceptance criteria:

- [x] The issue contract is documented and versioned.
- [x] Each generated issue identifies the rule, severity, evidence, source classification and affected object or layer.
- [x] Tests distinguish pass, fail and not-applicable outcomes across OSM, manual seed and reference-overlay fixtures.
- [x] Readiness derivation can consume issue severity without parsing human-readable messages.
- [x] Rule evaluation runs without live network access.

Specification:

- [`specs/MDQ-016/functional_spec.md`](./specs/MDQ-016/functional_spec.md)
- [`specs/MDQ-016/technical_plan.md`](./specs/MDQ-016/technical_plan.md)

Verification: `PYTHONWARNINGS=error uv run --offline pytest -q -W error` reported `41 passed`; `PYTHONWARNINGS=error uv run --offline python tests/smoke_check.py` passed with `layers=5 issues=3`; `npm run build` and `npm run lint` passed on 2026-07-22. Fixture coverage proves passed, triggered and not-applicable results for analytical, manual and reference sources, plus structured severity-derived readiness and unknown-source metadata failure.

### MDQ-004 - Introduce AOI/Domain Cache Layout

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-005`, `MDQ-016`

Type: data pipeline

Repo area: `backend/data/cache/`, `backend/geo_pipeline/`

Objective: make provider reads cache-first so Steel Sentinel does not repeatedly trigger expensive Overpass work.

Scope:

- Add cache layout:

```text
backend/data/cache/{aoi_id}/{domain}/layer.geojson
backend/data/cache/{aoi_id}/{domain}/metadata.json
backend/data/cache/{aoi_id}/{domain}/readiness.json
```

- Move or copy the current Rybnik power artifacts into the new cache layout.
- Record source query, snapshot timestamp, AOI, domain, feature count, validation status and limitations.
- Keep existing processed/report artifacts until the new cache path is fully adopted.
- Add tests that verify cache existence, metadata schema and cache read behavior.

Acceptance criteria:

- [x] `rybnik_60km/power` exists in the cache layout.
- [x] Metadata file identifies OSM as the analytical vector source.
- [x] Readiness file describes whether the layer is usable for Steel Sentinel.
- [x] Existing endpoints can still serve the current data.
- [x] Cache tests prove that a valid cached layer can be read without invoking extraction.

Specification:

- [`specs/MDQ-004/functional_spec.md`](./specs/MDQ-004/functional_spec.md)
- [`specs/MDQ-004/technical_plan.md`](./specs/MDQ-004/technical_plan.md)

Verification: `PYTHONWARNINGS=error uv run --offline pytest -q -W error` reported `45 passed`; `PYTHONWARNINGS=error uv run --offline python tests/smoke_check.py` passed with `layers=5 issues=3`; `npm run build` and `npm run lint` passed on 2026-07-22. Cache tests prove complete offline read, missing-file and count-mismatch rejection, and absence of extraction during reads; the committed cache contains 16,505 normalized OSM power-line features.

### MDQ-005 - Define Steel Sentinel GeoJSON Layer Contract

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-003`

Type: API/data contract

Repo area: `docs/architecture.md`, `backend/data/cache/`

Objective: define the exact GeoJSON shape consumed by Steel Sentinel.

Scope:

- Add provider-owned `FeatureCollection.metadata`.
- Add required feature properties: `source`, `source_id`, `domain`, `asset_type`, `confidence`, `missing_fields`, `limitations`, `usable_for_simulation`.
- Preserve useful OSM tags without making Steel Sentinel depend on raw OSM tagging.
- Document which fields are required, optional and derived.
- Add schema tests for the GeoJSON layer contract.

Acceptance criteria:

- [x] A sample cached layer follows the contract.
- [x] Contract is documented in `docs/architecture.md` or a linked spec file.
- [x] Steel Sentinel can consume a layer without knowing Overpass or OSM tag details.
- [x] Schema tests validate `FeatureCollection.metadata` and required feature properties.

Specification:

- [`specs/MDQ-005/functional_spec.md`](./specs/MDQ-005/functional_spec.md)
- [`specs/MDQ-005/technical_plan.md`](./specs/MDQ-005/technical_plan.md)

Verification: `PYTHONWARNINGS=error uv run --offline pytest -q -W error` reported `34 passed`; `PYTHONWARNINGS=error uv run --offline python tests/smoke_check.py` passed with `layers=5 issues=3`; `npm run build` and `npm run lint` passed on 2026-07-21. Tests validate the sample fixture, malformed root/feature fields, timestamp, feature count, geometry and provider-owned normalization with optional preserved OSM tags.

## Milestone 3 - Add Node/Express Provider API

### MDQ-006 - Scaffold `backend-node` Express TypeScript API

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-004`

Type: backend-node

Repo area: `backend-node/`

Objective: create the target Mapbox-aligned provider service layer.

Scope:

- Add Node.js + Express + TypeScript project in `backend-node/`.
- Add route/service/type structure:

```text
backend-node/src/
  app.ts
  server.ts
  routes/
  services/
  types/
```

- Add request/response validation with Zod.
- Add tests with Jest or Vitest and Supertest.
- Add scripts: `dev`, `build`, `test`, `lint` if lint tooling is included.

Acceptance criteria:

- [x] `cd backend-node && npm run build` passes.
- [x] `cd backend-node && npm test` passes.
- [x] `GET /api/health` returns provider status.
- [x] Supertest is configured for API endpoint tests.
- [x] README local development commands are accurate.

Verification: `npm run build`, `npm test` and `npm run lint` passed in `backend-node` on 2026-07-22. The Vitest/Supertest suite reported `2 passed`; it verifies the Zod-validated `GET /api/health` response and that an unimplemented cache route returns `404`.

### MDQ-007 - Implement Read-Only Layer and Readiness Endpoints in Node

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-006`, `MDQ-013`

Type: backend-node/API

Repo area: `backend-node/src/`, `backend/data/cache/`

Objective: make Node/Express the public provider API over cached artifacts.

Scope:

- Implement:
  - `GET /api/aoi/:aoiId/layers`
  - `GET /api/aoi/:aoiId/layers/:domain`
  - `GET /api/aoi/:aoiId/readiness`
  - `GET /api/aoi/:aoiId/sources`
- Read from cached GeoJSON, metadata and readiness JSON.
- Return clear 404/422 responses for missing AOI/domain values.
- Do not trigger Python worker yet.
- Add API tests for every implemented endpoint.

Acceptance criteria:

- [x] Rybnik power layer can be fetched through Node API.
- [x] API returns cached GeoJSON without calling Overpass.
- [x] API tests cover success and missing-cache cases.
- [x] API tests cover invalid AOI/domain input and response schema.
- [x] FastAPI is no longer the documented target public provider API.

Verification: `npm run build`, `npm test` and `npm run lint` passed in `backend-node` on 2026-07-22. Vitest reported `8 passed`; endpoint coverage validates cached layer, readiness and source responses, missing cache/domain and malformed AOI responses against the Zod contracts.

### MDQ-008 - Add Steel Sentinel Layer-Pack Export Endpoint

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-007`, `MDQ-010`, `MDQ-013`

Type: backend-node/API

Repo area: `backend-node/src/`

Objective: provide a single export contract that Steel Sentinel can consume or download.

Scope:

- Implement `GET /api/aoi/:aoiId/exports/steel-sentinel-pack`.
- Include selected domains, metadata, readiness report and source registry.
- Start with `power` for `rybnik_60km`.
- Keep output as JSON/GeoJSON bundle; no vector tiles yet.
- Add export contract tests.

Acceptance criteria:

- [x] Endpoint returns a complete provider pack for `rybnik_60km`.
- [x] Pack includes layer GeoJSON, metadata, readiness and sources.
- [x] Response clearly distinguishes analytical vectors from reference overlays.
- [x] Export tests fail if any required pack section is missing.

Verification: `npm run build`, `npm test` and `npm run lint` passed in `backend-node` on 2026-07-22; Vitest reported `14 passed`, including a validated complete pack and missing-cache response.

## Milestone 4 - Connect Python Worker to Provider Workflow

### MDQ-009 - Add Python Worker CLI Contract

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-004`

Type: geospatial worker

Repo area: `backend/geo_pipeline/`

Objective: make Python processing callable from Node through a stable CLI.

Scope:

- Add or standardize a command like:

```bash
uv run python -m geo_pipeline.extract --aoi rybnik_60km --domain power
```

- Ensure the worker writes cache artifacts to the agreed layout.
- Return structured exit codes and machine-readable error output.
- Keep live Overpass calls optional during development by supporting cached/raw input.
- Add tests for worker CLI success, failure and artifact generation using fixtures.

Acceptance criteria:

- [x] Worker can generate or refresh `rybnik_60km/power` cache artifacts.
- [x] Worker failures do not produce partial valid-looking cache.
- [x] CLI behavior is documented.
- [x] Worker tests run without network by default.

Verification: `uv run --offline pytest -q -W error` reported `52 passed`; the fixture CLI generated a complete Rybnik power cache and returned JSON success on 2026-07-22.

### MDQ-010 - Add Cache-First AOI Request Workflow

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-007`, `MDQ-009`

Type: backend-node/orchestration

Repo area: `backend-node/src/services/`

Objective: let the provider handle AOI/domain requests while avoiding duplicate extraction work.

Scope:

- Implement `POST /api/aoi/requests`.
- Define and validate a provider-owned AOI registry/schema, starting with `rybnik_60km`, including boundary reference, CRS and allowed domains.
- Check cache freshness before running the Python worker.
- Define cache freshness metadata and the rule used to classify a snapshot as fresh or stale.
- Return request status, cache status and artifact metadata.
- For MVP, direct CLI invocation is acceptable; no queue required.
- Add orchestration tests with mocked worker execution.

Acceptance criteria:

- [x] Request for existing `rybnik_60km/power` returns cached result.
- [x] Missing or stale cache can trigger the Python worker.
- [x] Response states whether the result came from cache or refresh.
- [x] Unknown AOIs, unsupported domains and invalid AOI/domain combinations return documented validation errors.
- [x] Tests cover AOI boundary metadata and deterministic fresh/stale decisions.
- [x] Errors from worker are propagated as structured API errors.
- [x] Tests verify cache hit, cache miss, worker success and worker failure paths.

Verification: `npm run build`, `npm test` and `npm run lint` passed in `backend-node` on 2026-07-22; Vitest reported `12 passed` including mock-based fresh, missing, stale and worker-failure paths.

### MDQ-011 - Add Pipeline Stage Test Suite

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-008`, `MDQ-010`, `MDQ-013`, `MDQ-016`

Type: verification/pipeline

Repo area: `backend/`, `backend-node/`, `backend/data/cache/`

Objective: provide test coverage for every stage between source data and Steel Sentinel-facing output.

Scope:

- Add Python tests for extraction fixtures, normalization, validation and readiness generation.
- Add JSON schema or Zod-based contract tests for cached GeoJSON, metadata and readiness files.
- Add Node API tests for layer, readiness, source and export endpoints.
- Add orchestration tests proving cache-first behavior and controlled worker invocation.
- Add a single verification command or documented sequence that exercises the full provider path without live Overpass.

Required stages:

```text
source fixture/query
  -> Python extraction/normalization
  -> validation/readiness
  -> cache artifacts
  -> Node provider API
  -> steel-sentinel-pack export
```

Acceptance criteria:

- [x] Tests can verify a provider build without network access.
- [x] Tests fail if GeoJSON contract fields are missing.
- [x] Tests fail if WMS/reference overlays are exposed as analytical vectors.
- [x] Tests fail if cached provider reads invoke extraction unnecessarily.
- [x] Tests verify the exported pack contains layer GeoJSON, metadata, readiness and source registry.

Verification: `./scripts/verify_provider.sh` passed on 2026-07-22: Python reported `53 passed`, smoke check passed, Node reported `14 passed` with build/lint, and frontend build/lint passed.

## Milestone 5 - Provider Dev Preview, Issue Review and Source Literacy

### MDQ-012 - Align Dev-Preview UI with Provider Contract

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-007`, `MDQ-016`

Type: frontend/dev-preview

Repo area: `frontend/src/`

Objective: keep the existing frontend as a provider inspection tool, not a separate data-review product.

Scope:

- Rename visible copy from generic review workflow to provider/dev-preview language.
- Load data from Node provider API once available.
- Show feature source, confidence, missing fields and limitations in popups.
- Keep UI lightweight; do not build Steel Sentinel operator UI here.

Acceptance criteria:

- [x] Dev-preview map shows provider layers from the provider API.
- [x] Popups expose provider metadata, not just raw OSM fields.
- [x] UI copy does not imply C2/simulation features belong in this repo.

Verification: `npm run build` and `npm run lint` passed in `frontend` on 2026-07-22. The frontend now requests Node provider routes through the Vite `/api` proxy and renders provider-owned feature metadata.

### MDQ-013 - Document Reference Overlay Registry

Priority: P2

Status: Done

Goal: `G-001`

Depends on: `MDQ-003`, `MDQ-005`

Type: source metadata

Repo area: `backend/data/`, `docs/architecture.md`

Objective: preserve KIUT/GESUT knowledge without treating WMS overlays as analytical vector sources.

Scope:

- Add a source registry entry for KIUT/GESUT WMS reference overlays.
- Include endpoint, role, limitations, availability caveats, attribution and license obligations.
- Record OSM/ODbL attribution, source or query URL, snapshot timestamp and pipeline/query version for analytical snapshots.
- Expose reference overlays through `GET /api/aoi/:aoiId/sources`.
- Document that WMS is raster/reference, not simulation input.
- Add tests for source registry classification.

Acceptance criteria:

- [x] Source registry contains OSM, manual seed and KIUT/GESUT WMS entries.
- [x] API consumers can distinguish `analytical_vector`, `manual_seed` and `reference_overlay`.
- [x] Documentation explicitly rejects WMS-to-GeoJSON as a default path.
- [x] Cached analytical artifacts can be traced to source/query, snapshot time and pipeline/query version.
- [x] README or demo output contains the attribution required for distributed OSM-derived data.
- [x] Tests fail if KIUT/GESUT WMS is classified as analytical vector data.

Verification: `uv run --offline pytest -q -W error` reported `49 passed`; `uv run --offline python tests/smoke_check.py` passed with `layers=5 issues=3` on 2026-07-22. Registry checks confirm all three source classes and cache provenance; tests reject KIUT/GESUT WMS as an analytical vector and a cache record without `query_version`.

### MDQ-017 - Add Data-Quality Issue Review Workflow

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-012`, `MDQ-016`

Type: backend-node/frontend

Repo area: `backend-node/src/`, `frontend/src/`, provider-owned review storage

Objective: let a reviewer record a durable decision on generated quality issues and make that state visible in readiness inspection.

Scope:

- Define the lifecycle `open -> acknowledged -> resolved | accepted | ignored` and allowed transitions.
- Persist review status, reviewer note, created/updated timestamps and issue/rule identity using the simplest provider-owned storage suitable for the MVP.
- Add read/update API contracts with validation and conflict handling.
- Add dev-preview controls and filters for issue state without turning the UI into an operational C2 workflow.
- Keep generated issue evidence separate from human review decisions.

Acceptance criteria:

- Review state survives an API restart and can be retrieved with the issue.
- Invalid state transitions and malformed updates are rejected with documented errors.
- Dev-preview can filter issues and update an allowed state with an optional note.
- Regenerating issues preserves review state when stable issue identity still matches and does not silently attach it to a different issue.
- API, persistence and UI behavior have repeatable tests.

Specification:

- [`specs/MDQ-017/functional_spec.md`](./specs/MDQ-017/functional_spec.md)
- [`specs/MDQ-017/technical_plan.md`](./specs/MDQ-017/technical_plan.md)

Verification: `cd backend-node && npm test && npm run build && npm run lint` passed with `21` tests; `cd frontend && npm test && npm run build && npm run lint` passed with `3` review-workflow tests; `cd backend && uv run --offline pytest -q -W error` passed with `54` tests on 2026-07-22. Node route tests cover valid persistence across fresh app instances, malformed updates, invalid transitions, sequential and concurrent stale-update conflicts, and changed stable identities. Frontend tests cover allowed lifecycle controls, terminal states and filtering. The Python snapshot test keeps cached generated issue evidence synchronized with the current rule output.

## Milestone 6 - Verification, Documentation and Portfolio Packaging

### MDQ-014 - Add Verification Baseline for Hybrid Provider

Priority: P0

Status: Done

Goal: `G-001`

Depends on: `MDQ-011`, `MDQ-012`, `MDQ-017`

Type: verification

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: give the project a reliable command set for demo and recruiting review.

Scope:

- Python smoke check passes.
- Node build and API tests pass.
- Pipeline stage test suite passes.
- Frontend build/lint either pass or documented exceptions are fixed.
- Add a GitHub Actions workflow that runs the supported Python, Node and frontend quality gates on pull requests.
- Add verification commands to README.

Acceptance criteria:

- README verification section reflects real commands.
- Running documented checks produces passing results.
- Verification covers source fixture/query, extraction, normalization, validation, cache, Node API and export.
- Local documented checks and CI execute the same underlying commands.
- A deliberately failing contract test is demonstrably able to fail the CI job.
- Any known non-blocking exceptions are documented with rationale.

Specification:

- [`specs/MDQ-014/functional_spec.md`](./specs/MDQ-014/functional_spec.md)
- [`specs/MDQ-014/technical_plan.md`](./specs/MDQ-014/technical_plan.md)

Verification: `./scripts/verify_provider.sh` passed locally on 2026-07-22 with `54` Python tests, FastAPI smoke (`layers=5 issues=3`), the expected negative contract probe, `21` Node tests/build/lint and `3` frontend tests/build/lint. Workflow YAML parsed locally. GitHub Actions run `29903249466` completed successfully on PR #15, including Python 3.14.4, uv 0.11.9 and Node 22 setup, dependency installation and the same canonical script. No non-blocking test exceptions remain; dependency installation is intentionally online, while the application gate is offline after setup.

### MDQ-015 - Create Provider Demo Script and CV Narrative

Priority: P1

Status: Done

Goal: `G-001`

Depends on: `MDQ-014`

Type: documentation

Repo area: `README.md`, `docs/architecture.md`, optional `docs/demo.md`

Objective: make the project understandable in 3-5 minutes for Mapbox-style review.

Scope:

- Write a short demo script:
  - A Steel Sentinel-compatible client requests `rybnik_60km/power`.
  - Provider serves cached OSM-derived GeoJSON.
  - Provider reports source, confidence and limitations.
  - KIUT/GESUT is shown as reference-only.
  - The export is ready for Steel Sentinel consumption; actual cross-repo consumption remains `SS-INT-001`.
- Keep the narrative focused on data tooling and provider architecture.
- Avoid presenting attack simulation, C2 decisions or RAG as part of this repo.

Acceptance criteria:

- Demo script exists and matches implemented endpoints.
- CV bullet matches current architecture.
- Public wording does not claim completed Steel Sentinel integration while `SS-INT-001` remains `External`.
- README explains why this is not an OpenInfraMap clone.

Specification:

- [`specs/MDQ-015/functional_spec.md`](./specs/MDQ-015/functional_spec.md)
- [`specs/MDQ-015/technical_plan.md`](./specs/MDQ-015/technical_plan.md)

Verification: all documented health, read-only layer, layer-pack, source-registry and issue-list commands passed against the Node provider on port 3001 on 2026-07-22; the read-only layer check confirmed `16,505` features and `usable_with_limitations`. `./scripts/verify_provider.sh` passed with `54` Python tests/smoke, the expected negative probe, `21` Node tests/build/lint and `3` frontend tests/build/lint. Public wording searches found no Mapbox/portfolio/recruiter/CV positioning and confirmed explicit Steel Sentinel-compatible/external-integration boundaries. README links to tracked `docs/demo.md` and explains the OpenInfraMap distinction; the final CV bullet and interview pitch are stored only under ignored `docs/local/strategy/`.

## Milestone 7 - Define Multi-Source, Native-Artifact and AOI Contracts

### MDQ-018 - Define Multi-Source Registry and Distribution Contract

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `G-001`

Type: source/data contract

Repo area: `backend/data/sources/`, `backend/geo_pipeline/`, `backend-node/src/types/`, `docs/architecture.md`

Objective: replace the v1 three-class source model with a contract that can describe free community data, official vectors, analytical rasters and rendered reference services independently of domain while rejecting non-free candidates.

Scope:

- Define `source_registry/v2` fields for data kind, authority, access, analytical/reference role, attribution, license and distribution policy.
- Allow a layer and domain pack to retain ordered provenance from multiple sources.
- Register OpenStreetMap (OSM), PRG, BDOT10k, KIUT, orthophoto and NMT/NMPT source families.
- Define an explicit compatibility and migration path for v1 cache/source records.
- Keep live availability outside schema validation and the offline test gate.

Acceptance criteria:

- [x] Python and TypeScript validate identical v2 source semantics and reject incomplete or contradictory records.
- [x] Analytical, reference and raster roles are expressed without treating authority, format and access as one enum.
- [x] Distribution policy can prevent non-free data or rendered imagery from entering a public export.
- [x] Existing v1 `rybnik_60km/power` artifacts remain readable during migration.
- [x] Public architecture and fixture tests document every registered source family honestly.

Specification:

- [`specs/MDQ-018/functional_spec.md`](./specs/MDQ-018/functional_spec.md)
- [`specs/MDQ-018/technical_plan.md`](./specs/MDQ-018/technical_plan.md)

Verification: `./scripts/verify_provider.sh` passed on 2026-08-01 with `59` Python tests/smoke and the expected negative probe, `26` Node tests/build/lint, and `3` frontend tests/build/lint. Shared v1/v2 fixtures prove that Python and TypeScript accept the same valid v2 source contract and reject incomplete, contradictory and extra-field variants. Cache tests confirm that the committed `rybnik_60km/power` v1 provenance remains readable through the OpenStreetMap v2 record; Node API tests confirm that the legacy `/sources` and layer-pack responses remain valid.

### MDQ-019 - Introduce Native-Artifact Domain-Pack Cache v2

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`

Type: cache/data contract

Repo area: `backend/data/cache/`, `backend/geo_pipeline/`, `backend-node/src/types/`, `docs/architecture.md`

Objective: support multiple processed layers, representative points, native source artifacts and validation in one AOI/domain pack instead of one GeoJSON file per domain.

Scope:

- Define a versioned manifest for raw native artifacts, processed/derived layers, validation, readiness and source provenance.
- Support GML, GPKG, GeoParquet, GeoTIFF and remote-service manifests without requiring every raw input to be GeoJSON.
- Define role-named layer IDs, optional representative-point layers and explicit not-applicable reasons.
- Specify atomic pack replacement, file integrity and public-export eligibility.
- Migrate the current power cache as the compatibility reference implementation.

Acceptance criteria:

- [x] A domain pack can contain multiple vector layers and non-vector source records under one deterministic identity.
- [x] Cache readers reject missing, mismatched, escaping or count-inconsistent artifacts.
- [x] Public export filters respect source distribution policy.
- [x] The migrated power pack remains consumable through the v1 compatibility path.
- [x] Offline fixtures cover vector, raster, WMS-reference and non-free-source rejection manifests.

Specification:

- [`specs/MDQ-019/functional_spec.md`](./specs/MDQ-019/functional_spec.md)
- [`specs/MDQ-019/technical_plan.md`](./specs/MDQ-019/technical_plan.md)

Verification: `./scripts/verify_provider.sh` passed on 2026-08-01 with `62` Python tests/smoke and the expected negative probe, `27` Node tests/build/lint and `3` frontend tests/build/lint. Domain-pack tests prove atomic v2 Rybnik migration, v1 cache compatibility, path-traversal rejection, GeoJSON count/checksum validation, native-raster records, WMS reference exclusion and unqualified-source export rejection.

### MDQ-020 - Define Parameterized AOI and Cache Identity Contract

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-019`

Type: AOI/API contract

Repo area: `backend/geo_pipeline/`, `backend-node/src/types/`, `docs/architecture.md`

Objective: replace the hard-coded Rybnik target with bounded, reproducible AOIs that work for both centre/radius selection and official administrative boundaries.

Scope:

- Define centre/radius input with coordinate, radius and area limits plus a PRG administrative-boundary reference form.
- Normalize AOI geometry to EPSG:4326 while recording the source CRS and boundary provenance.
- Derive a deterministic AOI ID from normalized geometry and contract version.
- Define cache reuse, invalid-input errors and behavior when an AOI crosses source-coverage boundaries.
- Preserve `rybnik_60km` as a named compatibility alias.

Acceptance criteria:

- [x] Equivalent AOI inputs produce the same identity and materially different inputs do not collide.
- [x] Invalid coordinates, radii, geometry and unsupported administrative references are rejected deterministically.
- [x] AOI metadata retains geometry, CRS, provenance and area constraints.
- [x] Cache paths are safe and never derived directly from untrusted labels.
- [x] Offline tests cover circle, PRG-reference, compatibility alias and rejection cases.

Specification:

- [`specs/MDQ-020/functional_spec.md`](./specs/MDQ-020/functional_spec.md)
- [`specs/MDQ-020/technical_plan.md`](./specs/MDQ-020/technical_plan.md)

Verification: `backend/tests/test_aoi.py` covers normalized circle identity, non-collision, PRG fixture provenance, the `rybnik_60km` compatibility alias and invalid/unsafe inputs. `./scripts/verify_provider.sh` passed on 2026-08-01 with `71` Python tests/smoke and the expected negative probe, `30` Node tests/build/lint and `3` frontend tests/build/lint.

### MDQ-021 - Qualify Official and Community Source Candidates by Domain

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-020`

Type: source research/decision

Repo area: `docs/local/`, `backend/data/sources/`

Objective: create an evidence-backed go/no-go source matrix before domain adapters encode assumptions about availability, coverage, schema, licensing or update cadence.

Scope:

- Verify source candidates for emergency, public, transport, bridges, water, gas, sewer, industrial, telecom and district heating.
- Cover OSM, PRG, BDOT10k, KIUT, orthophoto, NMT/NMPT and relevant free official domain registries discovered during research.
- Record service/format, geographic coverage, access terms, redistribution, update cadence, AOI query method and known gaps.
- Mark each candidate `adopt`, `reference_only` or `reject` with dated evidence.
- Reject sources that require payment, a private agreement, partner delivery or have unclear reuse terms; treat free registration as a separate access property and do not implement ingestion in this ticket.

Acceptance criteria:

- [x] Every planned domain has at least one qualified source strategy or an explicit source gap.
- [x] Official endpoints and current terms are cited from primary sources and dated.
- [x] WMS, WFS, WCS and static downloads are not conflated.
- [x] Unverified, non-free or legally unclear candidates cannot become enabled registry entries.
- [x] The matrix gives later adapter tickets exact source ownership and fallback behavior.

Specification:

- [`specs/MDQ-021/functional_spec.md`](./specs/MDQ-021/functional_spec.md)
- [`specs/MDQ-021/technical_plan.md`](./specs/MDQ-021/technical_plan.md)

Verification: `backend/data/sources/source_strategy.json` records primary-source URLs checked on 2026-08-01, including live PRG WFS, BDOT10k WMS discovery and KIUT WMS GetCapabilities checks. `backend/tests/test_source_strategy.py` asserts dated evidence, all ten planned-domain strategies, source gaps and reference-only export restrictions. `./scripts/verify_provider.sh` passed on 2026-08-01 with `74` Python tests/smoke and the expected negative probe, `30` Node tests/build/lint and `3` frontend tests/build/lint.

### MDQ-022 - Generalize Python Worker and OSM Query Catalog

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-019`, `MDQ-020`, `MDQ-021`

Type: data pipeline foundation

Repo area: `backend/geo_pipeline/`, `backend/tests/`

Objective: remove `rybnik_60km/power` hard-coding and provide a domain-adapter interface with versioned OSM queries, native staging, normalization and atomic cache publication.

Scope:

- Introduce registered AOI/domain adapters and a versioned OSM tag/query catalog.
- Keep `fixture`, `cache` and `live` worker modes with machine-readable results and stable errors.
- Stage raw native and processed artifacts before atomic domain-pack replacement.
- Preserve domain-specific classification while sharing extraction, clipping, provenance and validation plumbing.
- Migrate power through the generic interface without adding other domain behavior yet.

Acceptance criteria:

- [x] The worker accepts registered AOIs/domains without literal Rybnik/power branching.
- [x] Unsupported targets and partial adapter output fail without replacing valid cache.
- [x] Query versions and source records are retained in pack provenance.
- [x] Power fixture/cache/live contracts remain backward compatible.
- [x] Offline tests cover adapter registration, staging, failure rollback and deterministic results.

Specification:

- [`specs/MDQ-022/functional_spec.md`](./specs/MDQ-022/functional_spec.md)
- [`specs/MDQ-022/technical_plan.md`](./specs/MDQ-022/technical_plan.md)

Verification: adapter and worker tests cover registered resolution, stable unsupported-target errors, deterministic fixture staging and rollback after partial pack output. `./scripts/verify_provider.sh` passed locally with 77 Python tests/smoke and the expected negative probe, 30 Node tests/build/lint and 3 frontend tests/build/lint. PR #21 passed the required Provider Verification GitHub Actions check and was merged to `main` on 2026-08-01.

### MDQ-023 - Generalize Provider API, Export and Dev-Preview Shell

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-019`, `MDQ-020`, `MDQ-022`

Type: full-stack foundation

Repo area: `backend-node/`, `frontend/`, `docs/architecture.md`

Objective: make Node, export schemas and the provider dev-preview catalog-driven before individual domains are added.

Scope:

- Replace literal power/Rybnik schemas with registered AOI, domain and domain-pack contracts.
- Add v2 read/export responses while preserving bounded v1 power compatibility.
- Render layer toggles, counts, popups, source attribution and limitations from manifests rather than hard-coded UI text.
- Keep refresh writes separate from read-only endpoints and enforce distribution policy on exports.
- Keep the preview non-operational and separate from the Steel Sentinel client.

Acceptance criteria:

- [x] Node validates and serves arbitrary registered v2 domain packs without per-domain route code.
- [x] The preview can render fixture domains through manifest configuration alone.
- [x] Popups and counts use provider-normalized fields and expose source/readiness limitations.
- [x] Restricted or reference-only artifacts cannot leak through analytical GeoJSON endpoints.
- [x] Node/frontend contract tests and v1 compatibility tests pass offline.

Specification:

- [`specs/MDQ-023/functional_spec.md`](./specs/MDQ-023/functional_spec.md)
- [`specs/MDQ-023/technical_plan.md`](./specs/MDQ-023/technical_plan.md)

Verification: generic v2 domain-pack and export routes validate manifest identity, checksums, feature counts and source eligibility, including a temporary manifest-only fixture domain and a rejected KIUT reference-only provenance case. The preview catalog test derives a water fixture layer, normalized popup data, attribution and limitations without a hard-coded power domain. Existing v1 route/export tests remain green. `./scripts/verify_provider.sh` passed on 2026-08-01 with 77 Python tests/smoke and expected negative probe, 33 Node tests/build/lint and 5 frontend tests/build/lint; the post-review Node suite also passed with 33 tests.

## Milestone 7A - Simplify Provider Inspection Preview

### MDQ-045 - Simplify Leaflet Provider Inspection Preview

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`

Type: frontend refactor

Repo area: `frontend/`, `docs/local/`

Objective: keep Leaflet as the provider's deliberately non-operational map preview while reducing the frontend to a clear AOI, layer and feature-inspection workflow.

Scope:

- Replace the dashboard-style page with one compact map-inspector layout.
- Keep the manifest-driven layer catalog, but present it as a concise toggle/status list.
- Surface selected feature provenance, normalized attributes, confidence, readiness and limitations in a dedicated inspection panel.
- Keep issue review available behind a collapsed quality drawer instead of making it the main preview surface.
- Split the current monolithic application component into focused presentation components without changing API routes, data contracts or Leaflet.

Acceptance criteria:

- [x] The default screen makes map, layer selection and selected-feature inspection visible without dashboard-style hero/cards.
- [x] Layer toggles, counts, readiness, source attribution and limitations still come from the v2 domain-pack response.
- [x] Clicking a Leaflet feature selects it and shows provider-normalized data, provenance and limitations outside the map popup.
- [x] Issue-review behaviour remains available but is visually secondary and does not alter generated readiness.
- [x] Frontend tests, build and lint pass offline; no backend or API contract changes are required.

Verification: browser inspection confirmed the map-first layout, a real Leaflet feature selection, normalized evidence in the side panel and selection cleanup after hiding its layer. `./scripts/verify_provider.sh` passed on 2026-08-02 with 77 Python tests/smoke and expected negative probe, 33 Node tests/build/lint, and 6 frontend tests/build/lint.

## Milestone 7B - Provider Identity Cleanup

### MDQ-046 - Remove Steel Sentinel Compatibility Residue

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-045`

Type: full-stack contract cleanup

Repo area: `backend/`, `backend-node/`, `frontend/`, `docs/`, `docs/local/`

Objective: make Map Data Quality Lab a standalone, consumer-neutral geospatial provider rather than a partially branded Steel Sentinel compatibility layer.

Scope:

- Replace Steel Sentinel-specific GeoJSON and export contract identifiers with provider-owned names.
- Remove the legacy Steel Sentinel export endpoints and their v1/v2 schemas; use the existing generic domain-pack API as the public multi-domain read contract.
- Remove simulation-suitability fields and wording from provider metadata, source registry, cache artifacts and frontend types.
- Update the committed cache/domain-pack fixture and integrity manifest after the neutral contract migration.
- Rewrite public documentation and demo language around downstream consumers in general, without preserving Steel Sentinel product flows or operational terminology.

Acceptance criteria:

- [x] No production backend or frontend source exposes `steel_sentinel`/`Steel Sentinel` identifiers, endpoints or compatibility schemas.
- [x] Provider GeoJSON/cache metadata, source registry and frontend contracts contain no `usable_for_simulation` field or simulation-specific readiness semantics.
- [x] Generic domain-pack reads, issue review and the Leaflet inspector remain functional without the removed exports.
- [x] Committed cache/domain-pack artifacts validate with current checksums and the neutral provider contract.
- [x] Public README, architecture and demo explain consumer-neutral data delivery; their Polish mirrors are updated.
- [x] The canonical provider verification gate passes offline.

Verification: 77 Python tests, 31 Node tests/build/lint and 6 frontend tests/build/lint passed offline. A source audit found no retired Steel Sentinel identifiers or `usable_for_simulation` in production backend/frontend source or public documentation.

## Milestone 8 - Add Verified Source Adapters

### MDQ-024 - Add PRG WFS AOI and Public-Service Adapter

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-020`, `MDQ-021`, `MDQ-022`

Type: source adapter

Repo area: `backend/geo_pipeline/sources/`, `backend/data/fixtures/`, `backend/tests/`

Objective: use official PRG vectors for administrative AOIs and qualified public-service features without making the provider depend on live WFS during verification.

Scope:

- Add capabilities/schema discovery and bounded WFS extraction for selected PRG feature types.
- Normalize gmina, powiat and województwo boundaries plus qualified police/fire records from the source matrix.
- Preserve raw GML fixture evidence, official identifiers, CRS and snapshot metadata.
- Clip non-boundary features to the requested AOI and report coverage/schema gaps.
- Keep PRG facts distinct from OSM feature classifications.

Acceptance criteria:

- [x] Circle and administrative AOIs can be resolved or clipped using deterministic PRG fixtures.
- [x] Selected official public-service features retain their PRG class and identifiers.
- [x] Schema drift, empty results and service failure produce explicit source/readiness evidence.
- [x] No live PRG request is required by the canonical offline gate.
- [x] Attribution and current use terms are present in every derived pack.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 102 Python tests/smoke and the expected contract-failure probe, 33 Node tests/build/lint and 6 frontend tests/build/lint. Fixture tests validate A01–A03 boundaries, representative K02 police and K07 fire records, EPSG:2180 provenance, source identifiers, AOI clipping, empty/schema-drift/service-unavailable outcomes, attribution and no live WFS request in the canonical gate.

### MDQ-025 - Add BDOT10k GPKG and GeoParquet Adapter

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-019`, `MDQ-021`, `MDQ-022`

Type: source adapter

Repo area: `backend/geo_pipeline/sources/`, `backend/data/fixtures/`, `backend/tests/`

Objective: ingest current official BDOT10k class downloads for transport, bridges, hydrography, buildings and industrial context without assuming the package-index WFS is a direct feature API.

Scope:

- Prefer current GPKG/GeoParquet class downloads and retain a documented package-discovery fallback where needed.
- Map verified current `OT_*` schema classes to provider source categories; do not rely on unverified legacy abbreviations.
- Read only required columns/row groups where supported, transform CRS and clip to AOI.
- Preserve native source artifacts or stable download manifests with checksum, schema and snapshot metadata.
- Add fixture coverage for representative line, point and polygon classes.

Acceptance criteria:

- [x] The adapter produces deterministic clipped vectors from offline GPKG/GeoParquet fixtures.
- [x] Source-class mapping is versioned and fails clearly on incompatible schema drift.
- [x] Geometry, CRS, identifiers, attribution and snapshot provenance survive normalization.
- [x] Transport, bridge, water-context, building and industrial source roles are addressable independently.
- [x] Large national files are not loaded wholesale when a bounded class/AOI read is possible.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 114 Python tests/smoke and the expected contract-failure probe, 33 Node tests/build/lint and 6 frontend tests/build/lint. Fixture tests verify a checksum-validated GPKG, GeoParquet point, line/point/polygon mappings, bounded selected-column reads, EPSG:2180-to-EPSG:4326 normalization, AOI clipping, source-role independence, package-discovery-only WMS metadata and explicit checksum/schema errors without a remote request.

### MDQ-026 - Add KIUT WMS Overlay and Coverage Adapter

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-020`, `MDQ-021`, `MDQ-023`

Type: reference-source adapter

Repo area: `backend/geo_pipeline/sources/`, `backend-node/`, `frontend/`, `backend/data/fixtures/`

Objective: expose KIUT utility layers as source-aware visual references and coverage evidence without converting rendered imagery into analytical vectors.

Scope:

- Parse and fixture the relevant capabilities metadata, scale limits and layer names for power, water, gas, sewer, telecom and district heating.
- Determine whether the selected AOI intersects participating/available KIUT coverage.
- Build safe GetMap/legend descriptors for the dev-preview rather than redistributing cached imagery by default.
- Surface WMS availability, scale and coverage limitations through readiness and popup metadata.
- Keep GetFeatureInfo optional and never treat its absence as vector extraction failure.

Acceptance criteria:

- [x] KIUT overlays can be toggled for qualified utility domains at supported scales.
- [x] The provider reports unavailable, uncovered and reference-only states distinctly.
- [x] No KIUT response is written to an analytical GeoJSON layer.
- [x] WMS parameters are allow-listed and cannot proxy arbitrary remote URLs.
- [x] Capabilities fixtures and optional live diagnostics cover schema/availability changes.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 123 Python tests/smoke, 33 Node tests/build/lint and 7 frontend tests/build/lint. The KIUT tests cover verified capability layers, coverage, scale, unavailable service, schema drift, endpoint/layer allow-listing and the absence of vector fallback.

### MDQ-027 - Add Geoportal Orthophoto Reference Adapter

Priority: P1

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-020`, `MDQ-021`, `MDQ-023`

Type: reference-raster adapter

Repo area: `backend/geo_pipeline/sources/`, `backend-node/`, `frontend/`, `backend/data/fixtures/`

Objective: provide official orthophoto as an optional inspection background with explicit service, date, resolution and redistribution limitations.

Scope:

- Register qualified standard/high-resolution WMS or WMTS endpoints and optional WCS snapshot metadata.
- Expose a safe preview overlay configuration bounded to the selected AOI.
- Record imagery date/resolution when available and distinguish it from current operational state.
- Do not convert imagery to object vectors or bundle tiles in public exports by default.
- Add fixture-based service metadata validation.

Acceptance criteria:

- [x] The dev-preview can toggle an official orthophoto reference layer independently of analytical domains.
- [x] Source date, resolution, attribution and limitations are visible.
- [x] Export policy excludes remote imagery unless a future ticket explicitly authorizes redistribution.
- [x] Invalid service metadata or unsafe URLs are rejected.
- [x] Offline verification requires no imagery download.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 127 Python tests/smoke and the expected contract-failure probe, 33 Node tests/build/lint and 8 frontend tests/build/lint. The adapter tests use a committed WMS capabilities fixture and prove coverage, unavailable service, missing/unsafe metadata, CRS validation and no vector fallback; no imagery is downloaded.

### MDQ-028 - Add NMT and NMPT Analytical Raster Adapter

Priority: P1

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-019`, `MDQ-020`, `MDQ-021`, `MDQ-022`

Type: analytical-raster adapter

Repo area: `backend/geo_pipeline/sources/`, `backend/geo_pipeline/raster/`, `backend/data/fixtures/`, `backend/tests/`

Objective: ingest bounded terrain/height rasters with reproducible CRS, resolution, nodata and validation metadata for explicitly defined derived context products.

Scope:

- Support qualified WCS/official download inputs in GeoTIFF or ASCII Grid form.
- Clip/reproject without silently resampling away source resolution and record transformation parameters.
- Validate extent, CRS, resolution, nodata coverage and corrupt/empty tiles.
- Define a bounded derived-product interface; do not claim flood risk from elevation alone.
- Provide small deterministic raster fixtures for offline tests.

Acceptance criteria:

- [x] Native raster input and processed AOI raster retain checksums and full provenance.
- [x] Validation reports CRS, resolution, nodata and AOI coverage.
- [x] Derived vector output, when requested, is labeled as derived and records its algorithm/version.
- [x] Raster artifacts cannot be served through vector-only endpoints.
- [x] Offline tests cover valid, partial, nodata and incompatible-raster cases.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 131 Python tests/smoke and the expected contract-failure probe, 33 Node tests/build/lint and 8 frontend tests/build/lint. Deterministic ASCII Grid fixtures cover valid, partial, all-nodata and corrupt input; tests prove incompatible CRS and uncovered AOI failures, native/processed checksums, no-resampling provenance, labelled derived sample points and the native-raster export guard.

### MDQ-029 - Enforce Free-Source-Only Acquisition and Export Policy

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-018`, `MDQ-019`, `MDQ-020`, `MDQ-021`, `MDQ-022`

Type: source eligibility boundary

Repo area: `backend/geo_pipeline/sources/`, `backend/data/fixtures/`, `docs/local/`

Objective: ensure the current release acquires, processes and exports only sources that are free to access and qualified for the intended provider use.

Scope:

- Define a reusable eligibility evaluator from registry access, terms, attribution and distribution metadata.
- Allow qualified free analytical sources and qualified free reference services while preserving their distinct roles.
- Reject paid, agreement-only, private partner and legally unclear candidates before network acquisition, local import or export; do not reject a source merely because free registration is required.
- Preserve attribution, license and redistribution obligations even when a source is free.
- Add representative offline fixtures for free analytical, free reference-only, paid, agreement-only and ambiguous candidates.

Acceptance criteria:

- [x] Only qualified free sources can be enabled for acquisition and processing.
- [x] Non-free or unclear candidates fail before any remote request or file import is attempted.
- [x] A free WMS can remain enabled as reference-only but cannot pass an analytical-vector check.
- [x] Public cache and export paths enforce the same eligibility decision.
- [x] Offline fixtures cover allowed, rejected and not-comparable cases without requiring live services.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 93 Python tests/smoke and the expected contract-failure probe, 33 Node tests/build/lint and 6 frontend tests/build/lint. Deterministic fixtures cover qualified analytical, free-registration, WMS reference-only, paid, agreement-only and legally unclear candidates; rejected acquisition/import callbacks are proven not to run. Python cache/domain-pack validation and the shared Node registry schema reject restricted or export-ineligible source provenance.

## Milestone 9 - Add Source Availability and Cross-Source Quality

### MDQ-030 - Add Source Availability and AOI Coverage Reports

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-024`, `MDQ-025`, `MDQ-026`, `MDQ-027`, `MDQ-028`, `MDQ-029`

Type: source quality/readiness

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: distinguish a healthy source with no AOI features from an unavailable service, unsupported AOI, stale snapshot, reference-only source or rejected non-free candidate.

Scope:

- Define versioned availability and coverage states with dated evidence and per-source freshness rules.
- Combine adapter metadata, AOI intersection, fixture/live-probe outcome and access status without live calls on read paths.
- Expose source coverage in API, export and provider preview.
- Generate issues only for actionable source gaps and keep reference-only limitations visible.
- Keep optional live probes separate from the canonical offline gate.

Acceptance criteria:

- [x] Every registered source reports availability, AOI coverage, freshness and evidence timestamp.
- [x] Empty, unavailable, uncovered, reference-only and not-eligible states are distinct.
- [x] Cached read endpoints never trigger a remote availability probe.
- [x] Readiness consumes structured states instead of parsing messages.
- [x] Offline fixtures cover all states and optional live probes fail safely.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 133 Python tests/smoke, 34 Node tests/build/lint and 8 frontend tests/build/lint.

### MDQ-031 - Define Cross-Source Matching and Conflict Rules

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-024`, `MDQ-025`, `MDQ-026`, `MDQ-029`, `MDQ-030`

Type: multi-source data quality

Repo area: `backend/geo_pipeline/`, `backend/tests/`, `docs/architecture.md`

Objective: compare qualified free official, community and reference evidence without silently conflating features or treating disagreement as proof that one source is wrong.

Scope:

- Define domain-aware candidate matching using stable IDs where available and bounded spatial/attribute rules otherwise.
- Report matched, source-only, conflicting and not-comparable outcomes with rule version and evidence.
- Keep original features and provenance intact; automatic merge/conflation is out of scope.
- Prevent WMS imagery from creating vector matches; it may contribute only reference/coverage evidence.
- Feed structured comparison results into domain validation, issues and readiness.

Acceptance criteria:

- [x] Matching is deterministic for identical fixtures and versioned by domain/rule.
- [x] False certainty is avoided when identifiers, geometry or comparable attributes are missing.
- [x] Original source features remain independently inspectable.
- [x] Reference-only and rejected-source cases are explicitly not comparable.
- [x] Tests cover agreement, disagreement, one-source-only, ambiguous and not-applicable outcomes.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-02 with 137 Python tests/smoke, 34 Node tests/build/lint and 8 frontend tests/build/lint.

## Milestone 10 - Deliver Required Domain Vertical Slices

### MDQ-032 - Deliver Multi-Source Power Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-026`, `MDQ-029`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: migrate the existing OSM power demo into the shared multi-source domain-pack contract and use it as the reference implementation for later domains.

Scope: retain OSM lines and power assets, add representative points, KIUT power overlay/coverage, free-source eligibility evidence and the complete shared domain definition of done.

Acceptance criteria:

- [x] The power pack exposes raw/source evidence, processed/clipped layers, representative points, validation, readiness and multi-source provenance.
- [x] KIUT remains reference-only and non-free inputs are rejected by the shared eligibility gate.
- [x] API, v2 export and dev-preview toggle/popup/count work from offline fixtures.
- [x] Existing v1 power consumers keep the documented compatibility behavior.
- [x] Power-specific tests pass through the canonical gate.

### MDQ-047 - Add Offline MVT/PMTiles Map Read Path and MapLibre Preview

Priority: P0

Status: Done

Goal: `G-003`

Depends on: `MDQ-023`, `MDQ-032`

Type: scalable map delivery

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: retain reproducible full GeoJSON as the canonical provider artifact and export, while deriving an offline-first map read model using Mapbox Vector Tiles (MVT) in a PMTiles archive and replacing the Leaflet preview renderer with MapLibre.

Scope:

- Record the benchmark baseline for the public power preview and enforce that the map read path does not transfer complete analytical GeoJSON collections to the browser.
- Deterministically derive zoom-bounded MVT layers from manifest-approved public analytical GeoJSON only, then package them as a versioned PMTiles archive for local/offline use.
- Preserve source identity, attribution, cache identity, checksum and manifest provenance for the derived presentation artifact; retain only the properties necessary for inspection at each zoom.
- Add a separate, read-only Node presentation/tile contract and compact presentation metadata. The existing GeoJSON/export contract remains the data and analysis path.
- Replace Leaflet only in the provider inspection `MapView` with MapLibre. Preserve the compact preview shell, domain/layer toggles, counts and feature inspection; use rendered-feature queries for map selection.
- Keep KIUT, orthophoto and other WMS/raster services as reference overlays. Do not vectorize, include or claim offline availability for those services.

Out of scope:

- PostGIS, a live tile-generation service, a generic BBOX query API, 3D terrain, or any Steel Sentinel integration.
- Changing source eligibility, importing paid/private/unclear sources, or changing the meaning of canonical public GeoJSON exports.

Acceptance criteria:

- [x] Existing GeoJSON exports, source-role filtering and documented v1 compatibility remain unchanged.
- [x] Offline fixtures deterministically produce a versioned MVT-in-PMTiles archive from allowed public layers, with verified checksum, attribution and provenance; private evidence and reference overlays cannot enter it.
- [x] The map contract returns presentation metadata and tile data only, never the complete public GeoJSON collections used as source artifacts.
- [x] The MapLibre preview preserves layer visibility controls, counts and inspectable feature properties without a Leaflet runtime dependency.
- [x] Offline verification proves the presentation archive can be read without a remote vector-data request and rejects invalid, stale or distribution-ineligible tile inputs.
- [x] Benchmarks demonstrate a materially smaller initial browser payload and feature workload than the recorded full-GeoJSON Leaflet baseline.
- [x] Public architecture and run documentation accurately distinguish canonical GeoJSON/export, MVT/PMTiles presentation data and unavailable offline WMS overlays.

### MDQ-048 - Improve Power Inspection and Voltage Cartography

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-032`, `MDQ-047`

Type: power inspection and presentation contract

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: make the public OSM power pack easier to inspect by exposing an explicitly bounded source-tag projection and clear voltage-based cartography while keeping the PMTiles map read path compact, offline-capable and consumer-neutral.

Scope:

- Replace the split popup/detail experience with one immediately visible feature inspector; it must show selection, normalized provider evidence, attribution, limitations and an OSM-source section in one place.
- Define a documented allow-list of display-oriented OSM power fields, including only available source semantics such as `power`, `name`, `ref`, `operator`, `voltage`, `voltage:primary`, `voltage:secondary`, `frequency`, `circuits`, `cables`, `wires`, `phases`, `location`, `design` and equipment-specific fields.
- Derive explicit voltage parsing and display buckets from OSM tags, preserving missing, multiple and unparseable values rather than guessing a nominal voltage.
- Carry only the style and compact-selection fields needed by MVT; return the richer allowed source-tag projection on demand from the validated canonical cache, keyed by stable `source_id`.
- Render electrical lines with a documented deterministic MapLibre style based on the voltage bucket and a distinct unknown-data style. Preserve layer toggles, source attribution and offline PMTiles operation.
- Add source-labelled OSM power-support presentation for `tower`, `pole`, `portal` and `utility_pole`. Keep these as distinct asset classes rather than treating every support as a generic node or deriving supports from line geometry.
- Generate power-support MVT features only at their documented display scales: towers, portals and utility poles from zoom 12; ordinary power poles from zoom 14. At lower zooms the archive must omit those support features, rather than merely hiding a full-AOI point set in the client.
- Add a dedicated `Power supports` visibility control. When enabled, supports use distinct, restrained MapLibre symbols by source class; a selected support opens the same single inspector and on-demand detail route as any other power feature.

Out of scope:

- Arbitrary or complete raw-tag export, live OSM lookups, a replica of OpenInfraMap styling, electrical-flow inference, network connectivity or cascade simulation.
- Changing analytical source eligibility, treating OSM values as authoritative operational facts, or vectorizing KIUT/WMS references.
- Rendering every support in an AOI at low zoom, browser-side clustering of a complete support collection, or deriving a tower/pole where OSM did not supply one.

Acceptance criteria:

- [x] A selected feature has one coherent inspector location with clear source/provenance, normalized provider fields and separately labelled OSM source tags.
- [x] The canonical contract and generated presentation artifacts retain a tested, explicit allow-list of relevant OSM power semantics; absent source values remain absent rather than synthesized.
- [x] A read-only detail contract returns one validated feature by stable `source_id` without loading full GeoJSON into the map response.
- [x] Lines have deterministic voltage-based styling, while missing, multi-value and invalid voltages have explicit non-misleading presentation states.
- [x] `tower`, `pole`, `portal` and `utility_pole` retain their source classes through the canonical and presentation contracts; their MVT representation begins only at the documented zoom thresholds and never requires a full-AOI support payload in the browser.
- [x] The preview has a separately controllable, visually distinct power-support layer; selecting a displayed support opens the same coherent inspector and validated detail contract as a line or other power asset.
- [x] PMTiles range reads, the local/offline preview, existing GeoJSON/export contracts and reference-only WMS boundaries remain intact.
- [x] Offline tests cover tag projection, voltage parsing/styling, support classification and zoom thresholds, detail lookup, missing/invalid input and UI feature selection.

### MDQ-049 - Add Bounded OSM Power Relation Evidence

Priority: P1

Status: Done

Goal: `G-004`

Depends on: `MDQ-048`

Type: source relationship evidence

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: expose reproducible OSM relation and member evidence for an inspected power feature when the committed source actually supplies it, without representing an electrical circuit, a complete loop or a failure-propagation model where the source does not prove one.

Scope:

- Extend the fixture-first power acquisition/cache contract with checked OSM relation/member evidence and original relation identifiers only where the source snapshot contains them.
- Record whether relation geometry and endpoints are fully represented inside the bounded AOI, clipped at the AOI boundary, absent or not applicable.
- Let the feature inspector open a relation-evidence view that draws only verified member geometry and labels geometric endpoints separately from confirmed OSM nodes.
- Preserve relation tags, stable source IDs, snapshot date, checksums, provenance and source limitations; show a direct OSM-source reference when eligible.

Out of scope:

- Inferring connectivity between nearby lines, joining unrelated ways, declaring a complete circuit/loop from partial members, power-flow calculations, outage/cascade modelling or operational recommendations.
- Extending relation geometry outside the bounded AOI, live OSM relation requests or importing private/paid network data.

Acceptance criteria:

- [x] Fixture-only cache generation preserves and validates relation/member evidence when present, and records an explicit unavailable/not_applicable state otherwise.
- [x] Relation details preserve OSM IDs, source tags, provenance, AOI-coverage state and checksum identity without reclassifying source evidence as provider fact.
- [x] The preview can open a separate relation-evidence view for a selected eligible feature and shows only verified member geometry.
- [x] Geometric endpoints, confirmed OSM nodes, missing members and AOI clipping are visibly distinguished; no complete-loop or connectivity claim is fabricated.
- [x] The read-only API rejects malformed, stale, out-of-AOI or distribution-ineligible relation records.
- [x] Offline tests prove deterministic relation artifacts, no relation data for unrelated features and the absence of simulation/flow fields.

### MDQ-050 - Deliver Source-Verified Power Cartography and Circuit Inspection

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-048`, `MDQ-049`

Type: power domain presentation and source-relation vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: turn the power preview into a source-aware, Open Infrastructure Map–inspired inspection experience: complete committed OSM support and circuit evidence for the configured AOI, clear voltage cartography and labels, concise object popups, and source-verified circuit selection/highlighting.

Scope:

- Acquire and commit a dated, bounded OSM source snapshot for every supported power line, tower, pole, portal, utility pole, station and circuit relation required by the preview AOI. Preserve original IDs, tags, snapshot timestamp, query, attribution, licence, checksums and explicit coverage limitations.
- Build a deterministic reverse membership index from committed OSM relation members to source features. A selected line, node, support or station may offer only relations that name it or its verified member geometry in the source snapshot.
- Add a documented voltage/cartographic policy with distinct, accessible styles and labels for published voltage classes, plus a deliberate unknown/multiple/unparseable style that remains readable at every supported zoom.
- Render source-provided support classes at scale-appropriate zoom levels from generated MVT, not by sending hidden full-AOI points to the browser. Make each support class visually distinguishable.
- Restore a compact map popup for immediate object inspection: OSM name/ref, class, voltage, operator, source links and eligible OSM-provided external references. Retain the side inspector for provenance, quality, limitations and extended attributes.
- Provide a circuit-selection control and a `Selected circuit` view. Selecting a verified relation highlights only its committed member geometry and presents source tags, member roles, endpoints, substations where explicitly represented, AOI coverage and missing-member state.

Out of scope:

- Copying Open Infrastructure Map code, tiles, images or proprietary presentation assets.
- Live OSM requests at runtime, scraping external content, fabricating image/Wikipedia metadata, geometry completion outside the bounded AOI, inferring connectivity from proximity, electrical-flow calculations, outage/cascade simulation or operational advice.

Acceptance criteria:

- [x] The committed fixture snapshot provides visibly complete-enough source-labelled support coverage for the preview AOI or records an explicit, tested source-coverage limitation; the prior 12-support demonstration fixture is not presented as AOI coverage.
- [x] Voltage styles and labels visibly distinguish documented voltage classes at the screenshot target scales, and unknown/multiple/unparseable values are not visually mistaken for a valid voltage class.
- [x] Map popups provide concise OSM object context without replacing the provider-inspection panel; external links and images appear only when safely recorded in source evidence.
- [x] Selecting a source-verified line, node or station lists only committed OSM circuit relations; selecting one highlights only verified relation members and clearly displays partial/missing/AOI-clipped evidence.
- [x] The circuit view preserves relation/member IDs, roles, tags, timestamps, provenance, checksums and limitations, and makes no topology, complete-loop, flow, outage or cascade claim.
- [x] PMTiles range reading, offline vector operation, canonical GeoJSON/export and reference-only KIUT/orthophoto boundaries remain intact.
- [x] Offline tests cover snapshot integrity, support counts/classes/zoom thresholds, voltage styling/labels, popup source projection, reverse relation index, valid/invalid/not-applicable circuit selection and no simulation fields.

### MDQ-033 - Deliver Emergency Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-024`, `MDQ-025`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide hospitals, fire services, police and ambulance/rescue facilities from qualified official and community sources.

Scope: combine qualified PRG police/fire records, OSM emergency/healthcare features and any adopted official candidates from `MDQ-021`; normalize facility types and official/community identity; satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Hospitals, fire, police and ambulance/rescue categories have explicit source mappings and limitations.
- [x] PRG and OSM records remain distinguishable even when spatially matched.
- [x] Areas/buildings have representative points for map inspection without losing original geometry.
- [x] Missing official coverage does not silently remove community evidence.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-03. The fixture-first pack publishes four explicit OSM facility classes, separately attributed PRG K02/K07 police/fire unit-area representative points, source-identity-preserving inspection geometry and a manifest-bound PMTiles presentation. The Node API serves generic provider feature IDs while OSM circuit routes remain power-specific; WMS and live emergency refresh remain out of scope.

### MDQ-051 - Deliver AOI-Aware Provider Runtime and Map Settings

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-020`, `MDQ-022`, `MDQ-023`, `MDQ-024`, `MDQ-029`, `MDQ-030`, `MDQ-047`, `MDQ-050`

Type: end-to-end provider workflow

Repo area: `backend/`, `backend-node/`, `frontend/`, `docs/`

Objective: let a user define one bounded Polish AOI in the map settings, then build or reuse cache-backed, source-aware artifacts through one AOI-aware provider runtime for every required `G-004` category, without preloading a full fixed AOI snapshot.

Scope:

- Add a versioned AOI request contract with two mutually exclusive modes: a point plus radius and an administrative selection.
- Restrict the initial service to Poland. The administrative selector uses dated, source-labelled official Polish boundaries and supports a whole voivodeship, county, gmina, or a union of selected counties and/or gminas. It must make `m. Rybnik` and `powiat rybnicki` distinguishable and selectable together.
- Normalize selected administrative geometries into a deterministic polygon or multipolygon. Cache identity must be independent of selection order and retain boundary-source/version provenance; worker extraction clips to the true AOI geometry, never merely its bounding box.
- Introduce one catalog-driven provider runtime interface: every profile receives the resolved AOI geometry and request identity, declares its source role and output kind, and returns an explicit `ready`, `needs_source`, `reference_only`, `pending_qualification` or failure outcome. Profiles cannot silently fabricate an analytical vector fallback.
- Implement the required OSM analytical profiles in bounded sequence: `power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer` and `industrial`. Each query is geometry-aware, source-dated, clipped to the true AOI and produces only its explicitly mapped categories. The map settings let the user choose which supported categories to prepare.
- Parameterize the existing non-OSM providers against the resolved AOI according to their verified role: PRG provides dated Polish administrative selection geometry and permitted official context; BDOT10k provides only allow-listed topographic context from qualified package artifacts; KIUT and orthophoto produce AOI/scale-bounded WMS reference descriptors; NMT/NMPT produces only labelled raster/derived context. No WMS or raster is converted into analytical GeoJSON.
- Add cache-backed request orchestration. A cache hit returns immediately; an identical in-progress request is coalesced; a missing or stale request has one local worker job and publishes only complete, validated GeoJSON/domain-pack/PMTiles artifacts. The cache key includes AOI geometry, source-boundary version, selected profiles, query version and pipeline version.
- Add a compact settings entry point to the MapLibre preview. The panel previews the AOI outline, selected area, selected categories and provider availability; it lets the user apply one configuration, start the request and see `pending`, `ready`, `stale`, `needs_source`, `reference_only` or `failed` state per category.
- Keep fixture inputs as deterministic offline contract evidence. Live acquisition is an explicit runtime/manual path, never a CI dependency. Current fixed Rybnik artifacts remain demo fallbacks, not a claim of complete coverage for every selected AOI.
- Preserve separate source identities and limitations. PRG administrative geometry may define an AOI or official context but is never converted into a facility location; BDOT10k is not facility semantics; KIUT, orthophoto and WMS remain reference-only.

Ordered delivery steps inside this one ticket:

1. AOI v2, Polish administrative-boundary catalog and deterministic geometry/cache identity.
2. Shared provider-runtime contract, job/cache lifecycle and category/profile availability model.
3. Geometry-aware OSM profiles: `power` and `emergency`; then `public`, `transport`, `bridges`; then `water`, `gas`, `sewer`, `industrial`.
4. AOI-aware PRG, BDOT10k, KIUT, orthophoto and NMT/NMPT role adapters with explicit vector/raster/reference boundaries.
5. MapLibre settings, AOI outline, selected-category controls and job/result states.

Acceptance criteria:

- [x] The preview has a discoverable settings icon and can apply a point/radius AOI or a Polish administrative selection without editing environment variables or source code.
- [x] The administrative flow supports a voivodeship, one or more counties, and one or more gminas; `m. Rybnik` plus `powiat rybnicki` produces one deterministic AOI union with a visible outline.
- [x] Invalid, out-of-Poland, over-limit or empty AOIs receive a typed validation response and never create a cache path or invoke acquisition.
- [x] Equivalent circle and administrative selections produce stable AOI/cache identities regardless of input ordering, while different geometry, boundary version, selected provider profile or query/pipeline version cannot collide.
- [x] Every required category has one catalogued provider outcome for a selected AOI: a qualified analytical result, a labelled qualified context/reference result, or an explicit source gap. OSM category profiles execute in the documented order and never include tags outside their mapping.
- [x] PRG, BDOT10k, KIUT, orthophoto and NMT/NMPT receive the same resolved AOI but retain their verified output kinds and source roles; an unqualified, WMS or raster source cannot enter an analytical-vector artifact.
- [x] Request status is explicit per selected profile. Cached results do not rerun the worker; concurrent equivalent requests share one job; failed work never replaces a valid cache; only a complete validated cache becomes `ready`.
- [x] A completed analytical category request exposes normal provider GeoJSON, domain-pack metadata, readiness and PMTiles presentation for the selected AOI. OSM records preserve snapshot/query provenance, non-vector sources remain source-labelled context/reference artifacts and source gaps remain visible.
- [x] All live network access is isolated from the offline verification gate. Fixtures cover circle, single and multi-unit administrative AOIs, each profile kind, cache hit/miss/stale/concurrency/failure, source provenance, geometry clipping, category mapping and settings-state transitions.
- [x] No PostGIS, remote job broker, Steel Sentinel integration, operational simulation, WMS vectorization or inferred facility/topology claim is introduced.

Non-goal boundary: `MDQ-034` through `MDQ-040` remain the owning tickets for domain-specific semantics, comparison rules, quality thresholds and complete vertical-slice acceptance. This ticket makes provider acquisition/cache/output reusable across categories; it does not declare any category complete merely because a profile can run.

Verification: full offline provider gate, targeted Python AOI/provider-runtime/cache/worker tests, Node request/job/API tests, frontend settings/reducer tests, MapLibre browser smoke using fixture responses, profile-by-profile contract fixtures and optional manual live acquisition outside CI.

Completion evidence: `pnpm run verify:provider` passed on 2026-08-03 with 156 Python tests, 43 Node tests and 15 frontend tests. Browser smoke verified the settings control, point/radius application, cache reuse, explicit `ready` fixture outcomes and source contexts, plus the `m. Rybnik`/`powiat rybnicki` administrative selection UI. The runtime cache stores only validated outcome records under ignored `backend/cache/`; it never creates an analytical vector for a source gap.

### MDQ-034 - Deliver Public Services Domain Pack

Priority: P1

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-024`, `MDQ-025`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide administration, education, postal and community/social facilities with normalized categories and visible source confidence.

Scope: combine qualified OSM, PRG, BDOT10k building/context and adopted official candidates; separate facility semantics from building geometry; satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Administration, education, post and community/social categories are queryable independently.
- [x] A building footprint alone is not classified as a public service without semantic source evidence.
- [x] Representative points preserve links to original polygons and sources.
- [x] Duplicate/ambiguous facilities produce comparison evidence rather than silent deletion.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

### MDQ-035 - Deliver Transport Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-025`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide main roads, railway lines, stations and airports/landing sites from BDOT10k, OSM and qualified official transport sources.

Scope: define bounded major-road classification, preserve rail/road geometries, normalize station and aerodrome roles, generate representative points for facilities, compare sources and satisfy the shared domain definition of done.

Specification:

- [`specs/MDQ-035/functional_spec.md`](./specs/MDQ-035/functional_spec.md)
- [`specs/MDQ-035/technical_plan.md`](./specs/MDQ-035/technical_plan.md)

Acceptance criteria:

- [x] Road, rail, station and aviation layers have documented selection rules and source mappings.
- [x] Provider-normalized classes do not depend on raw OSM or BDOT codes.
- [x] Original network geometry and facility points are available separately.
- [x] Source gaps and conflicting classifications remain visible.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-04 with 166 Python tests, 43 Node tests and 15 frontend tests. The fixture-first pack publishes four explicit OSM transport classes (roads, railways, stations, aviation), linked representative inspection points for non-point geometry, private source/context evidence and explicit BDOT10k topographic context limits. The AOI runtime serves the same `transport-osm/v1` profile for a selected AOI.

### MDQ-053 - Correct Transport Runtime and Add On-Demand Road Inspection

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-035`, `MDQ-051`

Type: domain correction / inspection UX

Repo area: `backend/geo_pipeline/`, `backend/tests/`, `backend-node/`, `frontend/`, `docs/`

Objective: make the completed transport domain reliable for a selected AOI and let a user inspect roads and railways as legible, on-demand line geometry rather than a default field of representative points.

Scope:

- Close the runtime vertical slice for transport: its qualified OSM profile, query catalog, normalizer, domain-pack publisher and worker live-refresh eligibility must agree. Version or invalidate runtime-result cache entries when the outcome can change, so an earlier `needs_source` result cannot mask a newly supported domain.
- Preserve a fixture-first `rybnik_60km` pack and offline verification. Prove a fresh non-demo AOI invokes the bounded transport worker path and a subsequent identical request is a cache hit; live network acquisition remains outside CI.
- Replace source-layer-name heuristics in the preview with explicit geometry/presentation roles, so road and railway artifacts render as lines and representative inspection points cannot be mistaken for their geometry.
- Extend the OSM road mapping with separately labelled `secondary`, `tertiary`, `unclassified`, `residential` and `living_street` classes. Keep `service` separate and disabled by default because it includes access, parking and internal roads. Do not add paths, cycleways, pedestrian-only features, traffic state, routing or operational accessibility claims.
- Keep road and railway network layers, and all transport representative-point layers, hidden by default. Add an explicit transport inspection mode with viewport-local, zoom-bounded selection; at low zoom it must guide the user to zoom in instead of rendering or hit-testing the local network globally.
- After a user selects a road or railway feature, render only the selected original OSM way/line as a prominent highlight, show source-labelled popup details and mark its verified geometry endpoints. If a verified OSM relation exists it may be shown separately; do not infer a road route, connectivity or branch traversal from a geometric crossing, proximity or matching name/ref.
- Preserve OSM provenance, original source identifiers, source tags, cache/readiness metadata, PMTiles range-read behavior and the separation of BDOT10k topographic context from analytical transport semantics.

Specification:

- [`specs/MDQ-053/functional_spec.md`](./specs/MDQ-053/functional_spec.md)
- [`specs/MDQ-053/technical_plan.md`](./specs/MDQ-053/technical_plan.md)

Acceptance criteria:

- [x] A fresh non-demo AOI request for transport reaches the qualified worker refresh path, publishes a validated transport artifact and returns `ready`; the same request subsequently returns a valid cache hit. A cache-version regression test proves a prior `needs_source` state cannot suppress the refreshed result.
- [x] Roads and railways render from their original line geometry; `road_class` is preserved in PMTiles for MapLibre filtering, representative points are not enabled by default and no default transport view is a dense field of road dots.
- [x] Secondary and local road classes are source-labelled and independently selectable, with `service` visually and semantically separate.
- [x] The default map does not render the transport network. The explicit inspector shows the current numeric zoom, selects only viewport/zoom-eligible features and highlights one selected original feature with popup and endpoints.
- [x] Any relation or endpoint evidence is source-backed. The UI never presents a crossing or inferred corridor as a verified network connection, route or operational fact.
- [x] Offline Python, Node and frontend tests cover the runtime/cache regression, line versus representative-point presentation, default visibility, selection/highlight and source/provenance boundaries.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-04 with 168 Python tests, 43 Node tests and 17 frontend tests. The smoke check and expected contract-failure probe also passed.

Non-goals: turn-by-turn routing, route finding, traffic, timetables, travel-time estimates, road criticality, simulation, inferred road corridors or any Steel Sentinel-specific operational workflow.

### MDQ-036 - Deliver Bridges and Crossings Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-035`, `MDQ-053`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide bridges, viaducts and transport-relevant crossings from BDOT10k and OSM without presenting public-source presence as an operational criticality assessment.

Scope: extract bridge/crossing geometries, associate them with qualified road/rail/water context, generate representative points, compare source evidence and satisfy the shared domain definition of done.

Specification:

- [`specs/MDQ-036/functional_spec.md`](./specs/MDQ-036/functional_spec.md)
- [`specs/MDQ-036/technical_plan.md`](./specs/MDQ-036/technical_plan.md)

Acceptance criteria:

- [x] Bridge, viaduct and qualified crossing types retain transport-mode and source context.
- [x] Representative points link back to original line/polygon geometries.
- [x] Any connectivity relevance is rule-based and labeled derived; no operational criticality claim is made.
- [x] OSM/BDOT disagreement is reported rather than silently merged.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-04 with 170 Python tests, 43 Node tests, 17 Frontend Vitest tests, 0 ESLint errors, and clean smoke/contract failure probes. The fixture-first pack publishes three explicit OSM bridge/crossing classes (`bridges`, `viaducts`, `crossings`), derived representative inspection points for non-point geometries, BDOT10k topographic context limits, and live worker refresh integration.

### MDQ-037 - Deliver Water Domain Pack

Priority: P0

Status: Completed

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-025`, `MDQ-026`, `MDQ-028`, `MDQ-029`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide water intakes, pumping facilities, water towers, available pipelines and watercourse context while distinguishing analytical networks from KIUT imagery and terrain-derived context.

Scope: combine qualified OSM facilities/pipelines, BDOT10k hydrography/structures, KIUT water overlay and bounded NMT-derived context; satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Intakes, explicitly water-tagged pumps, towers, pipelines and watercourse context have separate normalized layer roles.
- [x] KIUT water lines remain reference-only; absent free analytical pipeline coverage remains an explicit source gap.
- [x] Terrain-derived products are labeled derived and do not claim flood risk without a defined model.
- [x] Missing analytical pipeline coverage produces an explicit readiness limitation.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Correction verification: `water-osm/v2`, `geo_pipeline/water/v2` and `geo_pipeline/runtime/v10` require explicit water semantics for generic pipeline and pumping-station representations. Gas, sewer and unlabelled infrastructure cannot be classified as water. The published source evidence records this rule, and the power runtime descriptor is now sourced from the same canonical query catalogue as live acquisition. `./scripts/verify_provider.sh` passed on 2026-08-07: 181 Python tests, 45 Node tests, 19 frontend tests, clean smoke check and the expected contract-failure probe (with the existing non-failing Vite chunk-size warning).

### MDQ-038 - Deliver Gas Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-026`, `MDQ-029`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide gas pipelines and facilities where qualified free analytical vectors exist, backed by KIUT visual coverage without inventing missing network geometry.

Scope: normalize qualified OSM gas pipeline/facility tags, add KIUT gas overlay/coverage, enforce free-source eligibility and satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Gas features require explicit gas semantics and exclude generic pipelines and valves with unknown substance by default.
- [x] KIUT imagery cannot become analytical line geometry.
- [x] Missing vector coverage produces an explicit source/readiness limitation.
- [x] Non-free source data cannot enter acquisition, cache or public export paths.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `./scripts/verify_provider.sh` passed on 2026-08-07 with 180 Python tests, 45 Node tests, 19 Frontend Vitest tests, 0 ESLint errors, a passing smoke check and the expected contract-failure probe. The fixture-first and bounded live runtime paths publish only explicit OSM gas pipelines/facilities, derived inspection points and explicit OSM-completeness limitations. KIUT gas remains a reference-only overlay, and AOI preparation reports its radius plus queried, accepted and derived feature counts.

### MDQ-039 - Deliver Sewer Domain Pack

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-026`, `MDQ-029`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide wastewater plants, pumping facilities and available sewer pipelines with honest source/readiness behavior.

Scope: normalize qualified OSM wastewater/sewage features, add KIUT sewer overlay/coverage, enforce free-source eligibility, distinguish sewage from stormwater/unspecified drainage and satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Plants, pumps and pipeline/network layers have explicit sewage/wastewater semantics.
- [x] Stormwater, drainage and unknown-substance features are not silently classified as sewer.
- [x] KIUT remains reference-only and missing analytical network geometry is visible.
- [x] Non-free source data cannot enter acquisition, cache or public export paths.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `sewer-osm/v2`, `geo_pipeline/sewer/v2` and `geo_pipeline/runtime/v12` reject generic, water, gas, stormwater and drainage representations. The OSM query retrieves only explicit sewer/wastewater semantics, the fixture/domain-pack evidence records the exclusion rule, and live worker dispatch plus fresh non-demo publication have regression coverage. `./scripts/verify_provider.sh` passed on 2026-08-07: 188 Python tests, 45 Node tests, 19 frontend tests, smoke check and expected contract-failure probe (with the existing non-failing Vite chunk-size warning).

### MDQ-040 - Deliver Industrial Domain Pack

Priority: P1

Status: Done

Goal: `G-004`

Depends on: `MDQ-023`, `MDQ-025`, `MDQ-030`, `MDQ-031`

Type: domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: provide industrial facilities, works and land-use areas plus safely bounded public military-area context from qualified OSM and BDOT10k evidence.

Scope: separate production facilities, industrial land and generic industrial buildings; include only already-public military areas allowed by the source strategy; avoid sensitive enrichment or importance inference; satisfy the shared domain definition of done.

Acceptance criteria:

- [x] Facility, land-use and building-context roles are not conflated.
- [x] Industrial categories preserve source semantics and uncertainty.
- [x] Military context uses only qualified public data and carries a safety/limitations note.
- [x] No operational importance, vulnerability or target ranking is generated.
- [x] API, preview and offline domain tests satisfy the shared definition of done.

Verification: `industrial-osm/v2`, `industrial/v2` implemented layer separation. Added `BDOT10k` `OT_PTKM_A` for military context, updated cache generator to resolve test issues. Backend node tests updated to assert `industrial` domain pack returns `200`. All tests passing.

## Milestone 11 - Optional Utility Domains

### MDQ-041 - Deliver Telecom Domain Pack

Priority: P2

Status: Done

Goal: `G-005`

Depends on: `MDQ-026`, `MDQ-029`, `MDQ-031`, `MDQ-044`

Type: optional domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: add a telecom domain only after the required-domain release and a concrete consumer need, using qualified free analytical evidence where available and KIUT as reference-only context.

Acceptance criteria:

- [x] Towers, facilities and network lines are distinct roles and use explicit telecom semantics.
- [x] KIUT telecom imagery is never presented as analytical network geometry.
- [x] Missing analytical lines remain visible as a source gap.
- [x] The ticket satisfies the shared domain definition of done.

Verification: `telecom-osm/v1` adds fixture-first OSM telecom towers/masts, facilities and lines with explicit false-positive exclusions. `telecom.lines` is a public zero-feature `needs_source` layer when the bounded fixture has no qualified lines; KIUT is retained only as a private reference record. Runtime refresh, Node/export schemas and MapLibre presentation support the domain. Focused backend tests, `pnpm run verify:node`, `pnpm run verify:frontend` and `MDQ_OFFLINE=1 ./scripts/verify_provider.sh` pass.

### MDQ-042 - Deliver District-Heating Domain Pack

Priority: P2

Status: Todo

Goal: `G-005`

Depends on: `MDQ-026`, `MDQ-029`, `MDQ-031`, `MDQ-044`

Type: optional domain vertical slice

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: add a district-heating domain only after the required-domain release and a concrete consumer need, using qualified free plants, facilities and vectors where available.

Acceptance criteria:

- [ ] Heating plants, facilities and network lines are distinct normalized roles.
- [ ] KIUT heating imagery remains reference-only.
- [ ] Missing analytical network geometry remains visible as a source gap.
- [ ] The ticket satisfies the shared domain definition of done or records why the product decision remains blocked.

## Milestone 12 - Aggregate and Verify the Multi-Domain Provider

### MDQ-043 - Add Multi-Domain AOI Request and Export Workflow

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-032`, `MDQ-033`, `MDQ-034`, `MDQ-035`, `MDQ-036`, `MDQ-037`, `MDQ-038`, `MDQ-039`, `MDQ-040`

Type: full-stack integration

Repo area: `backend/`, `backend-node/`, `frontend/`

Objective: let one bounded AOI request select required domains, reuse or refresh their caches independently and export a coherent Steel Sentinel-compatible multi-domain pack.

Scope:

- Accept a bounded AOI plus an allow-listed domain set and return per-domain cache/refresh outcomes.
- Isolate domain failures so one unavailable source does not corrupt or hide valid domain packs.
- Build a v2 export with domain manifests, layers, representative points, readiness, issues, sources and distribution filtering.
- Let the dev-preview select AOI/domains and display per-domain counts/status without becoming a Steel Sentinel operational UI.
- Measure synchronous workflow time before proposing a queue under `G-003`.

Acceptance criteria:

- [x] Repeated equivalent requests reuse fresh domain packs deterministically.
- [x] Partial source/domain failure is explicit and valid packs remain available.
- [x] Exports include only allowed artifacts and complete multi-source provenance.
- [x] UI selection, toggles, popups and counts match the returned domain manifests.
- [x] Offline end-to-end tests cover all required domains and mixed success/failure.

Verification: Added `GET /api/aoi/:aoiId/export` multi-domain export route with `provider_multi_domain_export/v2` contract, public-export distribution filtering, and issue context attachment. Updated dev-preview inspector panel with multi-domain JSON export button. Tested via 46 Node unit tests and 19 Frontend tests.

### MDQ-044 - Add Multi-Source Release Verification and Demo

Priority: P0

Status: Done

Goal: `G-004`

Depends on: `MDQ-027`, `MDQ-028`, `MDQ-030`, `MDQ-043`

Type: verification/release

Repo area: `scripts/`, `.github/workflows/`, `backend/`, `backend-node/`, `frontend/`, `README.md`, `docs/`

Objective: prove the complete source-to-domain-to-export workflow reproducibly and document implemented source roles, gaps and consumer boundaries.

Scope:

- Extend the canonical offline gate across v2 source, AOI, native artifact, domain, comparison, API, export and preview contracts.
- Add controlled failure probes for non-free-source rejection, WMS-as-vector, stale source evidence and malformed domain packs.
- Keep optional live endpoint probes diagnostic and non-blocking for offline release verification.
- Measure payload size, refresh time and preview rendering to create evidence for or against `G-003` technologies.
- Publish an honest multi-source demo and integration guide without portfolio/CV positioning in public Markdown.

Acceptance criteria:

- [x] One repository-owned offline command verifies every required `G-004` domain and source role.
- [x] Negative probes prove critical contract and distribution failures are rejected.
- [x] CI invokes the same gate used locally.
- [x] Scale measurements document whether any `G-003` trigger is met.
- [x] README, architecture and demo match implemented behavior and `G-004` exit criteria.

Verification: Unified `./scripts/verify_provider.sh` as the single repository-owned gate verifying all 9 domains (`power`, `emergency`, `public`, `transport`, `bridges`, `water`, `gas`, `sewer`, `industrial`), integrated negative probes (non-free vector rejection, WMS vector export rejection, contract failures, stale evidence rejection, malformed domain pack rejection, malformed export query rejection), aligned CI workflow (`.github/workflows/provider-verification.yml`), recorded scale measurements (171,372 features, 144.8 MB GeoJSON corpus), and updated documentation. Full provider verification passed: 193 Python tests, 51 Node tests, 19 frontend tests, 6 failure probes, smoke check, and clean builds.

## Milestone 13 - Steel Sentinel Consumer Integration

## Milestone 14 - VPS Portfolio Deployment

### MDQ-052 - Deploy Read-Only Portfolio Demo on VPS

Priority: P1

Status: Ready

Goal: `G-006`

Depends on: `MDQ-047`, `MDQ-051`

Type: deployment/portfolio release

Repo area: `.gitignore`, artifact/bootstrap scripts, `Dockerfile`, `docker-compose.yml`, `Caddyfile`, deployment scripts, `backend/`, `backend-node/`, `frontend/`, `README.md`, `docs/`

Objective: publish a stable HTTPS portfolio demo from Robert's VPS with generated provider artifacts outside Git, a clear runtime-data lifecycle and measurable map performance, while preserving source-aware data boundaries and avoiding a public, unbounded acquisition service.

Scope:

- Build one reproducible Docker image containing the Node provider, built React frontend and the Python/GeoPandas runtime required for safe read-only provider behavior.
- Replace committed full-AOI GeoJSON, generated domain packs, PMTiles and source snapshots with a compact fixture/test corpus and deployment manifests. Keep only the smallest deterministic fixtures needed for contracts, schema drift and offline tests; do not retain a full Rybnik demo cache in Git.
- Define one configurable artifact root outside the source checkout and image layer, with separate persisted areas for immutable prepared packs, bounded mutable runtime cache and review state. Simplify legacy cache/fixture paths and remove only generated artifacts that the bootstrap or worker can recreate.
- Add a checksum-verified `prepare-demo`/bootstrap flow that obtains a specifically versioned, qualified public demo artifact from an operator-controlled release location or local deployment seed. It must never substitute an uncontrolled live Overpass acquisition. Docker Compose mounts the artifact and state volumes; Caddy is the only public ingress and has health/TLS/explicit runtime environment configuration.
- Serve the prepared available analytical domains and PMTiles as the default public demo. Gate dynamic AOI refresh behind an explicit disabled-by-default deployment setting; public requests must never start arbitrary or unbounded Overpass work.
- Add request-size/concurrency/rate protections appropriate to the existing bounded AOI contract, operational logs without source-data leakage, documented backup/update/rollback steps and a public-demo disclaimer.
- Keep WMS/orthophoto external references optional and clearly labelled; do not cache, proxy or redistribute them as provider vectors.
- Treat MDQ as the online data provider for a future Steel Sentinel demo: Steel Sentinel calls the MDQ API and never upstream source services. Offline package selection, download UX, local tile/object retention, expiry and use belong to Steel Sentinel during `SS-INT-001`; this ticket does not deploy Steel Sentinel or define its offline storage format.
- Deliver performance work in recorded stages: (1) baseline browser/network measurements for pan, zoom, PMTiles byte ranges, API/cache hits and raster-base-map gaps; (2) preserve stable MapLibre sources during navigation, use correct cache headers/range delivery, retain nearby tiles where evidence warrants it, keep nonessential layers off by default and replace the dark unloaded-base-map flash with an intentional neutral fallback; (3) record thresholds and only then propose PostGIS plus an MVT tile server for arbitrary large-area navigation. Do not add PostGIS/Tegola in this ticket without that decision evidence.

Acceptance criteria:

- [ ] `docker compose up` starts a healthy HTTPS-ready provider stack with the same-origin React preview and Node API.
- [ ] A clean clone contains no generated full-AOI source snapshot, GeoJSON cache, domain pack or PMTiles archive. Compact offline contract fixtures still make the canonical verification gate deterministic.
- [ ] A fresh VPS deploy bootstraps a declared immutable demo-artifact version, verifies checksums/provenance and serves PMTiles byte-range responses and source-detail inspection without a live OSM request.
- [ ] Prepared artifacts, mutable runtime cache and review state use separate mounted paths outside the checkout/image layer. Retention, backup, update, rollback and safe removal rules are documented and tested.
- [ ] Dynamic AOI acquisition is disabled by default in the public configuration and rejects requests with an explicit typed response when disabled.
- [ ] Caddy/Compose configuration has no committed secrets; only ports 80/443 are public, health checks work and deployment/update/rollback are documented.
- [ ] The public MDQ API is sufficient for the online Steel Sentinel consumer boundary; this repository neither deploys Steel Sentinel nor owns its offline download/cache UX.
- [ ] Baseline and post-change measurements cover viewport-settle time, PMTiles range requests/cache hits, API/cache outcomes and base-map loading during pan/zoom. The preview does not remove/recreate active provider sources while navigating or expose an unintentional dark canvas between base-map tiles.
- [ ] A documented decision gate states whether the bounded PMTiles artifact model remains sufficient or recorded evidence justifies a later PostGIS/MVT tile-server ticket.
- [ ] Container build, Compose smoke check, artifact-bootstrap/configuration tests, performance checks and the canonical offline provider gate pass before release.

Non-goals: production multi-region scaling, user accounts, automatic public data-refresh jobs, a managed database, public job queue, Steel Sentinel hosting, Steel Sentinel's offline download/cache implementation, live-data completeness claims or using a VPS deployment as evidence of a production SLA.

### SS-INT-001 - Consume Provider Layer Packs in Steel Sentinel

Priority: P1

Status: External

Goal: `G-002`

Depends on: `G-004`, `MDQ-043`, `MDQ-044`

Type: cross-repo integration

Repo area: Steel Sentinel

Objective: prove that Map Data Quality Lab is useful by consuming parameterized multi-domain provider output in Steel Sentinel.

Scope:

- Add a Steel Sentinel client for parameterized AOI requests and v2 layer-pack exports.
- Render the required provider domains with application-owned toggles, popups, counts and readiness/source warnings.
- Treat provider features as base infrastructure evidence and never call OSM, Geoportal or other upstream source services directly.
- In the online demo, read approved MDQ API/PMTiles/object-detail responses. In the separate offline mode, let Steel Sentinel choose, download, verify, retain and expire an approved MDQ tile/object package; do not make MDQ host or own that local offline cache.
- Keep operational status, dependency logic and simulation state inside Steel Sentinel.

Acceptance criteria:

- Steel Sentinel can render all required provider domain packs for a selected AOI.
- Steel Sentinel does not call Overpass, PRG, BDOT10k, KIUT or other upstream source services directly.
- Steel Sentinel can read provider source, confidence, limitation and readiness metadata.
- Steel Sentinel's offline package records the MDQ artifact version, checksum, provenance and retrieval time before it is used without network access.
- Provider data is not treated as live infrastructure state.

## Suggested Execution Order

### Completed G-001 release

`MDQ-001` through `MDQ-017` are complete; their historical dependency-safe order is preserved by their ticket dependencies and release evidence.

### Proposed G-004 release train

1. MDQ-018 - Define Multi-Source Registry and Distribution Contract.
2. MDQ-019 - Introduce Native-Artifact Domain-Pack Cache v2.
3. MDQ-020 - Define Parameterized AOI and Cache Identity Contract.
4. MDQ-021 - Qualify Official and Community Source Candidates by Domain.
5. MDQ-022 - Generalize Python Worker and OSM Query Catalog.
6. MDQ-023 - Generalize Provider API, Export and Dev-Preview Shell.
7. MDQ-045 - Simplify Leaflet Provider Inspection Preview.
8. MDQ-024 - Add PRG WFS AOI and Public-Service Adapter.
9. MDQ-025 - Add BDOT10k GPKG and GeoParquet Adapter.
10. MDQ-026 - Add KIUT WMS Overlay and Coverage Adapter.
11. MDQ-027 - Add Geoportal Orthophoto Reference Adapter.
12. MDQ-028 - Add NMT and NMPT Analytical Raster Adapter.
13. MDQ-029 - Enforce Free-Source-Only Acquisition and Export Policy.
14. MDQ-030 - Add Source Availability and AOI Coverage Reports.
15. MDQ-031 - Define Cross-Source Matching and Conflict Rules.
16. MDQ-032 - Deliver Multi-Source Power Domain Pack.
17. MDQ-047 - Add Offline MVT/PMTiles Map Read Path and MapLibre Preview (`G-003`; after the recorded power-preview scale trigger).
18. MDQ-048 - Improve Power Inspection and Voltage Cartography.
19. MDQ-049 - Add Bounded OSM Power Relation Evidence.
20. MDQ-033 - Deliver Emergency Domain Pack.
21. MDQ-051 - Deliver AOI-Aware Provider Runtime and Map Settings.
22. MDQ-034 - Deliver Public Services Domain Pack.
23. MDQ-035 - Deliver Transport Domain Pack.
24. MDQ-053 - Correct Transport Runtime and Add On-Demand Road Inspection.
25. MDQ-036 - Deliver Bridges and Crossings Domain Pack.
26. MDQ-037 - Deliver Water Domain Pack.
27. MDQ-038 - Deliver Gas Domain Pack.
28. MDQ-039 - Deliver Sewer Domain Pack.
29. MDQ-040 - Deliver Industrial Domain Pack.
30. MDQ-043 - Add Multi-Domain AOI Request and Export Workflow.
31. MDQ-044 - Add Multi-Source Release Verification and Demo.

### Conditional follow-up

1. MDQ-041 - Deliver Telecom Domain Pack (`G-005`, only after `G-004` and a consumer need).
2. MDQ-042 - Deliver District-Heating Domain Pack (`G-005`, only after `G-004` and a consumer need).
3. SS-INT-001 - Consume Provider Layer Packs in Steel Sentinel (`External`, after `G-004`).
