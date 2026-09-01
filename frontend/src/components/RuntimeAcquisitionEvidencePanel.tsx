import { useEffect, useState } from "react";

import type { RuntimeAcquisitionEvidence } from "../types/api";

/** Provenance evidence for a just-published AOI, never a delivery benchmark. */
export function RuntimeAcquisitionEvidencePanel({
  aoiId,
  refreshToken = null,
}: {
  aoiId: string | null;
  refreshToken?: string | null;
}) {
  const [evidence, setEvidence] = useState<RuntimeAcquisitionEvidence | null>(null);

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
          setEvidence(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvidence(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, refreshToken]);

  if (!evidence || evidence.aoi_id !== aoiId) {
    return null;
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
