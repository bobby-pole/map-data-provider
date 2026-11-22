import { lazy, Suspense } from "react";

import type { useProviderPreview } from "../hooks/useApi";
import { kiutReferenceLayers } from "../kiutReference";
import { type VisualBasemapMode, visualBasemapOptions } from "../mapStyle";
import { orthophotoReference } from "../orthophotoReference";
import { SourceAvailabilitySection } from "./SourceAvailabilitySection";

const IssueReviewDrawer = lazy(() =>
  import("./IssueReviewDrawer").then((m) => ({ default: m.IssueReviewDrawer })),
);

export function ProviderPanel({
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
