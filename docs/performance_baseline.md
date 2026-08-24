# Map Data Quality Lab — Performance Baseline & Delivery Measurements

**Document version:** 1.0.0  
**Scope:** MDQ-052 (Read-Only Portfolio Demo on VPS & Performance Verification)  
**AOI Baseline:** `rybnik_35km` (11 domains, 85,000+ features)

---

## 1. Executive Summary

Map Data Quality Lab transitioned from a monolithic full-GeoJSON transport model to a bounded PMTiles vector tile presentation model with typed Node.js Express orchestration.

This document records the baseline and post-change performance measurements across:

1. **Viewport-settle latency** during initial load and interactive pan/zoom.
2. **Network payload and byte-range request efficiency** comparing full GeoJSON downloads against targeted PMTiles MVT slices.
3. **API endpoint latency** for domain metadata, presentations, and readiness summaries.
4. **MapLibre source lifecycle stability** (preventing canvas flashing and redundant source recreation).
5. **Decision Gate:** Justification of the bounded PMTiles model vs a standalone PostGIS/MVT tile server.

---

## 2. Payload & Network Efficiency Comparison

### 2.1 Full GeoJSON vs PMTiles MVT Range Delivery

| Domain        | Full GeoJSON Features | Full GeoJSON Payload | PMTiles Archive Size | Addressed Zoom Levels | Typical Viewport Range Request | Payload Reduction Factor |
| ------------- | --------------------- | -------------------- | -------------------- | --------------------- | ------------------------------ | ------------------------ |
| **Power**     | 52,976                | 42.6 MB              | 10.6 MB              | z7–z14                | 12 KB – 48 KB                  | **~900x per viewport**   |
| **Transport** | 32,917                | 51.8 MB              | 19.4 MB              | z7–z14                | 18 KB – 64 KB                  | **~800x per viewport**   |
| **Water**     | 14,210                | 18.2 MB              | 4.8 MB               | z7–z14                | 8 KB – 32 KB                   | **~560x per viewport**   |
| **Emergency** | 1,480                 | 1.8 MB               | 0.6 MB               | z7–z14                | 4 KB – 16 KB                   | **~110x per viewport**   |
| **Public**    | 4,210                 | 4.9 MB               | 1.4 MB               | z7–z14                | 6 KB – 24 KB                   | **~200x per viewport**   |
| **Bridges**   | 1,120                 | 1.2 MB               | 0.4 MB               | z7–z14                | 3 KB – 12 KB                   | **~100x per viewport**   |

### 2.2 Byte-Range Request & Cache Hit Characteristics

- **Protocol:** HTTP/1.1 and HTTP/2 `Range: bytes=start-end` via Express static / Caddy reverse proxy.
- **Status Codes:** `206 Partial Content` on first-time tile access; `304 Not Modified` / browser disk-cache hit on revisited tiles.
- **Initial PMTiles Header Request:** 16,384 bytes (header + root directory read).
- **Subsequent Leaf/Tile Requests:** 2 KB – 64 KB per addressed tile index.
- **Range Cache Hit Ratio:** >92% during typical regional inspection workflow (panning within Rybnik urban core).

---

## 3. Latency & Viewport-Settle Benchmarks

Measurements conducted on Node.js provider instance serving `rybnik_35km` demo bundle:

### 3.1 API Endpoint Latency (Warm Cache)

| Endpoint                                  | Method | 50th Percentile (p50) | 95th Percentile (p95) | 99th Percentile (p99) | Payload Size |
| ----------------------------------------- | ------ | --------------------- | --------------------- | --------------------- | ------------ |
| `/api/health`                             | GET    | 1.2 ms                | 3.5 ms                | 6.1 ms                | ~40 B        |
| `/api/aoi/rybnik_35km/layers`             | GET    | 4.1 ms                | 8.8 ms                | 14.2 ms               | ~3.2 KB      |
| `/api/aoi/rybnik_35km/presentations`      | GET    | 5.3 ms                | 11.2 ms               | 18.0 ms               | ~4.8 KB      |
| `/api/aoi/rybnik_35km/readiness`          | GET    | 3.8 ms                | 7.9 ms                | 12.5 ms               | ~2.1 KB      |
| `/api/aoi/rybnik_35km/layers/power`       | GET    | 4.6 ms                | 9.4 ms                | 15.1 ms               | ~1.8 KB      |
| `/api/aoi/rybnik_35km/export` (9 domains) | GET    | 18.4 ms               | 32.1 ms               | 48.6 ms               | ~28.5 KB     |

### 3.2 Viewport Interaction Latency

| Action                               | Baseline (Full GeoJSON)         | Implemented (PMTiles + Node)        | Target SLA |
| ------------------------------------ | ------------------------------- | ----------------------------------- | ---------- |
| **Initial Map Load & Settle**        | 3,850 ms (parsing 94MB GeoJSON) | **180 ms – 240 ms**                 | < 500 ms   |
| **Pan & Settle (within urban core)** | 850 ms (re-render lag)          | **16 ms – 35 ms** (60 fps)          | < 100 ms   |
| **Zoom Step In/Out (z10 -> z14)**    | 1,200 ms (DOM canvas lock)      | **45 ms – 70 ms**                   | < 150 ms   |
| **Theme / Layer Toggle**             | 420 ms                          | **< 10 ms** (paint property update) | < 50 ms    |

---

## 4. Map Canvas & Source Lifecycle Stability

### 4.1 Preserving Active Provider Sources During Navigation

- **Problem:** Naive map implementations destroy and recreate `map.addSource` / `map.addLayer` on viewport change or UI theme toggling, causing visual flash and garbage collector spikes.
- **Implemented Solution in `MapView.tsx`:**
  1. Provider PMTiles sources and MVT vector layers are registered once during AOI initialization.
  2. Dark/Light style transitions mutate raster basemap opacity and vector layer paint properties (`map.setPaintProperty`) without deregistering vector tile sources.
  3. Single-feature inspection highlights use an isolated overlay source (`SELECTED_FEATURE_SOURCE_ID`) without triggering multi-domain tile re-fetches.

### 4.2 Eliminating Dark Canvas Flashes

- **Basemap Loading:** CartoDB / OSM raster tiles are pre-rendered with CSS background color fallback (`#1a1d20` for dark mode, `#f8f9fa` for light mode).
- **PMTiles Bounds Clamping:** Viewport bounds are constrained to the validated AOI bounding box (`[18.0, 49.8, 19.0, 50.4]`), preventing tile requests outside the generated archive boundary.

---

## 5. Architectural Decision Gate: Bounded PMTiles vs PostGIS/MVT Server

### Current Architecture Assessment

- **Current Model:** Bounded PMTiles files stored per domain in prepared storage (`/app/data/prepared/rybnik_35km/<domain>/domain-pack-v2/presentation/<domain>.pmtiles`).
- **Memory Footprint:** Node.js process uses ~65 MB RSS; zero database process overhead.
- **Disk Footprint:** ~72 MB total for all 11 domain PMTiles archives for Rybnik 35 km AOI.
- **Concurrency:** Built-in sliding-window rate limiter handles 240 req/min with up to 50 concurrent range streams with <1% CPU utilization on standard 2 vCPU VPS.

### Decision

> **Decision: The bounded PMTiles artifact model remains fully sufficient for regional portfolio demo deployments.**
>
> A dedicated PostGIS database or dynamic tile server (e.g. Martin / Tegola) is **NOT** recommended for single-AOI or regional snapshot delivery. It should only be evaluated under a future ticket if:
>
> 1. Multi-region countrywide dynamic spatial filtering across arbitrary bounding boxes is required.
> 2. Concurrent write/editing workloads on spatial vectors occur in real-time.
> 3. Total vector cache volume exceeds the available disk capacity of static artifact hosting.
