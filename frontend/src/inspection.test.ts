import { describe, expect, it } from "vitest";

import { featureInspection } from "./inspection";
import { configuredPreviewLayers } from "./previewCatalog";
import type { MapPresentation } from "./types/api";

const presentation: MapPresentation = {
  response_version: "provider_map_presentation_read/v1", presentation_version: "provider_map_presentation/v1", aoi_id: "fixture_aoi", domain: "water",
  archive: { format: "pmtiles", size_bytes: 300, min_zoom: 7, max_zoom: 14, bounds: [18.4, 50, 18.7, 50.3] },
  attribution: "© OpenStreetMap contributors", archive_url: "/api/aoi/fixture_aoi/presentations/water/archive",
  layers: [{ artifact_id: "water.main", source_layer: "water_main", feature_count: 1, source: "Fixture source", confidence: "medium", readiness: "usable_with_limitations", limitations: ["Pack limitation."], attribution: "© OpenStreetMap contributors", source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }] }],
};

describe("feature inspection", () => {
  it("keeps rendered provider evidence, attribution and compact MVT attributes together", () => {
    const [layer] = configuredPreviewLayers([presentation]);
    if (!layer) throw new Error("Expected a preview layer.");
    const inspection = featureInspection({ layer, feature: { type: "Feature", properties: { asset_type: "water main", source: "Fixture source", limitations: "Feature limitation.", source_id: "way/1", osm_tags: { man_made: "pipeline" } }, geometry: { type: "Point", coordinates: [18.5, 50.1] } } });

    expect(inspection).toMatchObject({
      title: "water main", source: "Fixture source", attribution: "© OpenStreetMap contributors", confidence: "medium", readiness: "usable_with_limitations", limitations: ["Feature limitation."],
    });
    expect(inspection.providerAttributes).toEqual(expect.arrayContaining([
      { name: "source_id", value: "way/1" }, { name: "asset_type", value: "water main" },
    ]));
    expect(inspection.providerAttributes).not.toEqual(expect.arrayContaining([
      { name: "osm_tags", value: '{"man_made":"pipeline"}' },
    ]));
  });

  it("inspects transport road features and preserves provider-normalized road_class", () => {
    const transportPresentation: MapPresentation = {
      response_version: "provider_map_presentation_read/v1", presentation_version: "provider_map_presentation/v1", aoi_id: "fixture_aoi", domain: "transport",
      archive: { format: "pmtiles", size_bytes: 300, min_zoom: 7, max_zoom: 14, bounds: [18.4, 50, 18.7, 50.3] },
      attribution: "© OpenStreetMap contributors", archive_url: "/api/aoi/fixture_aoi/presentations/transport/archive",
      layers: [{ artifact_id: "transport.roads", source_layer: "transport.roads", feature_count: 1, source: "OpenStreetMap", confidence: "medium", readiness: "usable_with_limitations", limitations: ["Transport limitation."], attribution: "© OpenStreetMap contributors", source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }] }],
    };
    const [layer] = configuredPreviewLayers([transportPresentation]);
    if (!layer) throw new Error("Expected transport layer.");
    const inspection = featureInspection({ layer, feature: { type: "Feature", properties: { asset_type: "roads", road_class: "major", source: "OpenStreetMap", source_id: "way/10", osm_tags: { highway: "primary", ref: "DK78" } }, geometry: { type: "LineString", coordinates: [[18.5, 50.1], [18.6, 50.2]] } } });

    expect(inspection).toMatchObject({
      title: "roads", source: "OpenStreetMap", confidence: "medium", readiness: "usable_with_limitations",
    });
    expect(inspection.providerAttributes).toEqual(expect.arrayContaining([
      { name: "road_class", value: "major" },
      { name: "source_id", value: "way/10" },
    ]));
  });
});
