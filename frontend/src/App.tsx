import { useCallback, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { useProviderPreview } from "./hooks/useApi";
import { configuredPreviewLayers, previewLayerKey } from "./previewCatalog";
import { FeatureDetails } from "./components/FeatureDetails";
import { IssueReviewDrawer } from "./components/IssueReviewDrawer";
import { LayerCatalog } from "./components/LayerCatalog";
import { PreviewHeader } from "./components/PreviewHeader";
import type { SelectedProviderFeature } from "./inspection";
import { kiutReferenceLayers } from "./kiutReference";
import { orthophotoReference } from "./orthophotoReference";
import "./index.css";

export default function App() {
  const { aoiId, domainPacks, issues, updateReview, error } = useProviderPreview();
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [selectedFeature, setSelectedFeature] = useState<SelectedProviderFeature | null>(null);
  const [enabledReferences, setEnabledReferences] = useState<Record<string, boolean>>({});
  const [orthophotoEnabled, setOrthophotoEnabled] = useState(false);
  const catalog = useMemo(() => configuredPreviewLayers(domainPacks), [domainPacks]);
  const visibleLayers = useMemo(
    () => catalog.filter((layer) => enabledLayers[previewLayerKey(layer)] ?? true),
    [catalog, enabledLayers],
  );
  const featureCount = useMemo(
    () => visibleLayers.reduce((total, layer) => total + layer.layer.features.length, 0),
    [visibleLayers],
  );
  const visibleReferences = useMemo(() => kiutReferenceLayers.filter((reference) => enabledReferences[reference.id] ?? false), [enabledReferences]);
  const selectFeature = useCallback((selection: SelectedProviderFeature) => setSelectedFeature(selection), []);
  const toggleLayer = useCallback((key: string, enabled: boolean) => {
    setEnabledLayers((current) => ({ ...current, [key]: enabled }));
    if (!enabled && selectedFeature && previewLayerKey(selectedFeature.layer) === key) {
      setSelectedFeature(null);
    }
  }, [selectedFeature]);

  return (
    <main className="inspectorLayout">
      <PreviewHeader aoiId={aoiId} featureCount={featureCount} />
      {error && <div className="error">Provider API error: {error}</div>}
      <section className="inspectorContent">
        <div className="mapPanel"><MapView layers={visibleLayers} references={visibleReferences} orthophotoEnabled={orthophotoEnabled} onSelectFeature={selectFeature} /></div>
        <aside className="inspectorPanel">
          <LayerCatalog
            layers={catalog}
            enabledLayers={enabledLayers}
            onToggle={toggleLayer}
          />
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>KIUT reference overlays</h2><span>{visibleReferences.length}</span></div>
            <p className="muted">Reference-only WMS; enabled from zoom 19. It is not analytical GeoJSON.</p>
            <ul className="layerList">{kiutReferenceLayers.map((reference) => <li key={reference.id}><label className="layerToggle"><input type="checkbox" checked={enabledReferences[reference.id] ?? false} onChange={(event) => setEnabledReferences((current) => ({ ...current, [reference.id]: event.target.checked }))} /><span><strong>{reference.label}</strong><small>Possible coverage only; local completeness is not guaranteed.</small></span></label></li>)}</ul>
          </section>
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>Official orthophoto</h2><span>{orthophotoEnabled ? "on" : "off"}</span></div>
            <label className="layerToggle"><input type="checkbox" checked={orthophotoEnabled} onChange={(event) => setOrthophotoEnabled(event.target.checked)} /><span><strong>{orthophotoReference.label}</strong><small>Source date: {orthophotoReference.sourceDate}. Resolution: {orthophotoReference.resolution}.</small><small>{orthophotoReference.limitation}</small></span></label>
          </section>
          <FeatureDetails selected={selectedFeature} />
          <IssueReviewDrawer issues={issues} updateReview={updateReview} />
        </aside>
      </section>
    </main>
  );
}
