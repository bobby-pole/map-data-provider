# Map Data Quality Lab - VPS Deployment Guide

This guide documents the production deployment architecture, host reverse proxy configuration (Caddy), operations workflow, data lifecycle, backups, retention, and maintenance for Map Data Quality Lab hosted at **`maplab.robertlacheta.pl`**.

---

## 1. Architecture Overview

- **Host Reverse Proxy**: Caddy (running on the VPS host with automatic HTTPS) proxies public traffic from `maplab.robertlacheta.pl` to `127.0.0.1:3001`.
- **Application Container**: Single production Docker container (`map-data-quality-lab-prod`) running as non-root user `appuser` (UID:GID `1001:1001`).
  - **Node.js 22 Express Provider**: Serves public REST API (`/api/*`), PMTiles archive streaming, in-memory rate limiting / concurrency protection, and static SPA frontend.
  - **Python 3.14 + uv**: Geospatial processing CLI engine used during bootstrap and offline data preparation.
- **Read-Only Demo Mode**: Mutating/refresh endpoints (`POST /api/aoi/requests`, `POST /api/aoi/runtime-requests`, `POST /api/aoi/runtime-jobs`) are blocked with typed `runtime_disabled` (HTTP 403) responses, preventing unauthenticated Overpass queries or worker execution.
- **Storage Volumes**:
  - `data/prepared`: Prepared domain packs and PMTiles presentation archives (`MDQ_PREPARED_ROOT`).
  - `data/bundle/rybnik_35km`: Externally provisioned, immutable demo bundle mounted read-only. It is not part of the image or Git repository.
  - `data/reviews`: Durable issue review decision store (`MDQ_REVIEW_ROOT`).
  - `data/runtime`: Runtime request outcomes cache (`MDQ_RUNTIME_ROOT`).

---

## 2. Initial VPS Setup

### Step 1: Prepare directory structure

On the VPS as user `deploy`:

```bash
mkdir -p /home/deploy/map-data-quality-lab/data/{bundle/rybnik_35km,prepared,reviews,runtime}
sudo chown -R 1001:1001 /home/deploy/map-data-quality-lab/data
chmod -R 750 /home/deploy/map-data-quality-lab/data

# Copy a prepared bundle, including demo_bundle_manifest.json, into
# data/bundle/rybnik_35km. Its bundle_id must match MDQ_DEMO_BUNDLE_ID.
chmod -R a-w /home/deploy/map-data-quality-lab/data/bundle/rybnik_35km
```

### Step 2: Configure Caddy

The repository includes a production `Caddyfile`. The host configuration should
import the drop-in directory:

```caddy
import /etc/caddy/conf.d/*.caddy
```

The deployment workflow installs the repository file automatically when
`VPS_CADDY_CONFIG_PATH=/etc/caddy/conf.d/map-data-quality-lab.caddy` is set.
Otherwise, copy it manually into the imported directory:

```caddy
maplab.robertlacheta.pl {
    encode zstd gzip

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    reverse_proxy 127.0.0.1:3001 {
        header_up Host {host}
        header_up X-Real-IP {remote}
        header_up X-Forwarded-For {remote}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

### Step 3: Configure GitHub Repository Secrets

In GitHub repo settings (_Settings -> Secrets and variables -> Actions_):

- `VPS_HOST`: VPS IP address or host.
- `VPS_USER`: SSH user (e.g. `deploy`).
- `VPS_SSH_KEY`: SSH private key.
- `VPS_DEMO_BUNDLE_ID`: immutable ID of the bundle already provisioned under `data/bundle/rybnik_35km`.
- `VPS_CADDY_CONFIG_PATH`: optional Caddy drop-in path, normally `/etc/caddy/conf.d/map-data-quality-lab.caddy`.

---

## 3. Deployment & CI/CD Pipeline

Pushes to the `main` branch automatically trigger `.github/workflows/deploy.yml`:

1. **Verification Gate**: Runs `pnpm run verify:provider` ensuring all tests, negative probes, linter, formatting, and builds pass.
2. **Build & Push**: Builds multi-stage Docker image and pushes immutable tag `ghcr.io/bobby-pole/map-data-quality-lab:${GITHUB_SHA}` and `latest`.
3. **Deploy**: Requires the external bundle and its ID, copies `docker-compose.prod.yml` and `Caddyfile` to `/home/deploy/map-data-quality-lab/`, writes immutable image/bundle IDs to `.env`, pulls the image, optionally validates/reloads Caddy, restarts the container, and verifies health via `http://127.0.0.1:3001/api/health`.

Prepare a bundle from an existing local prepared cache with:

```bash
./scripts/prepare_demo.sh /path/to/rybnik_35km /path/to/mdq-demo-bundle rybnik-35km-2026-08-24
rsync -a --delete /path/to/mdq-demo-bundle/rybnik_35km/ deploy@VPS:/home/deploy/map-data-quality-lab/data/bundle/rybnik_35km/
```

The container validates every declared file, checksum, domain-pack version and
bundle ID at startup. A missing or corrupted bundle causes controlled startup
failure; it never serves an empty public demo.

---

## 4. Data Lifecycle, Backup, Retention & Purge

### Backup Procedure

To create a timestamped backup of review state and prepared artifacts on the VPS:

```bash
BACKUP_DIR="/home/deploy/backups"
mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

tar -czf "${BACKUP_DIR}/mdq_data_backup_${TIMESTAMP}.tar.gz" \
  -C /home/deploy/map-data-quality-lab/data reviews prepared bundle
```

### Retention & Pruning

- **Prepared artifacts (`data/prepared`)**: Retained permanently as immutable demo baselines.
- **Review store (`data/reviews/issue-reviews.json`)**: Durable operator audit log. Retained across deployments.
- **Runtime cache (`data/runtime`)**: Ephemeral 24-hour cache. To prune runtime cache older than 7 days:

```bash
find /home/deploy/map-data-quality-lab/data/runtime -type f -mtime +7 -delete
find /home/deploy/map-data-quality-lab/data/runtime -type d -empty -delete
```

### Safe Purge / Reset

To safely reset the environment to a clean initial state:

```bash
cd /home/deploy/map-data-quality-lab
docker compose -f docker-compose.prod.yml down
rm -rf data/runtime/* data/prepared/*
# Recreate empty review store if desired:
echo '{"review_store_version":"provider_issue_reviews/v1","reviews":[]}' > data/reviews/issue-reviews.json
docker compose -f docker-compose.prod.yml up -d
```

---

## 5. Rollback & Maintenance

### Rollback to a specific commit

To roll back to a known previous deployment SHA without rebuilding:

```bash
cd /home/deploy/map-data-quality-lab
echo "MDQ_IMAGE_TAG=<PREVIOUS_GITHUB_SHA>" > .env
docker compose -f docker-compose.prod.yml up -d
```

### Manual Restart & Logs

```bash
cd /home/deploy/map-data-quality-lab
docker compose -f docker-compose.prod.yml logs -f --tail 50
docker compose -f docker-compose.prod.yml restart
```
