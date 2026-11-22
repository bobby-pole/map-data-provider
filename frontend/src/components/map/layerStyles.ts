import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";

import {
  isLinePresentationLayer,
  powerVoltageLabelMinZoom,
  roadLineColor,
  voltageLineColor,
} from "../../mapStyle";
import { pointSymbolExpression, pointSymbolSize } from "../../mapSymbols";
import { layerPresentationSemantic } from "../../presentationSemantics";
import { type PreviewLayer, type TransportRoadClass } from "../../previewCatalog";
import { providerLayerId } from "./mapHelpers";

type LabeledLineSpec = {
  color: string;
  width: number;
  dasharray?: number[];
  textColor: string;
  haloColor: string;
};

const LABELED_LINE_SPECS: Record<string, LabeledLineSpec> = {
  "bridges.bridges": {
    color: "#0284c7",
    width: 5,
    textColor: "#e0f2fe",
    haloColor: "#0369a1",
  },
  "bridges.viaducts": {
    color: "#a855f7",
    width: 5,
    textColor: "#f3e8ff",
    haloColor: "#6b21a8",
  },
  "water.pipelines": {
    color: "#06b6d4",
    width: 4,
    dasharray: [4, 2],
    textColor: "#cffafe",
    haloColor: "#0e7490",
  },
  "gas.pipelines": {
    color: "#f97316",
    width: 4,
    dasharray: [4, 2],
    textColor: "#ffedd5",
    haloColor: "#c2410c",
  },
  "sewer.pipelines": {
    color: "#78350f",
    width: 4,
    dasharray: [4, 2],
    textColor: "#fef3c7",
    haloColor: "#451a03",
  },
  "telecom.lines": {
    color: "#8b5cf6",
    width: 4,
    dasharray: [3, 2],
    textColor: "#ede9fe",
    haloColor: "#5b21b6",
  },
  "district_heating.lines": {
    color: "#dc2626",
    width: 4,
    dasharray: [6, 2],
    textColor: "#fee2e2",
    haloColor: "#991b1b",
  },
};

const INVISIBLE_HITAREA_LINE_COLORS: Record<string, string> = {
  "transport.railways": "#cbd5e1",
  "water.waterways": "#0284c7",
};

const POINT_LOW_MINZOOM_DOMAINS = new Set([
  "emergency",
  "gas",
  "sewer",
  "industrial",
  "telecom",
  "district_heating",
]);

function addPowerLineLayers(
  map: maplibregl.Map,
  id: string,
  sourceId: string,
  sourceLayer: string,
): void {
  const base = {
    type: "line" as const,
    source: sourceId,
    "source-layer": sourceLayer,
    paint: { "line-color": voltageLineColor, "line-width": 4.5, "line-opacity": 0.9 },
  };
  map.addLayer({
    ...base,
    id,
    filter: [
      "all",
      ["!=", ["get", "voltage_bucket"], "medium"],
      ["!=", ["get", "voltage_bucket"], "low"],
    ],
  });
  map.addLayer({
    ...base,
    id: `${id}-medium`,
    minzoom: 11,
    filter: ["==", ["get", "voltage_bucket"], "medium"],
  });
  map.addLayer({
    ...base,
    id: `${id}-low`,
    minzoom: 13,
    filter: ["==", ["get", "voltage_bucket"], "low"],
  });

  const labelBands: Array<{
    suffix: string;
    minzoom: number;
    filter: FilterSpecification;
  }> = [
    {
      suffix: "transmission",
      minzoom: powerVoltageLabelMinZoom.transmission,
      filter: [
        "all",
        ["!=", ["get", "voltage_bucket"], "medium"],
        ["!=", ["get", "voltage_bucket"], "low"],
        ["!=", ["get", "voltage_bucket"], "unknown"],
      ],
    },
    {
      suffix: "medium",
      minzoom: powerVoltageLabelMinZoom.medium,
      filter: ["==", ["get", "voltage_bucket"], "medium"],
    },
    {
      suffix: "low",
      minzoom: powerVoltageLabelMinZoom.low,
      filter: ["==", ["get", "voltage_bucket"], "low"],
    },
  ];
  for (const band of labelBands) {
    map.addLayer({
      id: `${id}-labels-${band.suffix}`,
      type: "symbol",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: band.minzoom,
      filter: band.filter,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "voltage_label"],
        "text-size": 11,
        "text-max-angle": 35,
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "#0f172a",
        "text-halo-width": 1.5,
      },
    });
  }
}

export function addProviderPresentationLayer(
  map: maplibregl.Map,
  layer: PreviewLayer,
  index: number,
  sourceId: string,
  transportRoadClasses: Record<TransportRoadClass, boolean>,
): void {
  const id = providerLayerId(layer);
  const color = layerPresentationSemantic(layer, index).color;
  const sourceLayer = layer.artifact.source_layer;
  const artifactId = layer.artifact.artifact_id;

  if (!isLinePresentationLayer(sourceLayer)) {
    const minzoom = POINT_LOW_MINZOOM_DOMAINS.has(layer.domain) ? 9 : 12;
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.22 },
    });
    map.addLayer({
      id: `${id}-outline`,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": color, "line-width": 2, "line-opacity": 0.86 },
    });
    map.addLayer({
      id,
      type: "symbol",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom,
      filter: ["in", ["geometry-type"], ["literal", ["Point", "Polygon"]]],
      layout: {
        "icon-image": pointSymbolExpression(layer),
        "icon-size": pointSymbolSize(layer),
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
      },
    });
    return;
  }

  if (artifactId === "transport.roads") {
    const enabledRoadClasses = Object.entries(transportRoadClasses)
      .filter(([, enabled]) => enabled)
      .map(([roadClass]) => roadClass);
    map.addLayer({
      id,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: 11,
      filter: ["in", ["get", "road_class"], ["literal", enabledRoadClasses]],
      paint: { "line-color": roadLineColor, "line-width": 14, "line-opacity": 0 },
    });
    return;
  }

  const hitareaColor = INVISIBLE_HITAREA_LINE_COLORS[artifactId];
  if (hitareaColor) {
    map.addLayer({
      id,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: artifactId === "transport.railways" ? 11 : 10,
      paint: { "line-color": hitareaColor, "line-width": 14, "line-opacity": 0 },
    });
    return;
  }

  const labeledSpec = LABELED_LINE_SPECS[artifactId];
  if (labeledSpec) {
    map.addLayer({
      id,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: 10,
      paint: {
        "line-color": labeledSpec.color,
        "line-width": labeledSpec.width,
        ...(labeledSpec.dasharray ? { "line-dasharray": labeledSpec.dasharray } : {}),
        "line-opacity": 0.95,
      },
    });
    map.addLayer({
      id: `${id}-labels`,
      type: "symbol",
      source: sourceId,
      "source-layer": sourceLayer,
      minzoom: 11,
      filter: ["has", "name"],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-max-angle": 35,
      },
      paint: {
        "text-color": labeledSpec.textColor,
        "text-halo-color": labeledSpec.haloColor,
        "text-halo-width": 1.5,
      },
    });
    return;
  }

  if (layer.domain === "power" || sourceLayer.includes("power")) {
    addPowerLineLayers(map, id, sourceId, sourceLayer);
    return;
  }

  map.addLayer({
    id,
    type: "line",
    source: sourceId,
    "source-layer": sourceLayer,
    paint: { "line-color": color, "line-width": 4, "line-opacity": 0.9 },
  });
}
