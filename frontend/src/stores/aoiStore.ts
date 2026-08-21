import { create } from "zustand";
import type { Geometry } from "geojson";

import type {
  AdministrativeBoundary,
  AdministrativeCatalog,
  ProviderRuntimeJob,
  ProviderRuntimeResponse,
  RuntimeCategory,
  RuntimePreflight,
} from "../types/api";
import {
  MAX_CUSTOM_RADIUS_M,
  administrativeSelectionZoom,
  buildRuntimeRequest,
  isPointRadiusValid,
  parseCoordinate,
  pointRadiusOutline,
  pointRadiusZoom,
  providerResponseMessage,
  runtimeRequestError,
} from "../aoiSettings";
import type { ActivityEvent } from "../components/ActivityWindow";

export const ALL_RUNTIME_CATEGORIES: RuntimeCategory[] = [
  "power",
  "emergency",
  "public",
  "transport",
  "bridges",
  "water",
  "gas",
  "sewer",
  "industrial",
  "telecom",
  "district_heating",
];

export type AoiState = {
  catalog: AdministrativeCatalog | null;
  catalogLoading: boolean;
  mode: "point_radius" | "administrative_selection";
  longitude: string;
  latitude: string;
  radius: string;
  unitIds: string[];
  selectedCategories: RuntimeCategory[];
  busy: boolean;
  error: string | null;
  preflight: RuntimePreflight | null;
  boundaryMessage: string | null;
  progress: ProviderRuntimeJob | null;
  result: ProviderRuntimeResponse | null;
  draftAoiOutline: Geometry | null;
  aoiViewport: { geometry: Geometry; zoom: number } | null;
  pickingAoi: boolean;
  mapPoint: { longitude: number; latitude: number } | null;

  // Actions
  loadCatalog: (onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void) => Promise<void>;
  setMode: (mode: "point_radius" | "administrative_selection") => void;
  setLongitude: (longitude: string) => void;
  setLatitude: (latitude: string) => void;
  setRadius: (radius: string) => void;
  setUnitIds: (unitIds: string[]) => void;
  toggleCategory: (category: RuntimeCategory, checked: boolean) => void;
  toggleAllCategories: () => void;
  setPickingAoi: (picking: boolean) => void;
  pickPoint: (point: { longitude: number; latitude: number }, onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void) => void;
  applyAoi: (
    onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
    onApplied: (result: ProviderRuntimeResponse) => void,
  ) => Promise<void>;
};

let boundaryAbortController: AbortController | null = null;
let boundaryDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function updatePointRadiusDraft(
  set: (state: Partial<AoiState> | ((state: AoiState) => Partial<AoiState>)) => void,
  get: () => AoiState,
) {
  const { longitude, latitude, radius } = get();
  if (!radius.trim()) {
    set({ draftAoiOutline: null, aoiViewport: null, mapPoint: null });
    return;
  }
  const rad = parseCoordinate(radius);
  if (Number.isFinite(rad) && rad > MAX_CUSTOM_RADIUS_M) {
    set({
      draftAoiOutline: null,
      aoiViewport: null,
      error: `Radius exceeds maximum allowed limit of 20,000 m (20 km). Please enter a value ≤ 20,000 m.`,
    });
    return;
  }
  if (isPointRadiusValid(longitude, latitude, radius)) {
    const lon = parseCoordinate(longitude);
    const lat = parseCoordinate(latitude);
    const outline = pointRadiusOutline(lon, lat, rad);
    const zoom = pointRadiusZoom(rad);
    set({
      mapPoint: { longitude: lon, latitude: lat },
      draftAoiOutline: outline,
      aoiViewport: outline ? { geometry: outline, zoom } : null,
      error: null,
    });
  } else {
    set({
      draftAoiOutline: null,
      aoiViewport: null,
      mapPoint: null,
    });
  }
}

export const useAoiStore = create<AoiState>((set, get) => ({
  catalog: null,
  catalogLoading: false,
  mode: "point_radius",
  longitude: "",
  latitude: "",
  radius: "20000",
  unitIds: [],
  selectedCategories: [],
  busy: false,
  error: null,
  preflight: null,
  boundaryMessage: null,
  progress: null,
  result: null,
  draftAoiOutline: null,
  aoiViewport: null,
  pickingAoi: false,
  mapPoint: null,

  loadCatalog: async (onActivity) => {
    if (get().catalog || get().catalogLoading) return;
    set({ catalogLoading: true });
    onActivity({ phase: "validation", message: "Reading the local, versioned PRG administrative index." });
    try {
      const response = await fetch("/api/aoi/catalog");
      if (!response.ok) {
        throw new Error(await providerResponseMessage(response, `Administrative catalogue could not be read (HTTP ${response.status}).`));
      }
      const catalog = (await response.json()) as AdministrativeCatalog;
      set({ catalog, catalogLoading: false });
      onActivity({
        phase: "validation",
        message: `Loaded PRG ${catalog.catalog_version}: ${catalog.units.length} administrative units.`,
      });
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      set({ error, catalogLoading: false });
    }
  },

  setMode: (mode) => {
    set({ mode, pickingAoi: false });
    if (mode === "point_radius") {
      updatePointRadiusDraft(set, get);
    } else {
      set({ draftAoiOutline: null, aoiViewport: null, boundaryMessage: null, mapPoint: null });
      const { unitIds } = get();
      if (unitIds.length > 0) {
        void triggerBoundaryFetch(unitIds, set, get);
      }
    }
  },

  setLongitude: (longitude) => {
    set({ longitude });
    if (get().mode === "point_radius") {
      updatePointRadiusDraft(set, get);
    }
  },

  setLatitude: (latitude) => {
    set({ latitude });
    if (get().mode === "point_radius") {
      updatePointRadiusDraft(set, get);
    }
  },

  setRadius: (radius) => {
    set({ radius });
    if (get().mode === "point_radius") {
      updatePointRadiusDraft(set, get);
    }
  },

  setUnitIds: (unitIds) => {
    set({ unitIds });
    if (get().mode === "administrative_selection") {
      if (unitIds.length === 0) {
        set({ draftAoiOutline: null, aoiViewport: null, boundaryMessage: null });
      } else {
        void triggerBoundaryFetch(unitIds, set, get);
      }
    }
  },

  toggleCategory: (category, checked) => {
    set((state) => ({
      selectedCategories: checked
        ? [...new Set([...state.selectedCategories, category])]
        : state.selectedCategories.filter((candidate) => candidate !== category),
    }));
  },

  toggleAllCategories: () => {
    set((state) => ({
      selectedCategories:
        state.selectedCategories.length === ALL_RUNTIME_CATEGORIES.length ? [] : [...ALL_RUNTIME_CATEGORIES],
    }));
  },

  setPickingAoi: (pickingAoi) => {
    set({ pickingAoi });
  },

  pickPoint: (point, onActivity) => {
    const lonStr = String(point.longitude);
    const latStr = String(point.latitude);
    const radius = get().radius;
    const radNum = parseCoordinate(radius) || 20000;
    const outline = pointRadiusOutline(point.longitude, point.latitude, radNum);
    const zoom = pointRadiusZoom(radNum);
    set({
      mapPoint: point,
      longitude: lonStr,
      latitude: latStr,
      pickingAoi: false,
      draftAoiOutline: outline,
      aoiViewport: outline ? { geometry: outline, zoom } : null,
      error: null,
    });
    onActivity({
      phase: "validation",
      message: `Selected map point ${point.latitude}, ${point.longitude} for the AOI radius.`,
    });
  },

  applyAoi: async (onActivity, onApplied) => {
    const { mode, longitude, latitude, radius, unitIds, selectedCategories, busy } = get();
    if (busy) return;
    set({ busy: true, error: null, preflight: null, progress: null, result: null });
    try {
      const runtimeRequest = buildRuntimeRequest(mode, { longitude, latitude, radius, unitIds }, selectedCategories);
      onActivity({ phase: "validation", message: "Validating AOI geometry and provider limits before acquisition." });
      const preflightResponse = await fetch("/api/aoi/runtime-requests/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runtimeRequest),
      });
      if (!preflightResponse.ok) throw new Error(await runtimeRequestError(preflightResponse));
      const nextPreflight = (await preflightResponse.json()) as RuntimePreflight;
      set({ preflight: nextPreflight, draftAoiOutline: nextPreflight.aoi.geometry });
      if (nextPreflight.status === "blocked") {
        onActivity({ phase: "error", message: nextPreflight.message });
        return;
      }
      onActivity({ phase: "cache", message: "AOI passed preflight; queued a cache-first provider preparation job." });
      const response = await fetch("/api/aoi/runtime-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(runtimeRequest),
      });
      if (!response.ok) throw new Error(await runtimeRequestError(response));
      const initialJob = (await response.json()) as ProviderRuntimeJob;
      set({ progress: initialJob });

      const res = await pollRuntimeJob(initialJob, (job) => set({ progress: job }), onActivity);
      set({ result: res });
      const failed = res.outcomes.filter((outcome) => outcome.status === "failed");
      onActivity({
        phase: res.request_result === "cache" ? "cache" : "publication",
        message: failed.length
          ? `Published a partial AOI snapshot. ${failed.map((outcome) => `${outcome.domain}: ${outcome.detail}`).join(" ")}`
          : res.request_result === "cache"
            ? "Reused the verified local AOI snapshot."
            : "Published a new bounded AOI snapshot.",
      });
      onApplied(res);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const output = message.startsWith("No new AOI snapshot was published;")
        ? message
        : `AOI preparation could not be completed. No new snapshot was published; the existing map was left unchanged. ${message}`;
      set({ error: output });
      onActivity({ phase: "error", message: output });
    } finally {
      set({ busy: false });
    }
  },
}));

async function triggerBoundaryFetch(
  unitIds: string[],
  set: (partial: Partial<AoiState> | ((state: AoiState) => Partial<AoiState>)) => void,
  get: () => AoiState,
) {
  if (boundaryDebounceTimer) clearTimeout(boundaryDebounceTimer);
  if (boundaryAbortController) boundaryAbortController.abort();

  const controller = new AbortController();
  boundaryAbortController = controller;

  boundaryDebounceTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/aoi/catalog/boundary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit_ids: unitIds }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await providerResponseMessage(response, "Selected PRG boundary could not be resolved."));
      const boundary = (await response.json()) as AdministrativeBoundary;
      if (!controller.signal.aborted) {
        const catalogUnits = get().catalog?.units ?? [];
        set({
          draftAoiOutline: boundary.aoi.geometry,
          aoiViewport: { geometry: boundary.aoi.geometry, zoom: administrativeSelectionZoom(unitIds, catalogUnits) },
          boundaryMessage: boundary.message,
        });
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        set({ error: reason instanceof Error ? reason.message : String(reason) });
      }
    }
  }, 250);
}

async function pollRuntimeJob(
  initial: ProviderRuntimeJob,
  onProgress: (job: ProviderRuntimeJob) => void,
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
): Promise<ProviderRuntimeResponse> {
  let job = initial;
  let announced = "";
  while (job.state !== "succeeded" && job.state !== "failed") {
    await new Promise((resolve) => setTimeout(resolve, 650));
    const response = await fetch(`/api/aoi/runtime-jobs/${job.job_id}`);
    if (!response.ok) throw new Error(await runtimeRequestError(response));
    job = (await response.json()) as ProviderRuntimeJob;
    onProgress(job);
    const key = `${job.completed_domains}:${job.active_domain ?? ""}`;
    if (job.active_domain && key !== announced) {
      announced = key;
      onActivity({
        phase: "acquisition",
        message: `Preparing ${job.active_domain}: ${job.completed_domains}/${job.total_domains} domains complete.`,
      });
    }
  }
  if (job.state === "failed" && !job.result) {
    throw new Error(job.error ?? "AOI preparation job failed unexpectedly.");
  }
  if (!job.result) {
    throw new Error("AOI preparation finished without a result payload.");
  }
  return job.result;
}
