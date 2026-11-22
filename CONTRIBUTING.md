# Contributing

Thank you for your interest in contributing. Keep this repository clean, reproducible, and aligned with the verification gates below.

## Prerequisites

- **Node.js** 22+ and **pnpm** `11.0.9`
- **uv** (`0.11+` locally; CI pins `0.13.8`) with **Python 3.14** (configured via [`backend/.python-version`](./backend/.python-version))

## Local Setup

1. Install Python dependencies (and let `uv` provision Python 3.14 if needed):

   ```bash
   (cd backend && uv python install && uv sync --locked --dev)
   ```

2. Install workspace JavaScript dependencies and activate the `pre-push` hook:

   ```bash
   pnpm install
   ```

   (`pnpm install` runs `pnpm run prepare`, which points `core.hooksPath` to `.githooks/` via [`scripts/ci/setup_git_hooks.sh`](./scripts/ci/setup_git_hooks.sh).)

3. Optionally copy the environment template:

   ```bash
   cp .env.example .env
   ```

4. Start local development servers in separate terminals:

   ```bash
   pnpm --dir backend-node run dev
   pnpm --dir frontend run dev
   ```

   Or run the full production-like container locally:

   ```bash
   docker compose up --build
   ```

## Verification Gates

Run the fast check before pushing (also executed automatically by `.githooks/pre-push`):

```bash
pnpm run verify:pre-push
```

Run the full CI-equivalent gate (includes full `pytest -W error -n auto` suite and all 6 negative contract failure probes):

```bash
pnpm run verify:provider
```

Component-specific checks:

```bash
pnpm run verify:node
pnpm run verify:frontend
pnpm run format:check
(cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest -q -W error -n auto)
```

If you are working offline with a warm `uv` cache, set `MDQ_OFFLINE=1` when running the verification scripts.

## Repository Conventions

- **Wire & Environment Compatibility**: Do not break `provider_*` response/artifact contracts or existing `MDQ_*` environment variable names without explicit migration notes.
- **Modular Package Structure & Facades**:
  - `backend/geo_pipeline/`: Keep public entrypoints and monkeypatch-compatible facades (`domain_pack.py`, `runtime_osm.py`, `worker.py`) stable when refactoring internal submodules (`domains/`, `packs/`, `runtime/`, `sources/`, `raster/`).
  - `backend-node/src/`: Group AOI endpoints under `routes/aoi/`, keep API contracts modular under `types/`, and place shared test fixtures in `test/` rather than `routes/`. Note `.js` import extensions per `NodeNext` module resolution.
  - `frontend/src/`: Keep pure TypeScript helpers, constants, and stores in `.ts` files separate from `.tsx` React component modules to satisfy `react-refresh`, keep API types split under `types/api/` with a `types/api.ts` re-export facade, and avoid sibling filenames that differ only by letter case on case-insensitive filesystems such as macOS (for example, `treeSelection.ts` alongside `AdministrativeTree.tsx`).
- **No Runtime Artifacts in Git**: Generated caches, demo bundles, `output/`, `backend/cache/`, and `docs/local/` are ignored and must not be committed.
- **Script Layout**:
  - `scripts/ci/`: CI verification, git hooks, and negative failure probes.
  - `scripts/ops/`: Container entrypoint, demo bundle tooling, and delivery measurement scripts.
  - `scripts/data/`: Dataset catalog and regional snapshot preparation utilities.
- **Documentation**: Start at [`docs/README.md`](./docs/README.md) when updating architectural or operational guides.
