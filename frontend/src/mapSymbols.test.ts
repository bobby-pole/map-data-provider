import { describe, expect, it } from "vitest";

import {
  legendItemsForLayer,
  mapSymbolDataUrl,
  pointSymbolExpression,
  pointSymbolKind,
} from "./mapSymbols";
import type { PreviewLayer } from "./previewCatalog";

function layer(artifactId: string): PreviewLayer {
  return {
    domain: artifactId.split(".")[0] ?? "power",
    archiveUrl: "/archive",
    archiveBounds: [18, 50, 19, 51],
    archiveMinZoom: 7,
    archiveMaxZoom: 14,
    artifact: {
      artifact_id: artifactId,
      source_layer: artifactId.replace(".", "_"),
      feature_count: 1,
      source: "OpenStreetMap",
      confidence: "medium",
      readiness: "usable_with_limitations",
      limitations: [],
      attribution: "© OpenStreetMap contributors",
      source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
    },
  };
}

describe("map object symbols", () => {
  it("assigns recognisable source-backed symbols to delivered object categories", () => {
    expect(pointSymbolKind(layer("emergency.hospitals"))).toBe("hospital");
    expect(pointSymbolKind(layer("emergency.fire_services"))).toBe("fire-station");
    expect(pointSymbolKind(layer("public.education"))).toBe("school");
    expect(pointSymbolKind(layer("telecom.towers"))).toBe("telecom-tower");
    expect(pointSymbolKind(layer("water.facilities"))).toBe("water-facility");
    expect(pointSymbolKind(layer("industrial.military_context"))).toBe("military");
  });

  it("keeps the power-support icon expression specific to its delivered asset_type", () => {
    expect(pointSymbolExpression(layer("power.supports"))).toEqual(
      expect.arrayContaining([
        "tower",
        "mdq-symbol:power-tower",
        "portal",
        "mdq-symbol:power-portal",
      ]),
    );
    expect(legendItemsForLayer(layer("power.supports"))).toEqual(
      expect.arrayContaining([{ kind: "power-tower", label: "Transmission tower" }]),
    );
  });

  it("distinguishes delivered power assets rather than giving every asset one symbol", () => {
    expect(pointSymbolExpression(layer("power.assets"))).toEqual(
      expect.arrayContaining([
        "substation",
        "mdq-symbol:power-substation",
        "transformer",
        "mdq-symbol:power-transformer",
        "generator",
        "mdq-symbol:power-generator",
        "tower",
        "mdq-symbol:power-tower",
        "portal",
        "mdq-symbol:power-portal",
      ]),
    );
    expect(legendItemsForLayer(layer("power.assets"))).toEqual(
      expect.arrayContaining([{ kind: "power-plant", label: "Power plant" }]),
    );
  });

  it("uses the same self-contained symbol asset in the legend and map renderer", () => {
    expect(mapSymbolDataUrl("hospital")).toContain("data:image/svg+xml");
    expect(decodeURIComponent(mapSymbolDataUrl("hospital"))).toContain("<svg");
  });
});
