# Documentation Index

Core architecture, operator guides, and delivery measurements for Map Data Provider.

## Architecture

- [Architecture & Provider Contracts](./architecture/architecture.md) — system boundaries, domain packs, PMTiles presentation pipeline, source registry, and API contracts.
- [UI/UX Design Baseline](../DESIGN.md) — canonical frontend inspection and interaction baseline.

## Guides

- [3–5 Minute Provider Demo](./guides/demo.md) — local demo walkthrough using verified demo bundles, `curl`/`jq` checks, and the React/MapLibre dev-preview.
- [VPS Deployment Guide](./guides/deployment.md) — Nginx Proxy Manager + Cloudflare setup, Docker Compose production deployment, bundle preparation, backups, and rollback.
- [Delivery Measurement Procedure](./guides/performance_baseline.md) — reproducible API latency, PMTiles ETag revalidation, and fixture-worker timing procedure.
- [Contributing Guide](../CONTRIBUTING.md) — local environment setup, verification gates (`verify:pre-push` and `verify:provider`), and repository conventions.

## Measurements

- [Measurement Reports](./measurements/README.md) — dated raw JSON delivery benchmarks (`docs/measurements/*.json`) matched against deployed demo bundles.
