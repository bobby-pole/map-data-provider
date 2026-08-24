import "./index.css";

import { lazy, Suspense, useCallback, useMemo, useState } from "react";

import { DEFAULT_AOI_OUTLINE, displayedAoiOutlines } from "./aoiSettings";
import type { ActivityEvent } from "./components/ActivityWindow";
import { CloseButton } from "./components/CloseButton";
import { DrawerSkeleton } from "./components/DrawerSkeleton";
import { IconRail, type PreviewPanel } from "./components/IconRail";
import { MapView } from "./components/MapView";
import { PreviewHeader } from "./components/PreviewHeader";
import { SourceAvailabilitySection } from "./components/SourceAvailabilitySection";
import { useProviderPreview } from "./hooks/useApi";
import type { SelectedProviderFeature } from "./inspection";
import { kiutReferenceLayers } from "./kiutReference";
import { type VisualBasemapMode, visualBasemapOptions } from "./mapStyle";
import { orthophotoReference } from "./orthophotoReference";
import {
  configuredPreviewLayers,
  defaultLayerEnabled,
  missingPrimaryDemoDomains,
  previewLayerKey,
  primaryDemoDomains,
  type TransportRoadClass,
} from "./previewCatalog";
import { useAoiStore } from "./stores/aoiStore";
import type {
  MapCircuit,
  MapCircuitMember,
  MapFeatureDetail,
  ProviderRuntimeResponse,
} from "./types/api";

const FeatureDetails = lazy(() =>
  import("./components/FeatureDetails").then((m) => ({ default: m.FeatureDetails })),
);
const IssueReviewDrawer = lazy(() =>
  import("./components/IssueReviewDrawer").then((m) => ({ default: m.IssueReviewDrawer })),
);
const LayerCatalog = lazy(() =>
  import("./components/LayerCatalog").then((m) => ({ default: m.LayerCatalog })),
);
const AoiSettings = lazy(() =>
  import("./components/AoiSettings").then((m) => ({ default: m.AoiSettings })),
);
const ActivityWindow = lazy(() =>
  import("./components/ActivityWindow").then((m) => ({ default: m.ActivityWindow })),
);
const LegendPanel = lazy(() =>
  import("./components/LegendPanel").then((m) => ({ default: m.LegendPanel })),
);

const DEFAULT_AOI_ID = "rybnik_35km";

export default function App() {
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [enabledTransportRoadClasses, setEnabledTransportRoadClasses] = useState<
    Record<TransportRoadClass, boolean>
  >({ major: true, secondary: true });
  const [selectedFeature, setSelectedFeature] = useState<SelectedProviderFeature | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MapFeatureDetail | null>(null);
  const [selectedCircuit, setSelectedCircuit] = useState<MapCircuit | null>(null);
  const [selectedCircuitMember, setSelectedCircuitMember] = useState<MapCircuitMember | null>(null);
  const [enabledReferences, setEnabledReferences] = useState<Record<string, boolean>>({});
  const [orthophotoEnabled, setOrthophotoEnabled] = useState(false);
  const [basemapMode, setBasemapMode] = useState<VisualBasemapMode>("dark");
  const [activePanel, setActivePanel] = useState<PreviewPanel | null>("layers");
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [runtimeResult, setRuntimeResult] = useState<ProviderRuntimeResponse | null>(null);
  const [defaultAoiHidden, setDefaultAoiHidden] = useState(false);
  const [mapZoom, setMapZoom] = useState<number | null>(null);

  const draftAoiOutline = useAoiStore((s) => s.draftAoiOutline);
  const aoiViewport = useAoiStore((s) => s.aoiViewport);
  const pickingAoi = useAoiStore((s) => s.pickingAoi);
  const setPickingAoi = useAoiStore((s) => s.setPickingAoi);
  const pickPoint = useAoiStore((s) => s.pickPoint);

  const isDefaultAoiActive =
    !runtimeResult ||
    (runtimeResult.outcomes.every((o) => o.status !== "ready") && DEFAULT_AOI_ID === "rybnik_35km");
  const shouldHideDefaultObjects = isDefaultAoiActive && defaultAoiHidden;

  const preparedAoiId = runtimeResult?.outcomes.some((outcome) => outcome.status === "ready")
    ? runtimeResult.aoi.aoi_id
    : DEFAULT_AOI_ID;
  const { aoiId, presentations, issues, sourceAvailability, updateReview, error } =
    useProviderPreview(preparedAoiId);
  const catalog = useMemo(() => configuredPreviewLayers(presentations), [presentations]);
  const missingDefaultDemoDomains = useMemo(
    () => missingPrimaryDemoDomains(presentations),
    [presentations],
  );
  const hasIncompleteDefaultDemo =
    preparedAoiId === DEFAULT_AOI_ID &&
    presentations.length > 0 &&
    missingDefaultDemoDomains.length > 0;
  const visibleLayers = useMemo(
    () =>
      shouldHideDefaultObjects
        ? []
        : catalog.filter(
            (layer) => enabledLayers[previewLayerKey(layer)] ?? defaultLayerEnabled(layer),
          ),
    [catalog, enabledLayers, shouldHideDefaultObjects],
  );
  const featureCount = useMemo(
    () => visibleLayers.reduce((total, layer) => total + layer.artifact.feature_count, 0),
    [visibleLayers],
  );
  const visibleReferences = useMemo(
    () => kiutReferenceLayers.filter((reference) => enabledReferences[reference.id] ?? false),
    [enabledReferences],
  );

  const addActivity = useCallback((event: Omit<ActivityEvent, "id" | "timestamp">) => {
    setActivityEvents((current) =>
      [
        ...current,
        { ...event, id: `${Date.now()}-${current.length}`, timestamp: new Date().toISOString() },
      ].slice(-40),
    );
  }, []);

  const selectFeature = useCallback((selection: SelectedProviderFeature | null) => {
    setSelectedFeature(selection);
    setSelectedDetail(null);
    setSelectedCircuit(null);
    setSelectedCircuitMember(null);
    if (selection) {
      setActivePanel((current) =>
        selection.layer.domain === "power" ? (current === "layers" ? null : current) : "layers",
      );
    }
  }, []);

  const toggleLayer = useCallback(
    (key: string, enabled: boolean) => {
      setEnabledLayers((current) => ({ ...current, [key]: enabled }));
      if (!enabled && selectedFeature && previewLayerKey(selectedFeature.layer) === key) {
        setSelectedFeature(null);
        setSelectedDetail(null);
        setSelectedCircuit(null);
        setSelectedCircuitMember(null);
      }
    },
    [selectedFeature],
  );

  const toggleTransportRoadClass = useCallback(
    (roadClass: TransportRoadClass, enabled: boolean) => {
      setEnabledTransportRoadClasses((current) => ({ ...current, [roadClass]: enabled }));
    },
    [],
  );

  const selectPanel = useCallback(
    (panel: PreviewPanel) => {
      setActivePanel((current) => (current === panel ? null : panel));
      setPickingAoi(false);
    },
    [setPickingAoi],
  );

  const applyResult = useCallback(
    (result: ProviderRuntimeResponse) => {
      setRuntimeResult(result);
      setDefaultAoiHidden(false);
      useAoiStore.setState({ draftAoiOutline: null, aoiViewport: null });
      setSelectedFeature(null);
      setSelectedDetail(null);
      setSelectedCircuit(null);
      setSelectedCircuitMember(null);
      setPickingAoi(false);
      setActivePanel(
        result.outcomes.some((outcome) => outcome.status === "failed") ? "settings" : "layers",
      );
    },
    [setPickingAoi],
  );

  const resetToDefault = useCallback(() => {
    setRuntimeResult(null);
    setDefaultAoiHidden(false);
    useAoiStore.setState({
      draftAoiOutline: null,
      aoiViewport: null,
      result: null,
      preflight: null,
      error: null,
    });
    setSelectedFeature(null);
    setSelectedDetail(null);
    setSelectedCircuit(null);
    setSelectedCircuitMember(null);
    addActivity({ phase: "cache", message: "Loaded default offline snapshot for Rybnik (35 km)." });
  }, [addActivity]);

  const preparedGeometry = shouldHideDefaultObjects
    ? null
    : (runtimeResult?.aoi.geometry ??
      (preparedAoiId === DEFAULT_AOI_ID ? DEFAULT_AOI_OUTLINE : null));
  const aoiOutlines = displayedAoiOutlines(draftAoiOutline, preparedGeometry);
  const currentMapLabel =
    visualBasemapOptions.find((option) => option.id === basemapMode)?.label ?? basemapMode;
  const transportInspectionNeedsZoom =
    visibleLayers.some(
      (layer) =>
        layer.artifact.artifact_id === "transport.roads" ||
        layer.artifact.artifact_id === "transport.railways",
    ) && (mapZoom ?? 0) < 11;

  const panelTitle =
    activePanel === "settings"
      ? "AOI & cache"
      : activePanel === "layers"
        ? "Layers"
        : activePanel === "providers"
          ? "Providers"
          : "Legend";

  return (
    <main className="previewLayout" data-basemap={basemapMode}>
      <PreviewHeader aoiId={runtimeResult?.aoi.aoi_id ?? aoiId} featureCount={featureCount} />
      {error && <div className="error previewError">Provider API error: {error}</div>}
      {hasIncompleteDefaultDemo && (
        <div className="previewNotice" role="status">
          <strong>Incomplete Rybnik demo snapshot.</strong> Showing{" "}
          {primaryDemoDomains.length - missingDefaultDemoDomains.length} of{" "}
          {primaryDemoDomains.length} primary domains. Missing packs:{" "}
          {missingDefaultDemoDomains.join(", ")}. Install the verified local demo bundle before
          relying on this preview.
        </div>
      )}
      <section className="mapWorkspace">
        <div className="mapPanel">
          <MapView
            aoiId={aoiId}
            layers={visibleLayers}
            transportRoadClasses={enabledTransportRoadClasses}
            references={visibleReferences}
            orthophotoEnabled={orthophotoEnabled}
            basemapMode={basemapMode}
            draftAoiOutline={aoiOutlines.draft}
            preparedAoiOutline={aoiOutlines.prepared}
            aoiViewport={aoiViewport}
            selected={selectedFeature}
            selectedDetail={selectedDetail}
            selectedCircuit={selectedCircuit}
            selectedCircuitMember={selectedCircuitMember}
            pickingAoi={pickingAoi}
            onSelectFeature={selectFeature}
            onCircuitChange={(circuit) => {
              setSelectedCircuit(circuit);
              setSelectedCircuitMember(null);
            }}
            onCircuitMemberChange={setSelectedCircuitMember}
            onPickAoiPoint={(point) => pickPoint(point, addActivity)}
            onZoomChange={setMapZoom}
          />
          {pickingAoi && <p className="mapInstruction">Click the map to set the AOI centre.</p>}
          <IconRail
            activePanel={activePanel}
            activityOpen={activityOpen}
            onPanel={selectPanel}
            onActivity={() => setActivityOpen((open) => !open)}
          />
        </div>
        {activePanel && (
          <aside
            className={`contextDrawer ${runtimeResult ? "" : "welcomeDrawer"}`}
            aria-label={`${activePanel} panel`}
          >
            <CloseButton
              className="drawerClose"
              onClick={() => setActivePanel(null)}
              ariaLabel="Close panel"
              title="Close panel"
            />
            <Suspense fallback={<DrawerSkeleton title={panelTitle} />}>
              {activePanel === "settings" && (
                <AoiSettings
                  onActivity={addActivity}
                  onApplied={applyResult}
                  onResetToDefault={resetToDefault}
                  isDefaultAoiActive={isDefaultAoiActive}
                  isDefaultAoiHidden={defaultAoiHidden}
                  onToggleDefaultAoiHidden={() => setDefaultAoiHidden((h) => !h)}
                />
              )}
              {activePanel === "layers" && (
                <>
                  {aoiId && (
                    <FeatureDetails
                      aoiId={aoiId}
                      selected={selectedFeature}
                      onDetailChange={setSelectedDetail}
                    />
                  )}
                  <LayerCatalog
                    layers={catalog}
                    enabledLayers={enabledLayers}
                    onToggle={toggleLayer}
                    enabledTransportRoadClasses={enabledTransportRoadClasses}
                    onTransportRoadClassToggle={toggleTransportRoadClass}
                  />
                </>
              )}
              {activePanel === "providers" && (
                <ProviderPanel
                  basemapMode={basemapMode}
                  onBasemapMode={setBasemapMode}
                  visibleReferences={visibleReferences.length}
                  enabledReferences={enabledReferences}
                  onReferenceToggle={(id, enabled) =>
                    setEnabledReferences((current) => ({ ...current, [id]: enabled }))
                  }
                  orthophotoEnabled={orthophotoEnabled}
                  onOrthophotoEnabled={setOrthophotoEnabled}
                  sourceAvailability={sourceAvailability}
                  issues={issues}
                  updateReview={updateReview}
                />
              )}
              {activePanel === "legend" && (
                <LegendPanel
                  layers={catalog}
                  referenceOverlayAvailable={
                    kiutReferenceLayers.length > 0 || Boolean(orthophotoReference)
                  }
                />
              )}
            </Suspense>
          </aside>
        )}
        <output className="mapStatus" aria-live="polite">
          <span>
            AOI: <strong>{runtimeResult?.aoi.aoi_id ?? "not prepared"}</strong>
          </span>
          <i />
          <span>
            Visible: <strong>{featureCount}</strong>
          </span>
          <i />
          <span>
            Base: <strong>{currentMapLabel}</strong>
          </span>
          {mapZoom !== null && (
            <>
              <i />
              <span>
                Zoom: <strong>{mapZoom.toFixed(1)}</strong>
              </span>
            </>
          )}
          {transportInspectionNeedsZoom && (
            <>
              <i />
              <span className="mapStatusGuidance">Roads & rail: zoom 11+</span>
            </>
          )}
        </output>
      </section>
      {activityOpen && (
        <Suspense fallback={null}>
          <ActivityWindow events={activityEvents} onClose={() => setActivityOpen(false)} />
        </Suspense>
      )}
    </main>
  );
}

function ProviderPanel({
  basemapMode,
  onBasemapMode,
  visibleReferences,
  enabledReferences,
  onReferenceToggle,
  orthophotoEnabled,
  onOrthophotoEnabled,
  sourceAvailability,
  issues,
  updateReview,
}: {
  basemapMode: VisualBasemapMode;
  onBasemapMode: (mode: VisualBasemapMode) => void;
  visibleReferences: number;
  enabledReferences: Record<string, boolean>;
  onReferenceToggle: (id: string, enabled: boolean) => void;
  orthophotoEnabled: boolean;
  onOrthophotoEnabled: (enabled: boolean) => void;
  sourceAvailability: ReturnType<typeof useProviderPreview>["sourceAvailability"];
  issues: ReturnType<typeof useProviderPreview>["issues"];
  updateReview: ReturnType<typeof useProviderPreview>["updateReview"];
}) {
  return (
    <section className="drawerSection">
      <h2>Providers</h2>
      <p className="muted">
        Analytical artifacts are listed in Layers. These controls keep visual base maps and
        reference-only overlays explicitly separate.
      </p>
      <section className="providerGroup">
        <h3>Visual base map</h3>
        <div className="basemapSelector" role="radiogroup" aria-label="Visual base map">
          {visualBasemapOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={basemapMode === option.id}
              className={basemapMode === option.id ? "active" : ""}
              onClick={() => onBasemapMode(option.id)}
            >
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
        <p className="muted">
          Dark OSM uses the same OSM tiles with local raster styling; it is not CARTO or provider
          data.
        </p>
      </section>
      <section className="providerGroup">
        <h3>
          Reference overlays <span>{visibleReferences}</span>
        </h3>
        <p className="muted">
          KIUT and orthophoto stay rendered reference context; they never become analytical vectors.
        </p>
        {kiutReferenceLayers.map((reference) => (
          <label className="layerToggle" key={reference.id}>
            <input
              type="checkbox"
              checked={enabledReferences[reference.id] ?? false}
              onChange={(event) => onReferenceToggle(reference.id, event.target.checked)}
            />
            <span>
              <strong>{reference.label}</strong>
              <small>KIUT/GESUT WMS · possible coverage only</small>
            </span>
          </label>
        ))}
        <label className="layerToggle">
          <input
            type="checkbox"
            checked={orthophotoEnabled}
            onChange={(event) => onOrthophotoEnabled(event.target.checked)}
          />
          <span>
            <strong>{orthophotoReference.label}</strong>
            <small>{orthophotoReference.limitation}</small>
          </span>
        </label>
      </section>
      <SourceAvailabilitySection sourceAvailability={sourceAvailability} />
      {issues.length > 0 && (
        <Suspense fallback={null}>
          <IssueReviewDrawer issues={issues} updateReview={updateReview} />
        </Suspense>
      )}
    </section>
  );
}
