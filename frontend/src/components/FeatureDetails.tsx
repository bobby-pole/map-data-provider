import { useEffect, useState } from "react";

import { featureInspection, type SelectedProviderFeature } from "../inspection";
import type { MapCircuit, MapCircuitDetail, MapCircuitList, MapFeatureDetail } from "../types/api";

type Props = {
  aoiId: string;
  selected: SelectedProviderFeature | null;
  selectedCircuit: MapCircuit | null;
  onDetailChange: (detail: MapFeatureDetail | null) => void;
  onCircuitChange: (circuit: MapCircuit | null) => void;
};

export function FeatureDetails({ aoiId, selected, selectedCircuit, onDetailChange, onCircuitChange }: Props) {
  const [detail, setDetail] = useState<MapFeatureDetail | null>(null);
  const [circuits, setCircuits] = useState<MapCircuitList | null>(null);
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
    if (selected.layer.domain === "power") {
      void fetch(`${base}/circuits`)
        .then(async (response) => { if (!response.ok) throw new Error(`Circuit list: HTTP ${response.status}`); return response.json() as Promise<MapCircuitList>; })
        .then((value) => { if (!cancelled) setCircuits(value); })
        .catch(() => { if (!cancelled) setCircuits(null); });
    }
    return () => { cancelled = true; };
  }, [aoiId, selected, onCircuitChange, onDetailChange]);

  if (!selected) return <section className="inspectorSection"><h2>Selected feature</h2><p className="muted">Click a visible map feature to inspect its source-backed popup.</p></section>;

  const activeDetail = detail?.source_id === selected.feature.properties.source_id ? detail : null;
  const activeCircuits = circuits?.source_id === selected.feature.properties.source_id ? circuits : null;
  const inspection = featureInspection(activeDetail ? { ...selected, feature: activeDetail.feature } : selected);
  const chooseCircuit = (relationId: string) => {
    void fetch(`/api/aoi/${encodeURIComponent(aoiId)}/presentations/${encodeURIComponent(selected.layer.domain)}/circuits/${encodeURIComponent(relationId)}`)
      .then(async (response) => { if (!response.ok) throw new Error(`Circuit details: HTTP ${response.status}`); return response.json() as Promise<MapCircuitDetail>; })
      .then((value) => onCircuitChange(value.circuit))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <section className="inspectorSection featureDetails">
      <h2>Selected feature</h2>
      <h3>{inspection.title}</h3>
      <p className="muted">Source attributes and external OSM links are in the map popup. This panel keeps only inspection actions visible.</p>
      <dl><dt>source</dt><dd>{inspection.source}</dd><dt>readiness</dt><dd>{inspection.readiness}</dd></dl>
      {selected.layer.domain === "power" && <><h4>Verified circuits</h4>
        {activeCircuits?.state === "available" ? <ul className="circuitList">{activeCircuits.circuits.map((circuit) => <li key={circuit.relation_id}><button type="button" className={selectedCircuit?.relation_id === circuit.relation_id ? "circuitButton active" : "circuitButton"} onClick={() => chooseCircuit(circuit.relation_id)}><strong>{String(circuit.tags.name ?? circuit.relation_id)}</strong><small>{formatVoltage(circuit.tags.voltage)} · {circuit.member_count} committed members</small></button></li>)}</ul> : <p className="muted">No committed OSM circuit relation contains this delivered feature.</p>}
        {selectedCircuit && <section className="selectedCircuit"><h4>Selected circuit</h4><dl><dt>name</dt><dd>{String(selectedCircuit.tags.name ?? selectedCircuit.relation_id)}</dd><dt>voltage</dt><dd>{formatVoltage(selectedCircuit.tags.voltage)}</dd><dt>operator</dt><dd>{String(selectedCircuit.tags.operator ?? "unknown")}</dd></dl><details><summary>Verified member endpoints ({selectedCircuit.members.length})</summary><ul>{selectedCircuit.members.map((member) => <li key={member.source_id}><strong>{member.role || "member"}</strong> {member.source_id}<small>{member.endpoint_evidence ? `${member.endpoint_evidence.start} → ${member.endpoint_evidence.end}` : member.availability ?? "No committed endpoint evidence."}</small></li>)}</ul></details><p className="muted">Highlighted on map. Only committed member geometry is drawn; this is not a flow or cascade model.</p></section>}</>}
      {error && <p className="error inlineError">{error}</p>}
    </section>
  );
}

function formatVoltage(value: string | undefined): string {
  if (!value) return "voltage unknown";
  const values = value.split(";").map((part) => Number(part.trim())).filter(Number.isFinite);
  return values.length ? `${values.map((volts) => volts % 1000 === 0 ? volts / 1000 : volts / 1000).join("/")} kV` : value;
}
