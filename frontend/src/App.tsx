import { useCallback, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { useProviderPreview } from "./hooks/useApi";
import { configuredPreviewLayers, previewLayerKey } from "./previewCatalog";
import { FeatureDetails } from "./components/FeatureDetails";
import { IssueReviewDrawer } from "./components/IssueReviewDrawer";
import { LayerCatalog } from "./components/LayerCatalog";
import { PreviewHeader } from "./components/PreviewHeader";
import type { SelectedProviderFeature } from "./inspection";
import "./index.css";

export default function App() {
  const { aoiId, domainPacks, issues, updateReview, error } = useProviderPreview();
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [selectedFeature, setSelectedFeature] = useState<SelectedProviderFeature | null>(null);
  const catalog = useMemo(() => configuredPreviewLayers(domainPacks), [domainPacks]);
  const visibleLayers = useMemo(
    () => catalog.filter((layer) => enabledLayers[previewLayerKey(layer)] ?? true),
    [catalog, enabledLayers],
  );
  const featureCount = useMemo(
    () => visibleLayers.reduce((total, layer) => total + layer.layer.features.length, 0),
    [visibleLayers],
  );
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
        <div className="mapPanel"><MapView layers={visibleLayers} onSelectFeature={selectFeature} /></div>
        <aside className="inspectorPanel">
          <LayerCatalog
            layers={catalog}
            enabledLayers={enabledLayers}
            onToggle={toggleLayer}
          />
          <FeatureDetails selected={selectedFeature} />
          <IssueReviewDrawer issues={issues} updateReview={updateReview} />
        </aside>
      </section>
    </main>
  );
}
