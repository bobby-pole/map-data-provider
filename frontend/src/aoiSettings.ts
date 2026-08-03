import type { RuntimeAoiInput, RuntimeCategory } from "./types/api";

export function buildRuntimeRequest(
  mode: "point_radius" | "administrative_selection",
  values: { longitude: string; latitude: string; radius: string; unitIds: string[] },
  profiles: RuntimeCategory[],
): { aoi: RuntimeAoiInput; profiles: RuntimeCategory[] } {
  if (profiles.length === 0) throw new Error("Select at least one provider category.");
  if (mode === "administrative_selection") {
    if (values.unitIds.length === 0) throw new Error("Select at least one administrative unit.");
    return { aoi: { type: "administrative_selection", unit_ids: [...new Set(values.unitIds)].sort() }, profiles: [...new Set(profiles)].sort() as RuntimeCategory[] };
  }
  const longitude = Number(values.longitude); const latitude = Number(values.latitude); const radius_m = Number(values.radius);
  if (![longitude, latitude, radius_m].every(Number.isFinite)) throw new Error("Point/radius AOI requires finite coordinates and radius.");
  return { aoi: { type: "point_radius", longitude, latitude, radius_m }, profiles: [...new Set(profiles)].sort() as RuntimeCategory[] };
}
