# Map Data Provider - VPS Deployment Guide

This guide documents the production deployment architecture, Nginx Proxy Manager and Cloudflare configuration, operations workflow, data lifecycle, backups, retention, and maintenance for Map Data Provider hosted at **`maplab.robertlacheta.pl`**.

---

## 1. Architecture Overview

- **Public Reverse Proxy**: The existing Dockerized Nginx Proxy Manager (NPM) owns VPS ports 80/443 and proxies `maplab.robertlacheta.pl` over the external Docker network `app_network` to `map-data-provider-prod:3001`. Cloudflare terminates visitor TLS and NPM uses a Cloudflare Origin Certificate for the encrypted origin connection.
- **Application Container**: Single production Docker container (`map-data-provider-prod`) running as non-root user `appuser` (UID:GID `1001:1001`).
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

### Step 0: Migrate an already provisioned bundle

If the Rybnik bundle was uploaded under the former repository name but no MDQ
container has been deployed yet, rename the parent directory once before the
first deployment:

```bash
test -d /home/deploy/map-data-quality-lab
test ! -e /home/deploy/map-data-provider
mv /home/deploy/map-data-quality-lab /home/deploy/map-data-provider
```

This preserves the immutable bundle and its `bundle_id`; it only changes the
host directory that Compose mounts. Do not run the command after a production
container has been deployed without first stopping and assessing that service.

### Step 1: Prepare directory structure

On the VPS as `root` (the GitHub deployment identity):

```bash
mkdir -p /home/deploy/map-data-provider/data/{bundle/rybnik_35km,prepared,reviews,runtime}
chown -R 1001:1001 /home/deploy/map-data-provider/data/{prepared,reviews,runtime}
chmod -R u=rwX,g=rX,o= /home/deploy/map-data-provider/data/{prepared,reviews,runtime}

# Copy a prepared bundle, including demo_bundle_manifest.json, into
# data/bundle/rybnik_35km. Its bundle_id must match MDQ_DEMO_BUNDLE_ID.
chown -R 1001:1001 /home/deploy/map-data-provider/data/bundle/rybnik_35km
chmod -R a-w /home/deploy/map-data-provider/data/bundle/rybnik_35km
```

The GitHub deployment job never changes ownership or permissions of the bundle.
To replace it, temporarily allow a privileged upload, validate its manifest and
then make it immutable again:

```bash
ssh root@VPS 'chmod -R u+w /home/deploy/map-data-provider/data/bundle/rybnik_35km'
rsync -a --delete /local/new-bundle/rybnik_35km/ \
  root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km/
ssh root@VPS 'chown -R 1001:1001 /home/deploy/map-data-provider/data/bundle/rybnik_35km && chmod -R a-w /home/deploy/map-data-provider/data/bundle/rybnik_35km'
```

### Step 2: Configure Cloudflare and Nginx Proxy Manager

In Cloudflare DNS, create a proxied (orange-cloud) `A` record for
`maplab.robertlacheta.pl` pointing to the VPS IPv4 address. Set SSL/TLS
encryption mode to **Full (strict)**; never use `Flexible` for this origin.

Create a Cloudflare Origin Certificate for `maplab.robertlacheta.pl` and place
the certificate and private key on the VPS:

```bash
sudo install -d -o root -g root -m 0700 /etc/ssl/cloudflare
sudo install -o root -g root -m 0600 maplab-origin.key /etc/ssl/cloudflare/maplab.robertlacheta.pl.key
sudo install -o root -g root -m 0644 maplab-origin.pem /etc/ssl/cloudflare/maplab.robertlacheta.pl.pem
```

In NPM, import the Cloudflare Origin Certificate as a **Custom** SSL
certificate. Create a Proxy Host with domain `maplab.robertlacheta.pl`, scheme
`http`, forward hostname `map-data-provider-prod` and port `3001`. Select
the imported certificate, enable **Force SSL** and **HTTP/2 Support**, then
save. NPM and Map Data Provider share the pre-existing external Docker network
`app_network`; the public proxy resolves the provider container by name without
a public app port.

Keep ports 80 and 443 open to Cloudflare. Docker publishes only
`127.0.0.1:3001`; do not expose port 3001 in a firewall or public security
group.

### Step 3: Configure GitHub Repository Secrets

In GitHub repo settings (_Settings -> Secrets and variables -> Actions_):

- `VPS_HOST`: VPS IP address or host.
- `VPS_USER`: `root`.
- `VPS_SSH_KEY`: SSH private key.
- `VPS_DEMO_BUNDLE_ID`: immutable ID of the bundle already provisioned under `data/bundle/rybnik_35km`.

---

## 3. Deployment & CI/CD Pipeline

Pushes to the `main` branch automatically trigger `.github/workflows/deploy.yml`:

1. **Verification Gate**: Runs `pnpm run verify:provider` ensuring all tests, negative probes, linter, formatting, and builds pass.
2. **Build & Push**: Builds multi-stage Docker image and pushes immutable tag `ghcr.io/bobby-pole/map-data-provider:${GITHUB_SHA}` and `latest`.
3. **Deploy**: Requires the external bundle and its ID, copies `docker-compose.prod.yml` to `/home/deploy/map-data-provider/`, writes immutable image/bundle IDs to `.env`, pulls the image, starts the container on `app_network` and verifies health via `http://127.0.0.1:3001/api/health`. NPM Proxy Host configuration is durable host state and is not rewritten by CI.

Prepare a bundle from an existing local prepared cache with:

```bash
# Rebuild all domain packs after a source-policy or data-licence contract change.
# This intentionally replaces the local prepared Rybnik cache with deterministic fixtures.
for domain in power emergency public transport bridges water gas sewer industrial telecom district_heating; do
  (cd backend && uv run python -m geo_pipeline.worker \
    --aoi rybnik_35km --domain "$domain" --input fixture)
done

./scripts/prepare_demo.sh /path/to/rybnik_35km /path/to/mdq-demo-bundle rybnik-35km-2026-08-24
rsync -a --delete /path/to/mdq-demo-bundle/rybnik_35km/ root@VPS:/home/deploy/map-data-provider/data/bundle/rybnik_35km/
ssh root@VPS 'chown -R 1001:1001 /home/deploy/map-data-provider/data/bundle/rybnik_35km && chmod -R a-w /home/deploy/map-data-provider/data/bundle/rybnik_35km'
```

`prepare_demo.sh` now verifies source eligibility and data-licence notices as
well as file checksums. It rejects a bundle with a public non-OSM artifact or a
public OSM artifact without its ODbL notice. The container validates every
declared file, checksum, domain-pack version and bundle ID at startup. A
missing or corrupted bundle causes controlled startup failure; it never serves
an empty public demo.

---

## 4. Data Lifecycle, Backup, Retention & Purge

### Backup Procedure

To create a timestamped backup of review state and prepared artifacts on the VPS:

```bash
BACKUP_DIR="/home/deploy/backups"
mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

tar -czf "${BACKUP_DIR}/mdq_data_backup_${TIMESTAMP}.tar.gz" \
  -C /home/deploy/map-data-provider/data reviews prepared bundle
```

### Retention & Pruning

- **Prepared artifacts (`data/prepared`)**: Retained permanently as immutable demo baselines.
- **Review store (`data/reviews/issue-reviews.json`)**: Durable operator audit log. Retained across deployments.
- **Runtime cache (`data/runtime`)**: Ephemeral 24-hour cache. To prune runtime cache older than 7 days:

```bash
find /home/deploy/map-data-provider/data/runtime -type f -mtime +7 -delete
find /home/deploy/map-data-provider/data/runtime -type d -empty -delete
```

### Safe Purge / Reset

To safely reset the environment to a clean initial state:

```bash
cd /home/deploy/map-data-provider
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
cd /home/deploy/map-data-provider
echo "MDQ_IMAGE_TAG=<PREVIOUS_GITHUB_SHA>" > .env
docker compose -f docker-compose.prod.yml up -d
```

### Manual Restart & Logs

```bash
cd /home/deploy/map-data-provider
docker compose -f docker-compose.prod.yml logs -f --tail 50
docker compose -f docker-compose.prod.yml restart
```
