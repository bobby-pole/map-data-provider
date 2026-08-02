import { describe, expect, it } from "vitest";

import { configuredPreviewLayers, popupDetails, previewLayerKey, sourceAttribution } from "./previewCatalog";
import type { DomainPack } from "./types/api";

const fixturePack: DomainPack = {
  response_version: "provider_domain_pack_read/v2",
  aoi_id: "fixture_aoi",
  domain: "water",
  readiness: { domain: "water", readiness: "usable_with_limitations", quality_status: "passed", highest_issue_severity: null, feature_count: 1 },
  source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
  sources: [{ id: "openstreetmap", name: "OpenStreetMap", attribution: "© OpenStreetMap contributors", usage_role: "analytical", distribution: { public_export: "allowed", reason: "ODbL" }, limitations: ["Completeness varies."] }],
  layers: [{
    artifact: { id: "water.main", kind: "processed_vector", format: "geojson", feature_count: 1, public_export: true, source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }] },
    layer: {
      type: "FeatureCollection",
      metadata: { aoi_id: "fixture_aoi", domain: "water", layer_id: "water.main", source: "Fixture source", source_type: "analytical_vector", confidence: "medium", limitations: ["Pack limitation."], eligible_for_analysis: true, readiness: "usable_with_limitations", feature_count: 1, snapshot_at: "2026-08-01T00:00:00Z", source_query: "fixture query" },
      features: [{ type: "Feature", properties: { category: "water main", confidence: "high", limitations: ["Feature limitation."] }, geometry: { type: "Point", coordinates: [18.5, 50.1] } }],
    },
  }],
};

describe("manifest-driven preview catalog", () => {
  it("creates a toggleable layer from domain-pack data without a hard-coded domain", () => {
    const [layer] = configuredPreviewLayers([fixturePack]);
    expect(layer?.domain).toBe("water");
    expect(layer && previewLayerKey(layer)).toBe("water:water.main");
    expect(layer && sourceAttribution(layer)).toBe("© OpenStreetMap contributors");
  });

  it("uses provider-normalized feature fields with manifest readiness and limitations", () => {
    const [layer] = configuredPreviewLayers([fixturePack]);
    if (!layer) throw new Error("Expected fixture layer.");
    expect(popupDetails(layer.layer.features[0]!, layer)).toEqual({
      title: "water main",
      source: "Fixture source",
      confidence: "high",
      readiness: "usable_with_limitations",
      limitations: ["Feature limitation."],
    });
  });
});
