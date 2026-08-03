import { Fragment, useEffect, useState } from "react";

import { featureInspection, type SelectedProviderFeature } from "../inspection";
import type { MapFeatureDetail } from "../types/api";

export function FeatureDetails({ aoiId, selected }: { aoiId: string; selected: SelectedProviderFeature | null }) {
  const [detail, setDetail] = useState<MapFeatureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    const sourceId = selected.feature.properties.source_id;
    if (typeof sourceId !== "string") return;
    let cancelled = false;
    void fetch(`/api/aoi/${encodeURIComponent(aoiId)}/presentations/${encodeURIComponent(selected.layer.domain)}/features/${encodeURIComponent(sourceId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Feature details: HTTP ${response.status}`);
        return response.json() as Promise<MapFeatureDetail>;
      })
      .then((value) => { if (!cancelled) { setDetail(value); setError(null); } })
      .catch((reason: unknown) => { if (!cancelled) { setDetail(null); setError(reason instanceof Error ? reason.message : String(reason)); } });
    return () => { cancelled = true; };
  }, [aoiId, selected]);
  if (!selected) {
    return <section className="inspectorSection"><h2>Selected feature</h2><p className="muted">Click a visible map feature to inspect its provider evidence.</p></section>;
  }
  const selectedSourceId = selected.feature.properties.source_id;
  const activeDetail = typeof selectedSourceId === "string" && detail?.source_id === selectedSourceId ? detail : null;
  const inspection = featureInspection(activeDetail ? { ...selected, feature: activeDetail.feature } : selected);
  return (
    <section className="inspectorSection featureDetails">
      <h2>Selected feature</h2>
      <h3>{inspection.title}</h3>
      <dl>
        <dt>source</dt><dd>{inspection.source}</dd>
        <dt>attribution</dt><dd>{inspection.attribution}</dd>
        <dt>confidence</dt><dd>{inspection.confidence}</dd>
        <dt>readiness</dt><dd>{inspection.readiness}</dd>
      </dl>
      <h4>Limitations</h4>
      <ul>{inspection.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      <h4>Provider attributes</h4>
      <dl className="attributeList">{inspection.providerAttributes.map((attribute) => <Fragment key={attribute.name}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></Fragment>)}</dl>
      <h4>OSM source tags</h4>
      {activeDetail ? <dl className="attributeList">{Object.entries(activeDetail.feature.properties.osm_tags ?? {}).map(([name, value]) => <Fragment key={name}><dt>{name}</dt><dd>{String(value)}</dd></Fragment>)}</dl> : <p className="muted">{error ?? "Loading validated source details…"}</p>}
    </section>
  );
}
