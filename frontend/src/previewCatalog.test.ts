import { describe, expect, it } from "vitest";

import { configuredPreviewLayers, popupDetails, previewLayerKey, sourceAttribution } from "./previewCatalog";
import type { MapPresentation } from "./types/api";

const fixturePresentation: MapPresentation = {
  response_version: "provider_map_presentation_read/v1",
  presentation_version: "provider_map_presentation/v1",
  aoi_id: "fixture_aoi",
  domain: "water",
  archive: { format: "pmtiles", size_bytes: 300, min_zoom: 7, max_zoom: 14, bounds: [18.4, 50, 18.7, 50.3] },
  attribution: "© OpenStreetMap contributors",
  archive_url: "/api/aoi/fixture_aoi/presentations/water/archive",
  layers: [
    { artifact_id: "water.main", source_layer: "water_main", feature_count: 1, source: "Fixture source", confidence: "medium", readiness: "usable_with_limitations", limitations: ["Pack limitation."], attribution: "© OpenStreetMap contributors", source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }] },
    { artifact_id: "water.assets", source_layer: "water_assets", feature_count: 1, source: "Fixture source", confidence: "medium", readiness: "usable_with_limitations", limitations: ["Pack limitation."], attribution: "© OpenStreetMap contributors", source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }] },
  ],
};

describe("manifest-driven preview catalog", () => {
  it("creates a toggleable layer from compact presentation metadata without a hard-coded domain", () => {
    const layers = configuredPreviewLayers([fixturePresentation]);
    expect(layers.map(previewLayerKey)).toEqual(["water:water.main", "water:water.assets"]);
    expect(layers[0]?.domain).toBe("water");
    expect(layers[0] && sourceAttribution(layers[0])).toBe("© OpenStreetMap contributors");
    expect(layers[0]?.archiveUrl).toContain("/presentations/water/archive");
  });

  it("uses rendered MVT fields with manifest readiness and limitations", () => {
    const [layer] = configuredPreviewLayers([fixturePresentation]);
    if (!layer) throw new Error("Expected fixture layer.");
    expect(popupDetails({ type: "Feature", properties: { category: "water main", confidence: "high", limitations: "Feature limitation." }, geometry: { type: "Point", coordinates: [18.5, 50.1] } }, layer)).toEqual({
      title: "water main",
      source: "Fixture source",
      confidence: "high",
      readiness: "usable_with_limitations",
      limitations: ["Feature limitation."],
    });
  });
});
