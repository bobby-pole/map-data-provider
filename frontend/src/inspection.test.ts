import { describe, expect, it } from "vitest";

import { featureInspection } from "./inspection";
import { configuredPreviewLayers } from "./previewCatalog";
import type { DomainPack } from "./types/api";

const pack: DomainPack = {
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
      metadata: { aoi_id: "fixture_aoi", domain: "water", layer_id: "water.main", source: "Fixture source", source_type: "analytical_vector", confidence: "medium", limitations: ["Pack limitation."], eligible_for_analysis: true, readiness: "usable_with_limitations", feature_count: 1, snapshot_at: "2026-08-02T00:00:00Z", source_query: "fixture query" },
      features: [{ type: "Feature", properties: { asset_type: "water main", diameter_mm: 400, source: "Fixture source", limitations: ["Feature limitation."], osm_tags: { man_made: "pipeline" } }, geometry: { type: "Point", coordinates: [18.5, 50.1] } }],
    },
  }],
};

describe("feature inspection", () => {
  it("keeps normalized evidence, attribution and provider attributes together", () => {
    const [layer] = configuredPreviewLayers([pack]);
    if (!layer) throw new Error("Expected a preview layer.");
    const inspection = featureInspection({ layer, feature: layer.layer.features[0]! });

    expect(inspection).toMatchObject({
      title: "water main",
      source: "Fixture source",
      attribution: "© OpenStreetMap contributors",
      confidence: "medium",
      readiness: "usable_with_limitations",
      limitations: ["Feature limitation."],
    });
    expect(inspection.providerAttributes).toEqual(expect.arrayContaining([
      { name: "diameter_mm", value: "400" },
      { name: "asset_type", value: "water main" },
    ]));
    expect(inspection.providerAttributes).not.toEqual(expect.arrayContaining([
      { name: "osm_tags", value: '{"man_made":"pipeline"}' },
    ]));
  });
});
