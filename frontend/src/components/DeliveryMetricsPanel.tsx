import { useEffect, useState } from "react";

import { DEFAULT_DELIVERY_AOI_ID, isRuntimeAcquisitionReport } from "../deliveryReport";
import type { DeliveryMetricsResponse } from "../types/api";
import { RuntimeAcquisitionEvidencePanel } from "./RuntimeAcquisitionEvidencePanel";

export function DeliveryMetricsPanel({
  aoiId = DEFAULT_DELIVERY_AOI_ID,
  refreshToken = null,
}: {
  aoiId?: string | null;
  refreshToken?: string | null;
}) {
  const [metrics, setMetrics] = useState<DeliveryMetricsResponse | null>(null);
  const [state, setState] = useState<"loading" | "unavailable" | "error">("loading");

  useEffect(() => {
    if (isRuntimeAcquisitionReport(aoiId)) {
      return;
    }
    let cancelled = false;
    void fetch("/api/metrics/delivery")
      .then(async (response) => {
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as DeliveryMetricsResponse;
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMetrics(response);
        setState(response ? "loading" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, refreshToken]);

  if (isRuntimeAcquisitionReport(aoiId)) {
    return (
      <RuntimeAcquisitionEvidencePanel
        aoiId={aoiId ?? null}
        refreshToken={refreshToken}
        showUnavailable
      />
    );
  }

  if (!metrics) {
    return (
      <section className="drawerSection deliveryMetrics" aria-live="polite">
        <h2>Delivery evidence</h2>
        {state === "loading" ? (
          <p className="muted">Loading the verified delivery report…</p>
        ) : state === "unavailable" ? (
          <p className="muted">
            No report matches the active demo bundle yet. Run the documented measurement against
            this bundle, commit its JSON, then deploy the corresponding revision.
          </p>
        ) : (
          <p className="error">
            The delivery report could not be loaded. The map remains available.
          </p>
        )}
      </section>
    );
  }

  const apiSummary = metrics.api.find((item) => item.id === "presentation-list") ?? metrics.api[0];
  return (
    <section className="drawerSection deliveryMetrics">
      <h2>Delivery evidence</h2>
      <p className="muted">
        Measured {formatDate(metrics.measured_at)} · {metrics.methodology.samples_per_endpoint}{" "}
        sequential requests per endpoint
      </p>
      <dl className="deliveryIdentity">
        <div>
          <dt>Bundle</dt>
          <dd>{metrics.bundle_id}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{metrics.git_revision?.slice(0, 12) ?? "unavailable"}</dd>
        </div>
      </dl>

      <h3>API delivery</h3>
      <div className="deliveryMetricGrid">
        <Metric
          label={`${apiSummary.id} p50`}
          value={formatMilliseconds(apiSummary.latency_ms.p50)}
        />
        <Metric
          label={`${apiSummary.id} p95`}
          value={formatMilliseconds(apiSummary.latency_ms.p95)}
        />
        <Metric
          label="PMTiles range"
          value={formatBytes(metrics.pmtiles.range_requests.response_bytes.mean)}
        />
        <Metric
          label="ETag revalidation"
          value={formatPercent(metrics.pmtiles.revalidation_cache.hit_ratio)}
        />
      </div>
      <p className="metricDetail">
        {metrics.pmtiles.range} · {metrics.pmtiles.revalidation_cache.hits} revalidated /{" "}
        {metrics.pmtiles.revalidation_cache.hits + metrics.pmtiles.revalidation_cache.misses}{" "}
        requests
      </p>

      <h3>Delivered snapshot</h3>
      <div className="deliveryMetricGrid">
        <Metric label="Domains" value={String(metrics.delivered_inventory.domains)} />
        <Metric label="Public layers" value={String(metrics.delivered_inventory.public_layers)} />
        <Metric
          label="Processed objects"
          value={metrics.delivered_inventory.processed_feature_count.toLocaleString()}
        />
        <Metric
          label="Worker success"
          value={formatPercent(metrics.fixture_worker.worker.success_rate)}
        />
      </div>

      <details className="deliveryFixtureNote">
        <summary>Fixture pipeline measurement</summary>
        <p>
          Deterministic local fixture preparation:{" "}
          {formatMilliseconds(metrics.fixture_worker.fixture_preparation.duration_ms)}
          {" · "}
          {metrics.fixture_worker.runtime_cache.hits}/{metrics.fixture_worker.runtime_cache.samples}{" "}
          warm cache hits
          {" · "}
          outcomes: {metrics.fixture_worker.runtime_outcomes.ready} ready,{" "}
          {metrics.fixture_worker.runtime_outcomes.needs_source} needs source,{" "}
          {metrics.fixture_worker.runtime_outcomes.failed} failed.
        </p>
        <p>This is pipeline evidence, not live Overpass or VPS throughput.</p>
      </details>
      <a
        className="textButton deliveryRawLink"
        href={metrics.raw_report_url}
        target="_blank"
        rel="noreferrer"
      >
        Open raw JSON report
      </a>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="deliveryMetric">
      <span className="deliveryMetricLabel">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value.toFixed(0)} B`;
  }
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
