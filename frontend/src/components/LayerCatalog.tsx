import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  defaultLayerEnabled,
  previewLayerKey,
  sourceAttribution,
  transportRoadClassLabel,
  transportRoadClasses,
  type PreviewLayer,
  type TransportRoadClass,
} from "../previewCatalog";
import { pointSymbolKind } from "../mapSymbols";
import { isLinePresentationLayer } from "../mapStyle";
import { layerPresentationSemantic } from "../presentationSemantics";
import { MapSymbolIcon } from "./LegendPanel";

type LayerGroup = { provider: string; domains: Map<string, PreviewLayer[]> };

export function LayerCatalog({
  layers,
  enabledLayers,
  onToggle,
  enabledTransportRoadClasses,
  onTransportRoadClassToggle,
}: {
  layers: PreviewLayer[];
  enabledLayers: Record<string, boolean>;
  onToggle: (key: string, enabled: boolean) => void;
  enabledTransportRoadClasses: Record<TransportRoadClass, boolean>;
  onTransportRoadClassToggle: (roadClass: TransportRoadClass, enabled: boolean) => void;
}) {
  const groups = useMemo(() => {
    const byProvider = new Map<string, LayerGroup>();
    layers.forEach((layer) => {
      const provider = layer.artifact.source_provenance.map((item) => item.source_id).join(" + ") || layer.artifact.source;
      const group = byProvider.get(provider) ?? { provider, domains: new Map<string, PreviewLayer[]>() };
      group.domains.set(layer.domain, [...(group.domains.get(layer.domain) ?? []), layer]);
      byProvider.set(provider, group);
    });
    return [...byProvider.values()].sort((left, right) => left.provider.localeCompare(right.provider));
  }, [layers]);

  const allProviderKeys = useMemo(() => groups.map((g) => g.provider), [groups]);
  const allDomainKeys = useMemo(
    () => groups.flatMap((g) => [...g.domains.keys()].map((d) => `${g.provider}:${d}`)),
    [groups],
  );

  const [openProviders, setOpenProviders] = useState<string[]>(() => allProviderKeys);
  const [openDomains, setOpenDomains] = useState<string[]>(() => allDomainKeys);

  const isEnabled = (layer: PreviewLayer) => enabledLayers[previewLayerKey(layer)] ?? defaultLayerEnabled(layer);
  const setAll = (items: PreviewLayer[], enabled: boolean) => items.forEach((layer) => onToggle(previewLayerKey(layer), enabled));

  const expandAll = () => {
    setOpenProviders(allProviderKeys);
    setOpenDomains(allDomainKeys);
  };

  const collapseAll = () => {
    setOpenProviders([]);
    setOpenDomains([]);
  };

  const toggleProvider = (provider: string, isOpen: boolean) => {
    setOpenProviders((prev) => (isOpen ? [...new Set([...prev, provider])] : prev.filter((p) => p !== provider)));
  };

  const toggleDomain = (key: string, isOpen: boolean) => {
    setOpenDomains((prev) => (isOpen ? [...new Set([...prev, key])] : prev.filter((d) => d !== key)));
  };

  return (
    <section className="drawerSection">
      <div className="sectionHeading">
        <h2>Layers</h2>
        <span>{layers.length}</span>
      </div>
      <p className="muted">Analytical provider artifacts are grouped by source and domain. Group toggles preserve each artifact’s provenance and readiness.</p>
      {groups.length ? (
        <div className="layerTree">
          <div className="layerTreeActions">
            <button type="button" className="textButton" onClick={expandAll}>Expand all</button>
            <span className="muted">·</span>
            <button type="button" className="textButton" onClick={collapseAll}>Collapse all</button>
          </div>
          {groups.map((group) => {
            const providerLayers = [...group.domains.values()].flat();
            const isProviderOpen = openProviders.includes(group.provider);
            return (
              <details
                key={group.provider}
                open={isProviderOpen}
                onToggle={(event) => toggleProvider(group.provider, (event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>
                  <TriStateToggle
                    items={providerLayers}
                    isEnabled={isEnabled}
                    onChange={(enabled) => setAll(providerLayers, enabled)}
                    label={`Toggle provider ${group.provider}`}
                  />
                  <span>
                    <strong>{group.provider}</strong>
                    <small>source role: analytical vector</small>
                  </span>
                </summary>
                {isProviderOpen &&
                  [...group.domains.entries()]
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([domain, domainLayers]) => {
                      const domainKey = `${group.provider}:${domain}`;
                      const isDomainOpen = openDomains.includes(domainKey);
                      return (
                        <details
                          key={domain}
                          className="domainBranch"
                          open={isDomainOpen}
                          onToggle={(event) => toggleDomain(domainKey, (event.currentTarget as HTMLDetailsElement).open)}
                        >
                          <summary>
                            <TriStateToggle
                              items={domainLayers}
                              isEnabled={isEnabled}
                              onChange={(enabled) => setAll(domainLayers, enabled)}
                              label={`Toggle ${domain} domain`}
                            />
                            <span>
                              <strong>{domain}</strong>
                              <small>{domainLayers.length} artifact{domainLayers.length === 1 ? "" : "s"}</small>
                            </span>
                          </summary>
                          {isDomainOpen && (
                            <ul className="layerList">
                              {domainLayers.map((layer, index) => {
                                const key = previewLayerKey(layer);
                                const semantic = layerPresentationSemantic(layer, index);
                                const enabled = isEnabled(layer);
                                const marker = isLinePresentationLayer(layer.artifact.source_layer) ? (
                                  <i className={`semanticMark ${semantic.geometry}`} style={{ "--semantic-color": semantic.color } as CSSProperties} aria-hidden="true" />
                                ) : (
                                  <MapSymbolIcon kind={pointSymbolKind(layer)} />
                                );
                                return (
                                  <li key={key}>
                                    <label className="layerToggle">
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        onChange={(event) => onToggle(key, event.target.checked)}
                                      />
                                      <span>
                                        <strong>
                                          {marker}
                                          {semantic.label}
                                        </strong>
                                        <small>
                                          {semantic.symbol} · {layer.artifact.feature_count} features · {layer.artifact.readiness}
                                        </small>
                                        <small>{sourceAttribution(layer)}</small>
                                      </span>
                                    </label>
                                    {layer.artifact.artifact_id === "transport.roads" && enabled && (
                                      <div className="roadClassControls" aria-label="Transport road classes">
                                        {transportRoadClasses.map((roadClass) => (
                                          <label className="roadClassToggle" key={roadClass}>
                                            <input
                                              type="checkbox"
                                              checked={enabledTransportRoadClasses[roadClass]}
                                              onChange={(event) => onTransportRoadClassToggle(roadClass, event.target.checked)}
                                            />
                                            <span>{transportRoadClassLabel(roadClass)}</span>
                                          </label>
                                        ))}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </details>
                      );
                    })}
              </details>
            );
          })}
        </div>
      ) : (
        <p className="muted">Prepare an AOI to load registered map-presentation artifacts.</p>
      )}
    </section>
  );
}

function TriStateToggle({
  items,
  isEnabled,
  onChange,
  label,
}: {
  items: PreviewLayer[];
  isEnabled: (layer: PreviewLayer) => boolean;
  onChange: (enabled: boolean) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const enabledCount = items.filter(isEnabled).length;
  const checked = enabledCount === items.length && items.length > 0;
  const mixed = enabledCount > 0 && !checked;
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
