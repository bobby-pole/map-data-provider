/** Pure style policy so the MVT preview can be verified without a WebGL runtime. */
export function isLinePresentationLayer(sourceLayer: string): boolean {
  return sourceLayer.includes("line");
}

export function presentationColor(index: number): string {
  return ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399"][index % 4] ?? "#38bdf8";
}

/** Online-only visual context; it is not provider data and is never cached by this app. */
export const openStreetMapBasemap = {
  label: "OpenStreetMap base map",
  tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>",
  minZoom: 0,
  maxZoom: 19,
} as const;
