import { useEffect, useState } from "react";

import { featureInspection, type SelectedProviderFeature } from "../inspection";
import type { MapFeatureDetail } from "../types/api";

type Props = {
  aoiId: string;
  selected: SelectedProviderFeature | null;
  onDetailChange: (detail: MapFeatureDetail | null) => void;
};

export function FeatureDetails({ aoiId, selected, onDetailChange }: Props) {
  const [detail, setDetail] = useState<MapFeatureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    const sourceId = selected.feature.properties.source_id;
    if (typeof sourceId !== "string") return;
    let cancelled = false;
    const base = `/api/aoi/${encodeURIComponent(aoiId)}/presentations/${encodeURIComponent(selected.layer.domain)}/features/${encodeURIComponent(sourceId)}`;
    void fetch(base)
      .then(async (response) => { if (!response.ok) throw new Error(`Feature details: HTTP ${response.status}`); return response.json() as Promise<MapFeatureDetail>; })
      .then((value) => { if (!cancelled) { setDetail(value); onDetailChange(value); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [aoiId, selected, onDetailChange]);

  if (!selected) return <section className="inspectorSection"><h2>Selected feature</h2><p className="muted">Click a visible map feature to inspect its source-backed popup.</p></section>;

  const activeDetail = detail?.source_id === selected.feature.properties.source_id ? detail : null;
  const inspection = featureInspection(activeDetail ? { ...selected, feature: activeDetail.feature } : selected);
  return (
    <section className="inspectorSection featureDetails">
      <h2>Selected feature</h2>
      <h3>{inspection.title}</h3>
      <p className="muted">Source attributes and external OSM links are in the map popup. Power-line selection is available only in that popup, so there is one consistent interaction path.</p>
      <dl><dt>source</dt><dd>{inspection.source}</dd><dt>readiness</dt><dd>{inspection.readiness}</dd></dl>
      {selected.feature.geometry?.type === "LineString" && selected.layer.domain !== "power" && (
        <section className="selectedLineGeometry">
          <h4>Verified endpoints</h4>
          <dl>
            <dt>start</dt><dd>{(selected.feature.geometry.coordinates[0] as number[]).map((c) => c.toFixed(5)).join(", ")}</dd>
            <dt>end</dt><dd>{((selected.feature.geometry.coordinates as number[][]).at(-1) ?? []).map((c) => c.toFixed(5)).join(", ")}</dd>
            {typeof selected.feature.properties.road_class === "string" && <><dt>road class</dt><dd>{selected.feature.properties.road_class}</dd></>}
          </dl>
          <p className="muted">Highlighted on map. Geometry endpoints reflect original source coordinates; no network routing or connectivity is inferred.</p>
        </section>
      )}
      {error && <p className="error inlineError">{error}</p>}
    </section>
  );
}
