import { isLinePresentationLayer, presentationColor } from "./mapStyle";
import type { PreviewLayer } from "./previewCatalog";

export type PresentationSemantic = {
  label: string;
  geometry: "line" | "point_or_area";
  symbol: "solid line" | "dashed line" | "point / area" | "popup-only hit target";
  color: string;
  description: string;
};

const semanticByArtifact: Record<string, Omit<PresentationSemantic, "label">> = {
  "water.waterways": {
    geometry: "line",
    symbol: "popup-only hit target",
    color: "#0284c7",
    description: "Watercourse or canal; its source geometry is not drawn",
  },
  "water.pipelines": {
    geometry: "line",
    symbol: "dashed line",
    color: "#06b6d4",
    description: "Water pipeline",
  },
  "gas.pipelines": {
    geometry: "line",
    symbol: "dashed line",
    color: "#f97316",
    description: "Gas pipeline",
  },
  "sewer.pipelines": {
    geometry: "line",
    symbol: "dashed line",
    color: "#78350f",
    description: "Sewer pipeline",
  },
  "telecom.lines": {
    geometry: "line",
    symbol: "dashed line",
    color: "#8b5cf6",
    description: "Telecom line",
  },
  "district_heating.lines": {
    geometry: "line",
    symbol: "dashed line",
    color: "#dc2626",
    description: "District-heating line",
  },
  "transport.roads": {
    geometry: "line",
    symbol: "popup-only hit target",
    color: "#ef4444",
    description: "Road; its source geometry is not drawn",
  },
  "transport.railways": {
    geometry: "line",
    symbol: "popup-only hit target",
    color: "#cbd5e1",
    description: "Railway; its source geometry is not drawn",
  },
  "bridges.bridges": {
    geometry: "line",
    symbol: "solid line",
    color: "#0284c7",
    description: "Bridge",
  },
  "bridges.viaducts": {
    geometry: "line",
    symbol: "solid line",
    color: "#a855f7",
    description: "Viaduct",
  },
};

const popupOnlyNetworkArtifactIds = new Set([
  "transport.roads",
  "transport.railways",
  "water.waterways",
]);
const pipelineArtifactIds = new Set([
  "water.pipelines",
  "gas.pipelines",
  "sewer.pipelines",
  "district_heating.lines",
]);

/** Delivered geometry is used as a hit target only; it is never drawn or highlighted. */
export function isPopupOnlyNetworkArtifact(artifactId: string): boolean {
  return popupOnlyNetworkArtifactIds.has(artifactId);
}

/** These utility networks retain visible geometry and the selected-line highlight. */
export function isPipelineArtifact(artifactId: string): boolean {
  return pipelineArtifactIds.has(artifactId);
}

export function layerPresentationSemantic(layer: PreviewLayer, index = 0): PresentationSemantic {
  const defined = semanticByArtifact[layer.artifact.artifact_id];
  return {
    label: formatArtifactTitle(layer.artifact.artifact_id),
    ...(defined ?? {
      geometry: isLinePresentationLayer(layer.artifact.source_layer) ? "line" : "point_or_area",
      symbol: isLinePresentationLayer(layer.artifact.source_layer) ? "solid line" : "point / area",
      color: presentationColor(index),
      description: isLinePresentationLayer(layer.artifact.source_layer)
        ? "Provider network or linear feature"
        : "Provider point or polygon feature",
    }),
  };
}

export function formatArtifactTitle(artifactId: string): string {
  return artifactId.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
