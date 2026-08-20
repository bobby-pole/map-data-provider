import type { CSSProperties } from "react";
import { legendItemsForLayer, mapSymbolDataUrl, type MapSymbolKind } from "../mapSymbols";
import { isLinePresentationLayer } from "../mapStyle";
import { layerPresentationSemantic } from "../presentationSemantics";
import type { PreviewLayer } from "../previewCatalog";

type LegendEntry = {
  key: string;
  kind: MapSymbolKind | null;
  label: string;
  layer: PreviewLayer;
  semantic: ReturnType<typeof layerPresentationSemantic>;
  readiness: string;
  source: string;
};

export function LegendPanel({ layers, referenceOverlayAvailable }: { layers: PreviewLayer[]; referenceOverlayAvailable: boolean }) {
  const entries: LegendEntry[] = layers.flatMap<LegendEntry>((layer, index) => {
    const semantic = layerPresentationSemantic(layer, index);
    const base = { layer, semantic, readiness: layer.artifact.readiness, source: layer.artifact.source_provenance.map((item) => item.source_id).join(", ") };
    if (isLinePresentationLayer(layer.artifact.source_layer)) return [{ ...base, key: `${layer.domain}:${layer.artifact.artifact_id}`, kind: null, label: semantic.label }];
    return legendItemsForLayer(layer).map((item) => ({ ...base, key: `${layer.domain}:${layer.artifact.artifact_id}:${item.kind}`, kind: item.kind, label: item.label }));
  });
  const byDomain = entries.reduce((groups, entry) => {
    groups.set(entry.layer.domain, [...(groups.get(entry.layer.domain) ?? []), entry]);
    return groups;
  }, new Map<string, LegendEntry[]>());
  return <section className="drawerSection"><h2>Legend</h2><p className="muted">Distinct icons identify delivered point and area object types; colour supports, never replaces, the symbol.</p>{entries.length ? <div className="legendDomains">{[...byDomain.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, domainEntries]) => <section className="legendDomain" key={domain}><h3>{domain.replaceAll("_", " ")}</h3><ul className="legendList">{domainEntries.map(({ key, kind, label, semantic, readiness, source }) => <li key={key}>{kind ? <MapSymbolIcon kind={kind} /> : <span className={`legendSwatch ${semantic.geometry}`} style={{ "--legend-color": semantic.color } as CSSProperties} aria-hidden="true" />}<span><strong>{label}</strong><small>{semantic.symbol} · {semantic.description}</small><small>{source || "provider source"} · {readiness}</small></span></li>)}</ul></section>)}</div> : <p className="muted">Prepare an AOI to show registered provider symbology.</p>}<h3>Reference overlays</h3><ul className="legendList"><li><span className="legendSwatch point_or_area referenceSwatch" aria-hidden="true" /><span><strong>Reference context</strong><small>KIUT / orthophoto · raster-only context, never analytical evidence</small><small>{referenceOverlayAvailable ? "available on this map" : "not currently available"}</small></span></li></ul></section>;
}

export function MapSymbolIcon({ kind }: { kind: MapSymbolKind }) {
  return <img className="mapSymbolIcon" src={mapSymbolDataUrl(kind)} alt="" aria-hidden="true" />;
}
