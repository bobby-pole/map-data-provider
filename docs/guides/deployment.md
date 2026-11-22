# Map Lab - VPS Deployment Guide

This guide documents the production deployment architecture, reverse proxy and TLS termination setup, operations workflow, data lifecycle, backups, retention, and maintenance for Map Lab.

---

## 1. Architecture Overview

- **Public Reverse Proxy**: A reverse proxy on the host owns public ports 80/443 and forwards `<public-demo-domain>` over an external Docker bridge network (`<proxy-network>`) to `<app-container>:3001`, using encrypted origin TLS (`Full (strict)`).
- **Application Container**: Single production Docker container running as non-root user `appuser` (UID:GID `1001:1001`).
  - **Node.js 22 Express Provider**: Serves public REST API (`/api/*`), PMTiles archive streaming, Helmet HTTP security headers (with CSP scoped to MapLibre/tile origins), in-memory rate limiting / concurrency protection, and static SPA frontend.
  - **Python 3.14 + uv**: Geospatial processing CLI engine used during bootstrap and offline data preparation.
- **Controlled Demo Acquisition**: Compose sets `MDQ_RUNTIME_MODE=demo_fixed_aoi` and `MDQ_DEMO_AOI_TEMPLATE=rybnik_gmina_demo`. Issue review mutations (`PATCH /api/aoi/:aoiId/issues/:issueId/review`) are blocked (`403 demo_aoi_restricted`) in public demo mode. The public demo acquisition path accepts a server-validated point/radius (at most 10 km and wholly inside Poland) or one-county PRG selection, always runs all 11 domains, and builds PMTiles for the new map presentation. Generic runtime endpoints, force refresh and out-of-policy requests return `demo_aoi_restricted` (HTTP 403), so the VPS is not an unauthenticated Overpass proxy.
- **Storage Volumes**:
  - `data/prepared`: Prepared domain packs and PMTiles presentation archives (`MDQ_PREPARED_ROOT`).
  - `data/bundle/rybnik_35km`: Externally provisioned, immutable demo bundle mounted read-only. It is not part of the image or Git repository.
  - `data/reviews`: Durable issue review decision store (`MDQ_REVIEW_ROOT`).
  - `data/runtime`: Runtime request outcomes cache (`MDQ_RUNTIME_ROOT`).

---

## 2. Initial VPS Setup

### Step 1: Prepare directory structure

On the VPS with appropriate host permissions (matching UID/GID `1001:1001` for container volumes):

```bash
mkdir -p <deploy-dir>/data/{bundle/rybnik_35km,prepared,reviews,runtime}
chown -R 1001:1001 <deploy-dir>/data/{prepared,reviews,runtime}
chmod -R u=rwX,g=rX,o= <deploy-dir>/data/{prepared,reviews,runtime}

# Copy a prepared bundle, including demo_bundle_manifest.json, into
# data/bundle/rybnik_35km. Its bundle_id must match MDQ_DEMO_BUNDLE_ID.
chown -R 1001:1001 <deploy-dir>/data/bundle/rybnik_35km
chmod -R a-w <deploy-dir>/data/bundle/rybnik_35km
```

The GitHub deployment job never changes ownership or permissions of the bundle.
To replace it, temporarily allow a privileged upload, validate its manifest and
then make it immutable again:

```bash
ssh <deploy-user>@<vps-host> 'chmod -R u+w <deploy-dir>/data/bundle/rybnik_35km'
rsync -a --delete /local/new-bundle/rybnik_35km/ \
  <deploy-user>@<vps-host>:<deploy-dir>/data/bundle/rybnik_35km/
ssh <deploy-user>@<vps-host> 'chown -R 1001:1001 <deploy-dir>/data/bundle/rybnik_35km && chmod -R a-w <deploy-dir>/data/bundle/rybnik_35km'
```

### Step 2: Configure DNS, Origin TLS and Reverse Proxy

Point your DNS `A` record for `<public-demo-domain>` to the VPS IPv4 address with strict origin TLS enabled (`Full (strict)`; never use `Flexible` for this origin).

Install an origin certificate and private key on the VPS host for your reverse proxy:

```bash
sudo install -d -o root -g root -m 0700 /etc/ssl/origin
sudo install -o root -g root -m 0600 origin.key /etc/ssl/origin/<public-demo-domain>.key
sudo install -o root -g root -m 0644 origin.pem /etc/ssl/origin/<public-demo-domain>.pem
```

Configure the reverse proxy host for `<public-demo-domain>` to forward `http://<app-container>:3001` over `<proxy-network>`, with forced HTTPS and HTTP/2 enabled. Because the reverse proxy and Map Lab share the external Docker network, the proxy resolves the application container internally without exposing port `3001` publicly.

Keep only public HTTP/HTTPS ports (80 and 443) open to visitors/CDN. Docker binds application port `3001` to loopback only (`127.0.0.1:3001`); do not open port `3001` in the host firewall or cloud security group.

### Step 3: Configure GitHub Repository Secrets

In GitHub repo settings (_Settings -> Secrets and variables -> Actions_):

- `VPS_HOST`: VPS IP address or host.
- `VPS_USER`: dedicated SSH deployment user.
- `VPS_SSH_KEY`: SSH private key.
- `VPS_DEMO_BUNDLE_ID`: immutable ID of the bundle already provisioned under `data/bundle/rybnik_35km`.

---

## 3. Deployment & CI/CD Pipeline

Pushes to the `main` branch automatically trigger `.github/workflows/deploy.yml`:

1. **Verification Gate**: Runs `pnpm run verify:provider` ensuring all tests, negative probes, linter, formatting, and builds pass.
2. **Build & Push**: Builds multi-stage Docker image and pushes immutable tag `ghcr.io/<owner>/<repo>:${GITHUB_SHA}` and `latest`.
3. **Deploy**: Requires the external bundle and its ID, copies `docker-compose.prod.yml` to the deploy directory, removes only older unused Map Lab images while retaining the running image and two newest rollback candidates, prunes stale runtime/build cache, refuses the pull when less than 2 GiB remains, writes immutable image/bundle IDs to `.env`, pulls the image, starts the container and verifies health via `http://127.0.0.1:3001/api/health`. Reverse-proxy host configuration is durable state and is not rewritten by CI.

### Publish delivery evidence

After measuring a verified local copy of the same bundle mounted on the VPS,
commit the generated `docs/measurements/*.json` before deploying the image.
The report includes the bundle ID and SHA-256 of its manifest. The public
`/api/metrics/delivery` endpoint and preview panel publish it only if both
values match the prepared bundle promoted at container startup. A stale report
is deliberately unavailable rather than relabelled as current performance.

Prepare a bundle from an existing local prepared cache with:

```bash
# Rebuild all domain packs after a source-policy or data-licence contract change.
# This intentionally replaces the local prepared Rybnik cache with deterministic fixtures.
for domain in power emergency public transport bridges water gas sewer industrial telecom district_heating; do
  (cd backend && uv run python -m geo_pipeline.worker \
    --aoi rybnik_35km --domain "$domain" --input fixture)
done

./scripts/ops/prepare_demo.sh /path/to/rybnik_35km /path/to/mdq-demo-bundle rybnik-35km-2026-08-24
rsync -a --delete /path/to/mdq-demo-bundle/rybnik_35km/ <deploy-user>@<vps-host>:<deploy-dir>/data/bundle/rybnik_35km/
ssh <deploy-user>@<vps-host> 'chown -R 1001:1001 <deploy-dir>/data/bundle/rybnik_35km && chmod -R a-w <deploy-dir>/data/bundle/rybnik_35km'
```

`prepare_demo.sh` now verifies source eligibility and data-licence notices as
well as file checksums. It rejects a bundle with a public non-OSM artifact or a
public OSM artifact without its ODbL notice. The container validates every
declared file, checksum, domain-pack version and bundle ID at startup. A
missing or corrupted bundle causes controlled startup failure; it never serves
an empty public demo.

### Prepare MDQ-057 snapshots

The default regional source is the operator-only `rybnik_35km` baseline (35 km
around the configured Rybnik centre), with all 11 provider domains. Demo jobs
are limited to 10 km/one PRG county and build PMTiles so the map can switch to
the new AOI. Local and trusted Steel Sentinel preparation may use up to 30 km or
three adjacent counties and may build PMTiles. Prepare the default snapshot on a trusted workstation with
a persistent root outside Git:

```bash
cd backend
uv run python ../scripts/data/prepare_regional_snapshots.py rybnik_35km \
  --prepared-root /srv/mdq/prepared
```

The command validates every ready domain pack, writes
`acquisition_evidence.json` before the checksummed snapshot manifest, and
retains the preceding AOI directory under `previous/` for rollback. Restore the
latest backup explicitly with `--rollback`; do not replace a mounted prepared
snapshot in place without retaining its source-dated evidence.

---

## 4. Data Lifecycle, Backup, Retention & Purge

### Backup Procedure

To create a timestamped backup of review state and prepared artifacts on the VPS:

```bash
BACKUP_DIR="<backup-dir>"
mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

tar -czf "${BACKUP_DIR}/mdq_data_backup_${TIMESTAMP}.tar.gz" \
  -C <deploy-dir>/data reviews prepared bundle
```

### Retention & Pruning

- **Prepared artifacts (`data/prepared`)**: Retained permanently as immutable demo baselines.
- **Review store (`data/reviews/issue-reviews.json`)**: Durable operator audit log. Retained across deployments.
- **Runtime cache (`data/runtime`)**: Ephemeral 24-hour cache. To prune runtime cache older than 7 days:

```bash
find <deploy-dir>/data/runtime -type f -mtime +7 -delete
find <deploy-dir>/data/runtime -type d -empty -delete
```

- **Application images**: CI retains the running image and the two newest rollback
  candidates for the application image; older tags are removed before each pull.
  This is strictly scoped to Map Lab and does not prune images used by other
  applications on the host.
- **Container logs**: The Compose service uses Docker's `json-file` driver with
  a 10 MiB maximum per file and three rotated files (30 MiB maximum for Map Lab).
- **Build cache**: Unused BuildKit cache older than seven days is pruned before
  each deployment. Prepared snapshots, the immutable bundle and review state
  are never part of this cleanup.
- **Bootstrap staging**: Interrupted bundle bootstraps are stored under hidden
  `.bootstrap_stage_*` directories only until atomic promotion. Stages older
  than 60 minutes are removed at container start and before each deployment;
  published snapshots are not matched by this pattern.

To inspect disk pressure without reading application logs:

```bash
df -h /
docker system df
docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}'
```

### Safe Purge / Reset

To safely reset the environment to a clean initial state:

```bash
cd <deploy-dir>
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
cd <deploy-dir>
echo "MDQ_IMAGE_TAG=<PREVIOUS_GITHUB_SHA>" > .env
docker compose -f docker-compose.prod.yml up -d
```

### Manual Restart & Logs

```bash
cd <deploy-dir>
docker compose -f docker-compose.prod.yml logs -f --tail 50
docker compose -f docker-compose.prod.yml restart
```
