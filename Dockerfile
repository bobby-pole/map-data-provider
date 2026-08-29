# --- Stable CPython runtime for the production Node image ---
FROM python:3.14.4-slim-bookworm AS python-runtime

# --- STAGE 1: Build Frontend (React 19 + MapLibre + Vite) ---
FROM node:22-bookworm-slim AS build-frontend

WORKDIR /app
RUN npm install -g pnpm@11

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/ ./frontend/

WORKDIR /app/frontend
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm run build

# --- STAGE 2: Build Backend Node (Express + TypeScript) ---
FROM node:22-bookworm-slim AS build-backend-node

WORKDIR /app
RUN npm install -g pnpm@11

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend-node/ ./backend-node/

WORKDIR /app/backend-node
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm run build

# --- STAGE 3: Production Image (Node + Python Geospatial Runtime) ---
FROM node:22-bookworm-slim AS production

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv for Python environment management (pinned version)
COPY --from=ghcr.io/astral-sh/uv:0.6.2 /uv /uvx /bin/
# `uv:0.6.2` predates stable Python 3.14 and resolves `3.14` to an alpha
# build. Copy the exact supported CPython instead, so binary wheels such as
# NumPy share the interpreter ABI they were built for.
COPY --from=python-runtime /usr/local /usr/local

# Create non-root user (UID/GID 1001)
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m -s /bin/bash appuser

# Configure Python virtual environment via uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --python /usr/local/bin/python3.14

# Copy backend Python code and data fixtures
COPY backend/ ./

# Copy compiled frontend static assets
COPY --from=build-frontend /app/frontend/dist /app/static

# Committed delivery reports are served only after the API verifies that their
# bundle manifest hash matches the mounted, checksummed demo bundle.
COPY docs/measurements /app/measurements

# Copy compiled backend-node and node_modules
WORKDIR /app/backend-node
COPY --from=build-backend-node /app/backend-node/dist ./dist
COPY --from=build-backend-node /app/backend-node/package.json ./package.json
COPY --from=build-backend-node /app/node_modules /app/node_modules
COPY --from=build-backend-node /app/backend-node/node_modules ./node_modules

# Copy entrypoint script
WORKDIR /app
COPY scripts/docker_entrypoint.sh /app/scripts/docker_entrypoint.sh
RUN chmod +x /app/scripts/docker_entrypoint.sh

# Create persistent storage mount directories and set ownership
RUN mkdir -p /app/data/prepared /app/data/reviews /app/data/runtime /app/data/bundle && \
    chown -R appuser:appgroup /app && \
    chmod -R 750 /app/data

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3001
ENV STATIC_DIR=/app/static
ENV MDQ_RUNTIME_MODE=disabled
ENV MDQ_PREPARED_ROOT=/app/data/prepared
ENV MDQ_REVIEW_ROOT=/app/data/reviews
ENV MDQ_RUNTIME_ROOT=/app/data/runtime
ENV MDQ_BUNDLE_SOURCE=/app/data/bundle/rybnik_35km
ENV MDQ_REQUIRE_DEMO_BUNDLE=true
ENV MDQ_MEASUREMENTS_ROOT=/app/measurements
ENV MDQ_DATA_DIR=/app/backend/data
ENV MDQ_BACKEND_DIR=/app/backend
ENV PATH="/app/backend/.venv/bin:$PATH"

USER appuser
WORKDIR /app/backend
# Keep this in the final, non-root image: it executes the already prepared
# virtualenv directly, avoiding another uv interpreter-resolution step.
RUN /app/backend/.venv/bin/python -c "from geo_pipeline.aoi_runtime import administrative_catalog, preflight_runtime_request; assert len(administrative_catalog()['units']) == 2875; assert preflight_runtime_request({'aoi': {'type': 'point_radius', 'longitude': 18.55, 'latitude': 50.1, 'radius_m': 1000}, 'profiles': ['power']})['status'] == 'ready'"
WORKDIR /app
EXPOSE 3001

ENTRYPOINT ["/app/scripts/docker_entrypoint.sh"]
