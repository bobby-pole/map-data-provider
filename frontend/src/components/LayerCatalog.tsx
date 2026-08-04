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
              <strong>{formatLayerTitle(layer.artifact.artifact_id)}</strong>
              <small>{layer.domain} · {layer.artifact.feature_count} features · {layer.artifact.readiness}</small>
              <small>{sourceAttribution(layer)}</small>
            </span>
          </label>
        </li>;
      })}</ul> : <p className="muted">Loading registered map-presentation manifests…</p>}
    </section>
  );
}

function formatLayerTitle(artifactId: string): string {
  if (artifactId === "power.supports") return "Power supports";
  if (artifactId === "transport.roads") return "Transport roads";
  if (artifactId === "transport.railways") return "Transport railways";
  if (artifactId === "transport.stations") return "Transport stations";
  if (artifactId === "transport.aviation") return "Transport aviation";
  if (artifactId === "transport.inspection_points") return "Transport inspection points";
  return artifactId;
}
