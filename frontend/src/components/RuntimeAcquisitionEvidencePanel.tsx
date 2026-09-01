import { useEffect, useState } from "react";

import type { RuntimeAcquisitionEvidence } from "../types/api";

/** Provenance evidence for a just-published AOI, never a delivery benchmark. */
export function RuntimeAcquisitionEvidencePanel({
  aoiId,
  refreshToken = null,
  showUnavailable = false,
}: {
  aoiId: string | null;
  refreshToken?: string | null;
  showUnavailable?: boolean;
}) {
  const [evidence, setEvidence] = useState<RuntimeAcquisitionEvidence | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${aoiId ?? ""}:${refreshToken ?? ""}`;

  useEffect(() => {
    if (!aoiId) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/aoi/${encodeURIComponent(aoiId)}/metrics/acquisition`)
      .then(async (response) =>
        response.ok ? ((await response.json()) as RuntimeAcquisitionEvidence) : null,
      )
      .then((next) => {
        if (!cancelled) {
          setLoadedKey(requestKey);
          setEvidence(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedKey(requestKey);
          setEvidence(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, refreshToken, requestKey]);

  const requestSettled = loadedKey === requestKey;
  if (!requestSettled) {
    if (!showUnavailable) {
      return null;
    }
    return (
      <section className="drawerSection runtimeEvidence" aria-live="polite">
        <h2>AOI report</h2>
        <p className="muted">Loading the acquisition evidence for the active AOI…</p>
      </section>
    );
  }
  if (!evidence || evidence.aoi_id !== aoiId) {
    if (!showUnavailable) {
      return null;
    }
    return (
      <section className="drawerSection runtimeEvidence" aria-live="polite">
        <h2>AOI report</h2>
        <p className="muted">
          No AOI-scoped acquisition evidence is available for this published snapshot.
        </p>
      </section>
    );
  }
  return (
    <section className="runtimeEvidence" aria-label="Runtime acquisition evidence">
      <h3>Runtime Acquisition Evidence</h3>
      <p className="muted">
        Provenance and quality evidence for <strong>{evidence.snapshot_id}</strong>, not a delivery
        benchmark or a live-state claim.
      </p>
      <dl>
        <div>
          <dt>AOI</dt>
          <dd>{evidence.aoi_id}</dd>
        </div>
        {evidence.radius_m !== null ? (
          <div>
            <dt>Radius</dt>
            <dd>{evidence.radius_m} m</dd>
          </div>
        ) : null}
        <div>
          <dt>Source date</dt>
          <dd>{new Date(evidence.source_observed_at).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Pipeline</dt>
          <dd>{evidence.pipeline_version}</dd>
        </div>
        {evidence.overpass_endpoint ? (
          <div>
            <dt>Overpass endpoint</dt>
            <dd>{evidence.overpass_endpoint}</dd>
          </div>
        ) : null}
      </dl>
      <ul>
        {evidence.domains.map((domain) => (
          <li key={domain.domain}>
            <strong>{domain.domain}</strong>: {domain.accepted_feature_count ?? "unknown"} accepted,
            validation {domain.validation_status}
            {domain.preparation_duration_ms === null
              ? ""
              : `, ${domain.preparation_duration_ms} ms`}
            {domain.overpass_endpoint ? `, ${domain.overpass_endpoint}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
