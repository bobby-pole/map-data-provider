import { previewLayerKey, sourceAttribution, type PreviewLayer } from "../previewCatalog";

export function LayerCatalog({
  layers,
  enabledLayers,
  onToggle,
}: {
  layers: PreviewLayer[];
  enabledLayers: Record<string, boolean>;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  return (
    <section className="inspectorSection">
      <div className="sectionHeading"><h2>Layers</h2><span>{layers.length}</span></div>
      {layers.length > 0 ? <ul className="layerList">{layers.map((layer) => {
        const key = previewLayerKey(layer);
        return <li key={key}>
          <label className="layerToggle">
            <input type="checkbox" checked={enabledLayers[key] ?? true} onChange={(event) => onToggle(key, event.target.checked)} />
            <span>
              <strong>{layer.artifact.id}</strong>
              <small>{layer.domain} · {layer.layer.features.length} features · {layer.readiness.readiness}</small>
              <small>{sourceAttribution(layer)}</small>
            </span>
          </label>
        </li>;
      })}</ul> : <p className="muted">Loading registered domain-pack manifests…</p>}
    </section>
  );
}
