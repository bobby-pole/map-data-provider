import type { Geometry, Polygon } from "geojson";

import type { AdministrativeUnit, RuntimeAoiInput, RuntimeCategory } from "./types/api";

/** Return the province roots represented by a PRG selection, including county/gmina descendants. */
export function administrativeSelectionRoots(
  unitIds: string[],
  units: AdministrativeUnit[],
): string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const roots = new Set<string>();
  unitIds.forEach((unitId) => {
    let current = byId.get(unitId);
    const visited = new Set<string>();
    while (current?.parent_id && !visited.has(current.id)) {
      visited.add(current.id);
      current = byId.get(current.parent_id);
    }
    if (current?.kind === "voivodeship") {
      roots.add(current.id);
    }
  });
  return [...roots].sort();
}

/** Keep the administrative selection camera predictable instead of deriving it from variable PRG bounds. */
export function administrativeSelectionZoom(
  unitIds: string[],
  units: AdministrativeUnit[],
): number {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  return unitIds.some((unitId) => unitsById.get(unitId)?.kind === "voivodeship") ? 7.5 : 9;
}

export function pointRadiusZoom(radiusMetres: number): number {
  if (radiusMetres <= 2_000) {
    return 13;
  }
  if (radiusMetres <= 5_000) {
    return 12;
  }
  if (radiusMetres <= 10_000) {
    return 11;
  }
  if (radiusMetres <= 25_000) {
    return 10;
  }
  if (radiusMetres <= 50_000) {
    return 9;
  }
  return 8;
}

export function parseCoordinate(value: string): number {
  return Number(value.trim().replace(",", "."));
}

export const MAX_DEMO_RADIUS_M = 10_000;
export const MAX_CUSTOM_RADIUS_M = 30_000;

export function isPointRadiusValid(
  longitude: string,
  latitude: string,
  radius: string,
  maxRadiusM = MAX_CUSTOM_RADIUS_M,
): boolean {
  return validatePointRadiusInput(longitude, latitude, radius, maxRadiusM).valid;
}

export function validatePointRadiusInput(
  longitude: string,
  latitude: string,
  radius: string,
  maxRadiusM = MAX_CUSTOM_RADIUS_M,
): { valid: boolean; error: string | null } {
  if (!latitude.trim()) {
    return { valid: false, error: "Latitude coordinate is required." };
  }
  const lat = parseCoordinate(latitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: "Enter a valid latitude between -90 and 90 (e.g. 50.102)." };
  }

  if (!longitude.trim()) {
    return { valid: false, error: "Longitude coordinate is required." };
  }
  const lon = parseCoordinate(longitude);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { valid: false, error: "Enter a valid longitude between -180 and 180 (e.g. 18.546)." };
  }

  if (!radius.trim()) {
    return { valid: false, error: "Radius in meters is required." };
  }
  const rad = parseCoordinate(radius);
  if (!Number.isFinite(rad) || rad <= 0) {
    return { valid: false, error: "Enter a valid positive radius in meters." };
  }
  if (rad > maxRadiusM) {
    return {
      valid: false,
      error: `Radius exceeds maximum allowed limit of ${maxRadiusM / 1000} km (${maxRadiusM.toLocaleString()} m).`,
    };
  }

  return { valid: true, error: null };
}

export function validateAdministrativeUnitSelection(
  unitIds: string[],
  units: AdministrativeUnit[],
  maxCounties = 3,
): { valid: boolean; error: string | null } {
  if (unitIds.length === 0) {
    return { valid: false, error: "Select at least one administrative unit." };
  }
  const byId = new Map(units.map((u) => [u.id, u]));

  // 1. Block voivodeship selection
  const hasVoivodeship = unitIds.some((id) => byId.get(id)?.kind === "voivodeship");
  if (hasVoivodeship) {
    return {
      valid: false,
      error:
        "Selecting an entire voivodeship is not allowed. Select up to 3 adjacent counties or their gminas.",
    };
  }

  // 2. Check voivodeships consistency
  const roots = administrativeSelectionRoots(unitIds, units);
  if (roots.length > 1) {
    return { valid: false, error: "All selected units must belong to the same voivodeship." };
  }

  // 3. Determine involved counties
  const involvedCounties = new Set<string>();
  for (const id of unitIds) {
    const u = byId.get(id);
    if (!u) {
      continue;
    }
    if (u.kind === "county") {
      involvedCounties.add(id);
    } else if (u.kind === "gmina" && u.parent_id) {
      involvedCounties.add(u.parent_id);
    }
  }

  if (involvedCounties.size > maxCounties) {
    return {
      valid: false,
      error: `You can select units from at most ${maxCounties} ${maxCounties === 1 ? "county" : "adjacent counties"}.`,
    };
  }

  return { valid: true, error: null };
}

export function buildRuntimeRequest(
  mode: "point_radius" | "administrative_selection",
  values: { longitude: string; latitude: string; radius: string; unitIds: string[] },
  profiles: RuntimeCategory[],
  catalogUnits?: AdministrativeUnit[],
  maxRadiusM = MAX_CUSTOM_RADIUS_M,
): { aoi: RuntimeAoiInput; profiles: RuntimeCategory[] } {
  if (profiles.length === 0) {
    throw new Error("Select at least one provider category.");
  }
  if (mode === "administrative_selection") {
    if (values.unitIds.length === 0) {
      throw new Error("Select at least one administrative unit.");
    }
    if (catalogUnits && catalogUnits.length > 0) {
      const validation = validateAdministrativeUnitSelection(values.unitIds, catalogUnits);
      if (!validation.valid && validation.error) {
        throw new Error(validation.error);
      }
    }
    return {
      aoi: { type: "administrative_selection", unit_ids: [...new Set(values.unitIds)].sort() },
      profiles: [...new Set(profiles)].sort(),
    };
  }
  const longitude = parseCoordinate(values.longitude);
  const latitude = parseCoordinate(values.latitude);
  const radius_m = parseCoordinate(values.radius);
  if (![longitude, latitude, radius_m].every(Number.isFinite) || radius_m <= 0) {
    throw new Error("Point/radius AOI requires finite coordinates and radius.");
  }
  if (radius_m > maxRadiusM) {
    throw new Error(
      `Point/radius AOI radius cannot exceed ${maxRadiusM / 1000} km (${maxRadiusM} m).`,
    );
  }
  return {
    aoi: { type: "point_radius", longitude, latitude, radius_m },
    profiles: [...new Set(profiles)].sort(),
  };
}

export async function providerResponseMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  let message = fallback;
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof payload.message === "string" && payload.message) {
      message = payload.message;
    }
  } catch {
    // The caller-provided fallback remains human-readable.
  }
  return message;
}

export async function runtimeRequestError(response: Response): Promise<string> {
  const message = await providerResponseMessage(
    response,
    `AOI preparation failed (HTTP ${response.status}).`,
  );
  return `No new AOI snapshot was published; the existing map was left unchanged. ${message}`;
}

/** Match the requested WGS84 circle visually before the API returns its resolved AOI. */
export function pointRadiusOutline(
  longitude: number,
  latitude: number,
  radiusMetres: number,
): Polygon | null {
  if (![longitude, latitude, radiusMetres].every(Number.isFinite) || radiusMetres <= 0) {
    return null;
  }
  const earthRadius = 6_371_008.8;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const longitudeRadians = (longitude * Math.PI) / 180;
  const angularDistance = radiusMetres / earthRadius;
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const bearing = (2 * Math.PI * index) / 64;
    const nextLatitude = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance) +
        Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const nextLongitude =
      longitudeRadians +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
        Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitude),
      );
    return [
      Number(((nextLongitude * 180) / Math.PI).toFixed(7)),
      Number(((nextLatitude * 180) / Math.PI).toFixed(7)),
    ];
  });
  return { type: "Polygon", coordinates: [coordinates] };
}

export const DEFAULT_AOI_CENTER = { longitude: 18.546285, latitude: 50.102174, radius_m: 35_000 };
export const DEFAULT_AOI_OUTLINE = pointRadiusOutline(
  DEFAULT_AOI_CENTER.longitude,
  DEFAULT_AOI_CENTER.latitude,
  DEFAULT_AOI_CENTER.radius_m,
);

/** Keep the prepared snapshot and the in-progress AOI edit as separate map states. */
export function displayedAoiOutlines(
  draft: Geometry | null,
  prepared: Geometry | null,
): { draft: Geometry | null; prepared: Geometry | null } {
  return { draft, prepared };
}
