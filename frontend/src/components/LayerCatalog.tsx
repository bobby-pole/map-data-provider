import { defaultLayerEnabled, previewLayerKey, sourceAttribution, transportRoadClassLabel, transportRoadClasses, type PreviewLayer, type TransportRoadClass } from "../previewCatalog";

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
  return (
    <section className="inspectorSection">
      <div className="sectionHeading"><h2>Layers</h2><span>{layers.length}</span></div>
      {layers.length > 0 ? <ul className="layerList">{layers.map((layer) => {
        const key = previewLayerKey(layer);
        return <li key={key}>
          <label className="layerToggle">
            <input type="checkbox" checked={enabledLayers[key] ?? defaultLayerEnabled(layer)} onChange={(event) => onToggle(key, event.target.checked)} />
            <span>
              <strong>{formatLayerTitle(layer.artifact.artifact_id)}</strong>
              <small>{layer.domain} · {layer.artifact.feature_count} features · {layer.artifact.readiness}</small>
              <small>{sourceAttribution(layer)}</small>
            </span>
          </label>
          {layer.artifact.artifact_id === "transport.roads" && (enabledLayers[key] ?? defaultLayerEnabled(layer)) && <div className="roadClassControls" aria-label="Transport road classes">
            {transportRoadClasses.map((roadClass) => <label className="roadClassToggle" key={roadClass}>
              <input type="checkbox" checked={enabledTransportRoadClasses[roadClass]} onChange={(event) => onTransportRoadClassToggle(roadClass, event.target.checked)} />
              <span>{transportRoadClassLabel(roadClass)}{roadClass === "service" ? " (off by default)" : ""}</span>
            </label>)}
          </div>}
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
  if (artifactId === "bridges.bridges") return "Bridges";
  if (artifactId === "bridges.viaducts") return "Viaducts";
  if (artifactId === "bridges.crossings") return "Crossings";
  if (artifactId === "bridges.inspection_points") return "Bridge inspection points";
  if (artifactId === "water.facilities") return "Water facilities";
  if (artifactId === "water.pipelines") return "Water pipelines";
  if (artifactId === "water.waterways") return "Watercourses";
  if (artifactId === "water.inspection_points") return "Water inspection points";
  if (artifactId === "gas.facilities") return "Gas facilities";
  if (artifactId === "gas.pipelines") return "Gas pipelines";
  if (artifactId === "gas.inspection_points") return "Gas inspection points";
  if (artifactId === "sewer.facilities") return "Sewer facilities";
  if (artifactId === "sewer.pipelines") return "Sewer pipelines";
  if (artifactId === "sewer.inspection_points") return "Sewer inspection points";
  return artifactId;
}
