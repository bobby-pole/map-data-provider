# Documentation

This directory contains documentation for Map Data Quality Lab.

The root [`README.md`](../README.md) is the project entry point. This file is
only the index for the public documents below; it is not a second project
README.

## Public documentation — tracked by Git

- [`architecture.md`](./architecture.md) describes the public provider architecture, contracts and API/runtime boundaries.
- [`demo.md`](./demo.md) is the short, reproducible provider demonstration runbook.
- [`../DESIGN.md`](../DESIGN.md) is the canonical UI/UX baseline for the map preview and visual changes.
- [`../README.md`](../README.md) is the repository entry point, setup guide and product overview.
- Data-specific working notes and detailed QA records stay in the ignored local project context rather than in this public documentation set.

## Local development context — not tracked

`docs/local/` contains project-operating material: goals, status, decisions,
tickets, ticket specs, detailed visual QA and private strategy notes. It is
ignored by Git through the repository `.gitignore` and must not be linked from
public documentation. The local Polish mirror also lives there and is not a
second public documentation tree.

## Codex configuration — not tracked

`.codex/` contains local Codex skills and configuration. It is separate from project documentation and is ignored by Git.
