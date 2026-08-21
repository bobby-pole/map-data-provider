import { describe, expect, it } from "vitest";

import {
  isPipelineArtifact,
  isPopupOnlyNetworkArtifact,
  layerPresentationSemantic,
} from "./presentationSemantics";
import type { PreviewLayer } from "./previewCatalog";

const gasPipeline: PreviewLayer = {
  domain: "gas",
  archiveUrl: "/api/aoi/example/presentations/gas/archive",
  archiveBounds: [18, 50, 19, 51],
  archiveMinZoom: 8,
  archiveMaxZoom: 16,
  artifact: {
    artifact_id: "gas.pipelines",
    source_layer: "gas.pipelines",
    feature_count: 2,
    source: "OpenStreetMap",
    confidence: "medium",
    readiness: "usable_with_limitations",
    limitations: [],
    attribution: "© OpenStreetMap contributors",
    source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
  },
};

describe("presentation semantics", () => {
  it("provides a shared non-colour line descriptor for a layer tree, legend and map renderer", () => {
    expect(layerPresentationSemantic(gasPipeline)).toMatchObject({
      label: "Gas Pipelines",
      geometry: "line",
      symbol: "dashed line",
      color: "#f97316",
      description: "Gas pipeline",
    });
  });

  it("keeps roads, railways and waterways as popup-only hit targets while pipelines remain visible", () => {
    expect(isPopupOnlyNetworkArtifact("transport.roads")).toBe(true);
    expect(isPopupOnlyNetworkArtifact("transport.railways")).toBe(true);
    expect(isPopupOnlyNetworkArtifact("water.waterways")).toBe(true);
    expect(isPopupOnlyNetworkArtifact("gas.pipelines")).toBe(false);
    expect(isPipelineArtifact("gas.pipelines")).toBe(true);
    expect(isPipelineArtifact("telecom.lines")).toBe(false);
  });
});
