import { Fragment, useEffect, useState } from "react";

import { featureInspection, type SelectedProviderFeature } from "../inspection";
import type { MapFeatureDetail, MapRelationEvidence } from "../types/api";

export function FeatureDetails({ aoiId, selected }: { aoiId: string; selected: SelectedProviderFeature | null }) {
  const [detail, setDetail] = useState<MapFeatureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relationEvidence, setRelationEvidence] = useState<MapRelationEvidence | null>(null);
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
  useEffect(() => {
    if (!selected) return;
    const sourceId = selected.feature.properties.source_id;
    if (typeof sourceId !== "string") return;
    let cancelled = false;
    void fetch(`/api/aoi/${encodeURIComponent(aoiId)}/presentations/${encodeURIComponent(selected.layer.domain)}/features/${encodeURIComponent(sourceId)}/relation-evidence`)
      .then((response) => response.json() as Promise<MapRelationEvidence>)
      .then((value) => { if (!cancelled) setRelationEvidence(value); })
      .catch(() => { if (!cancelled) setRelationEvidence(null); });
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
      {relationEvidence?.state === "available" && relationEvidence.relation && <section className="relationEvidence"><h4>OSM relation evidence</h4><p className="muted">{relationEvidence.relation.relation_id} · {relationEvidence.relation.aoi_coverage}. It is not a connectivity or flow model.</p><RelationSketch members={relationEvidence.relation.members} /><ul>{relationEvidence.relation.members.map((member) => <li key={member.source_id}><strong>{member.role}</strong> {member.source_id}: {member.availability ?? `${member.endpoint_evidence?.start}; ${member.endpoint_evidence?.end}`}</li>)}</ul></section>}
    </section>
  );
}

function RelationSketch({ members }: { members: NonNullable<MapRelationEvidence["relation"]>["members"] }) {
  const coordinates = members.flatMap((member) => member.geometry?.coordinates ?? []);
  if (!coordinates.length) return <p className="muted">No committed member geometry is available.</p>;
  const lons = coordinates.map(([lon]) => lon); const lats = coordinates.map(([, lat]) => lat);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons); const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const project = ([lon, lat]: [number, number]) => `${12 + ((lon - minLon) / (maxLon - minLon || 1)) * 216},${108 - ((lat - minLat) / (maxLat - minLat || 1)) * 96}`;
  return <svg viewBox="0 0 240 120" role="img" aria-label="Verified relation member geometry">{members.flatMap((member) => member.geometry ? [<polyline key={member.source_id} points={member.geometry.coordinates.map(project).join(" ")} fill="none" stroke="#f97316" strokeWidth="3" />, ...[member.geometry.coordinates[0], member.geometry.coordinates.at(-1)!].map((point, index) => <circle key={`${member.source_id}-${index}`} cx={project(point).split(",")[0]} cy={project(point).split(",")[1]} r="4" fill="#facc15" />)] : [])}</svg>;
}
