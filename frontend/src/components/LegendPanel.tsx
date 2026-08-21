import { useState, type CSSProperties } from "react";
import { legendItemsForLayer, mapSymbolDataUrl, type MapSymbolKind } from "../mapSymbols";
import { isLinePresentationLayer, POWER_VOLTAGE_TIERS } from "../mapStyle";
import { layerPresentationSemantic } from "../presentationSemantics";
import type { PreviewLayer } from "../previewCatalog";

type LegendEntry = {
  key: string;
  kind: MapSymbolKind | null;
  label: string;
  layer: PreviewLayer;
  color?: string;
  geometry?: string;
  symbolText?: string;
  descriptionText?: string;
  readiness: string;
  source: string;
};

export function LegendPanel({ layers, referenceOverlayAvailable }: { layers: PreviewLayer[]; referenceOverlayAvailable: boolean }) {
  const entries: LegendEntry[] = layers.flatMap<LegendEntry>((layer, index) => {
    const semantic = layerPresentationSemantic(layer, index);
    const base = {
      layer,
      readiness: layer.artifact.readiness,
      source: layer.artifact.source_provenance.map((item) => item.source_id).join(", "),
    };

    // Transport category does not show road and railway lines in the legend (inspection overlays only)
    if (
      layer.domain === "transport" &&
      (layer.artifact.artifact_id === "transport.roads" ||
        layer.artifact.artifact_id === "transport.railways" ||
        layer.artifact.source_layer.endsWith(".roads") ||
        layer.artifact.source_layer.endsWith(".railways"))
    ) {
      return [];
    }

    // Power lines display all voltage tiers with respective colors and descriptions
    if (layer.domain === "power" && isLinePresentationLayer(layer.artifact.source_layer)) {
      return POWER_VOLTAGE_TIERS.map((tier) => ({
        ...base,
        key: `power:line:${tier.voltage_bucket}`,
        kind: null,
        label: tier.label,
        color: tier.color,
        geometry: "line",
        symbolText: tier.voltage_bucket.replace("_", " "),
        descriptionText: tier.description,
      }));
    }

    if (isLinePresentationLayer(layer.artifact.source_layer)) {
      return [
        {
          ...base,
          key: `${layer.domain}:${layer.artifact.artifact_id}`,
          kind: null,
          label: semantic.label,
          color: semantic.color,
          geometry: semantic.geometry,
          symbolText: semantic.symbol,
          descriptionText: semantic.description,
        },
      ];
    }

    return legendItemsForLayer(layer).map((item) => ({
      ...base,
      key: `${layer.domain}:${layer.artifact.artifact_id}:${item.kind}`,
      kind: item.kind,
      label: item.label,
      color: semantic.color,
      geometry: semantic.geometry,
      symbolText: semantic.symbol,
      descriptionText: semantic.description,
    }));
  });

  const byDomain = entries.reduce((groups, entry) => {
    groups.set(entry.layer.domain, [...(groups.get(entry.layer.domain) ?? []), entry]);
    return groups;
  }, new Map<string, LegendEntry[]>());

  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});

  const expandAll = () => setCollapsedDomains({});
  const collapseAll = () => {
    const allCollapsed: Record<string, boolean> = {};
    for (const key of byDomain.keys()) {
      allCollapsed[key] = true;
    }
    setCollapsedDomains(allCollapsed);
  };

  const toggleDomain = (domain: string) => {
    setCollapsedDomains((current) => ({
      ...current,
      [domain]: !current[domain],
    }));
  };

  return (
    <section className="drawerSection">
      <h2>Legend</h2>
      <p className="muted">
        Distinct icons identify delivered point and area object types; colour supports, never replaces, the symbol.
      </p>

      {entries.length ? (
        <div className="legendDomains">
          <div className="layerTreeActions">
            <button type="button" className="textButton" onClick={expandAll}>
              Expand all
            </button>
            <span className="muted">·</span>
            <button type="button" className="textButton" onClick={collapseAll}>
              Collapse all
            </button>
          </div>

          {[...byDomain.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([domain, domainEntries]) => {
              const isOpen = !collapsedDomains[domain];
              return (
                <details
                  className="legendDomainDetails"
                  key={domain}
                  open={isOpen}
                  onToggle={(event) => {
                    const targetOpen = (event.currentTarget as HTMLDetailsElement).open;
                    if (targetOpen !== isOpen) toggleDomain(domain);
                  }}
                >
                  <summary className="legendDomainSummary">
                    <span className="legendDomainTitle">{domain.replaceAll("_", " ")}</span>
                    <span className="legendDomainCount">{domainEntries.length} items</span>
                  </summary>
                  <ul className="legendList">
                    {domainEntries.map(
                      ({ key, kind, label, color, geometry, symbolText, descriptionText, readiness, source }) => (
                        <li key={key}>
                          {kind ? (
                            <MapSymbolIcon kind={kind} />
                          ) : (
                            <span
                              className={`legendSwatch ${geometry ?? "line"}`}
                              style={{ "--legend-color": color } as CSSProperties}
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            <strong>{label}</strong>
                            <small>
                              {symbolText ? `${symbolText} · ` : ""}
                              {descriptionText}
                            </small>
                            <small>
                              {source || "provider source"} · {readiness}
                            </small>
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </details>
              );
            })}
        </div>
      ) : (
        <p className="muted">Prepare an AOI to show registered provider symbology.</p>
      )}

      <h3>Reference overlays</h3>
      <ul className="legendList">
        <li>
          <span className="legendSwatch point_or_area referenceSwatch" aria-hidden="true" />
          <span>
            <strong>Reference context</strong>
            <small>KIUT / orthophoto · raster-only context, never analytical evidence</small>
            <small>{referenceOverlayAvailable ? "available on this map" : "not currently available"}</small>
          </span>
        </li>
      </ul>
    </section>
  );
}

export function MapSymbolIcon({ kind }: { kind: MapSymbolKind }) {
  return <img className="mapSymbolIcon" src={mapSymbolDataUrl(kind)} alt="" aria-hidden="true" />;
}

