import { useCallback, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { useProviderPreview } from "./hooks/useApi";
import { configuredPreviewLayers, defaultLayerEnabled, previewLayerKey, type TransportRoadClass } from "./previewCatalog";
import { FeatureDetails } from "./components/FeatureDetails";
import { IssueReviewDrawer } from "./components/IssueReviewDrawer";
import { LayerCatalog } from "./components/LayerCatalog";
import { PreviewHeader } from "./components/PreviewHeader";
import { AoiSettings } from "./components/AoiSettings";
import type { SelectedProviderFeature } from "./inspection";
import { kiutReferenceLayers } from "./kiutReference";
import { orthophotoReference } from "./orthophotoReference";
import type { MapCircuit, MapFeatureDetail, ProviderRuntimeResponse } from "./types/api";
import "./index.css";

export default function App() {
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [enabledTransportRoadClasses, setEnabledTransportRoadClasses] = useState<Record<TransportRoadClass, boolean>>({
    major: true, secondary: true, local: true, service: false,
  });
  const [selectedFeature, setSelectedFeature] = useState<SelectedProviderFeature | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MapFeatureDetail | null>(null);
  const [selectedCircuit, setSelectedCircuit] = useState<MapCircuit | null>(null);
  const [enabledReferences, setEnabledReferences] = useState<Record<string, boolean>>({});
  const [orthophotoEnabled, setOrthophotoEnabled] = useState(false);
  const [basemapEnabled, setBasemapEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runtimeResult, setRuntimeResult] = useState<ProviderRuntimeResponse | null>(null);
  const preparedAoiId = runtimeResult?.outcomes.some((outcome) => outcome.status === "ready")
    ? runtimeResult.aoi.aoi_id
    : undefined;
  const { aoiId, presentations, issues, sourceAvailability, updateReview, error } = useProviderPreview(preparedAoiId);
  const catalog = useMemo(() => configuredPreviewLayers(presentations), [presentations]);
  const visibleLayers = useMemo(
    () => catalog.filter((layer) => enabledLayers[previewLayerKey(layer)] ?? defaultLayerEnabled(layer)),
    [catalog, enabledLayers],
  );
  const featureCount = useMemo(
    () => visibleLayers.reduce((total, layer) => total + layer.artifact.feature_count, 0),
    [visibleLayers],
  );
  const visibleReferences = useMemo(() => kiutReferenceLayers.filter((reference) => enabledReferences[reference.id] ?? false), [enabledReferences]);
  const selectFeature = useCallback((selection: SelectedProviderFeature) => { setSelectedFeature(selection); setSelectedDetail(null); setSelectedCircuit(null); }, []);
  const toggleLayer = useCallback((key: string, enabled: boolean) => {
    setEnabledLayers((current) => ({ ...current, [key]: enabled }));
    if (!enabled && selectedFeature && previewLayerKey(selectedFeature.layer) === key) {
      setSelectedFeature(null);
      setSelectedDetail(null);
      setSelectedCircuit(null);
    }
  }, [selectedFeature]);
  const toggleTransportRoadClass = useCallback((roadClass: TransportRoadClass, enabled: boolean) => {
    setEnabledTransportRoadClasses((current) => ({ ...current, [roadClass]: enabled }));
  }, []);

  return (
    <main className="inspectorLayout">
      <PreviewHeader aoiId={runtimeResult?.aoi.aoi_id ?? aoiId} featureCount={featureCount} onSettingsClick={() => setSettingsOpen((current) => !current)} />
      {error && <div className="error">Provider API error: {error}</div>}
      <section className="inspectorContent">
        <div className="mapPanel"><MapView layers={visibleLayers} transportRoadClasses={enabledTransportRoadClasses} references={visibleReferences} orthophotoEnabled={orthophotoEnabled} basemapEnabled={basemapEnabled} aoiOutline={runtimeResult?.aoi.geometry ?? null} selected={selectedFeature} selectedDetail={selectedDetail} selectedCircuit={selectedCircuit} onSelectFeature={selectFeature} /></div>
        <aside className="inspectorPanel">
          {settingsOpen && <AoiSettings onApplied={(result) => { setRuntimeResult(result); setSelectedFeature(null); setSelectedDetail(null); setSelectedCircuit(null); setSettingsOpen(false); }} />}
          {runtimeResult && <section className="inspectorSection"><div className="sectionHeading"><h2>Preparation status</h2><span>{runtimeResult.request_result} · {runtimeResult.request_id}</span></div><ul className="layerList">{runtimeResult.outcomes.map((outcome) => <li key={outcome.domain}><strong>{outcome.domain}: {outcome.status}</strong><small>{outcome.detail}</small><small>{outcome.source_registry_id} · {outcome.output_kind} · {outcome.query_version}{outcome.artifact_aoi_id ? ` · artifact ${outcome.artifact_aoi_id}` : ""}</small></li>)}</ul><h3 className="contextHeading">Source context</h3><ul className="layerList">{runtimeResult.contexts.map((context, index) => <li key={`${context.domain}-${context.source_registry_id}-${index}`}><strong>{context.domain}: {context.status}</strong><small>{context.source_registry_id} · {context.output_kind}</small><small>{context.detail}</small></li>)}</ul></section>}
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>Map background</h2><span>{basemapEnabled ? "on" : "off"}</span></div>
            <label className="layerToggle"><input type="checkbox" checked={basemapEnabled} onChange={(event) => setBasemapEnabled(event.target.checked)} /><span><strong>OpenStreetMap base map</strong><small>Online visual context only; it is not provider data and is unavailable offline.</small></span></label>
          </section>
          <FeatureDetails aoiId={aoiId} selected={selectedFeature} selectedCircuit={selectedCircuit} onDetailChange={setSelectedDetail} onCircuitChange={setSelectedCircuit} />
          <LayerCatalog
            layers={catalog}
            enabledLayers={enabledLayers}
            onToggle={toggleLayer}
            enabledTransportRoadClasses={enabledTransportRoadClasses}
            onTransportRoadClassToggle={toggleTransportRoadClass}
          />
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>KIUT reference overlays</h2><span>{visibleReferences.length}</span></div>
            <p className="muted">Reference-only WMS; selection moves the map to zoom 19 and renders KIUT above orthophoto. It is not analytical GeoJSON.</p>
            <ul className="layerList">{kiutReferenceLayers.map((reference) => <li key={reference.id}><label className="layerToggle"><input type="checkbox" checked={enabledReferences[reference.id] ?? false} onChange={(event) => setEnabledReferences((current) => ({ ...current, [reference.id]: event.target.checked }))} /><span><strong>{reference.label}</strong><small>Possible coverage only; local completeness is not guaranteed.</small></span></label></li>)}</ul>
          </section>
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>Source availability</h2><span>{sourceAvailability?.sources.length ?? 0}</span></div>
            <p className="muted">Cached report only; opening this preview never probes remote sources.</p>
            <ul className="layerList">{sourceAvailability?.sources.map((source) => <li key={source.source_id}><span><strong>{source.source_id}: {source.availability}</strong><small>AOI: {source.aoi_coverage}; features: {source.feature_state}; evidence: {source.freshness}.</small><small>{source.evidence}{source.actionable_gap ? " Actionable source gap." : ""}</small></span></li>)}</ul>
          </section>
          <section className="inspectorSection">
            <div className="sectionHeading"><h2>Official orthophoto</h2><span>{orthophotoEnabled ? "on" : "off"}</span></div>
            <label className="layerToggle"><input type="checkbox" checked={orthophotoEnabled} onChange={(event) => setOrthophotoEnabled(event.target.checked)} /><span><strong>{orthophotoReference.label}</strong><small>Source date: {orthophotoReference.sourceDate}. Resolution: {orthophotoReference.resolution}.</small><small>{orthophotoReference.limitation}</small></span></label>
          </section>
          <IssueReviewDrawer issues={issues} updateReview={updateReview} />
        </aside>
      </section>
    </main>
  );
}
