import { create } from "zustand";

import {
  MAX_CUSTOM_RADIUS_M,
  MAX_DEMO_RADIUS_M,
  parseCoordinate,
  pointRadiusOutline,
  pointRadiusZoom,
  providerResponseMessage,
} from "../aoiSettings";
import type { AdministrativeCatalog, RuntimeCapability } from "../types/api";
import {
  ALL_RUNTIME_CATEGORIES,
  type AoiState,
  executeRuntimePreparation,
  pollRuntimeJob,
  triggerBoundaryFetch,
  updatePointRadiusDraft,
} from "./aoiStoreHelpers";

export { ALL_RUNTIME_CATEGORIES, type AoiState, pollRuntimeJob };

export const useAoiStore = create<AoiState>((set, get) => ({
  catalog: null,
  catalogLoading: false,
  runtimeCapability: null,
  runtimeCapabilityLoading: false,
  mode: "point_radius",
  longitude: "",
  latitude: "",
  radius: "20000",
  unitIds: [],
  selectedCategories: [...ALL_RUNTIME_CATEGORIES],
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
    if (get().catalog || get().catalogLoading) {
      return;
    }
    set({ catalogLoading: true });
    onActivity({
      phase: "validation",
      message: "Reading the local, versioned PRG administrative index.",
    });
    try {
      const response = await fetch("/api/aoi/catalog");
      if (!response.ok) {
        throw new Error(
          await providerResponseMessage(
            response,
            `Administrative catalogue could not be read (HTTP ${response.status}).`,
          ),
        );
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

  loadRuntimeCapability: async () => {
    if (get().runtimeCapability || get().runtimeCapabilityLoading) {
      return;
    }
    set({ runtimeCapabilityLoading: true });
    try {
      const response = await fetch("/api/aoi/runtime-capabilities");
      if (!response.ok) {
        throw new Error(
          await providerResponseMessage(
            response,
            `Runtime capabilities could not be read (HTTP ${response.status}).`,
          ),
        );
      }
      set({
        runtimeCapability: (await response.json()) as RuntimeCapability,
        runtimeCapabilityLoading: false,
      });
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      set({ error, runtimeCapabilityLoading: false });
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
        triggerBoundaryFetch(unitIds, set, get);
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
        triggerBoundaryFetch(unitIds, set, get);
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
        state.selectedCategories.length === ALL_RUNTIME_CATEGORIES.length
          ? []
          : [...ALL_RUNTIME_CATEGORIES],
    }));
  },

  setPickingAoi: (pickingAoi) => {
    set({ pickingAoi });
  },

  pickPoint: (point, onActivity) => {
    const lonStr = String(point.longitude);
    const latStr = String(point.latitude);
    const radius = get().radius;
    const defaultRadius =
      get().runtimeCapability?.mode === "demo_fixed_aoi" ? MAX_DEMO_RADIUS_M : MAX_CUSTOM_RADIUS_M;
    const parsedRadius = parseCoordinate(radius);
    const radNum =
      Number.isFinite(parsedRadius) && parsedRadius > 0 && parsedRadius <= defaultRadius
        ? parsedRadius
        : defaultRadius;
    set({ radius: String(radNum) });
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
    const { busy, runtimeCapability } = get();
    if (busy) {
      return;
    }
    if (runtimeCapability?.mode === "demo_fixed_aoi") {
      await get().applyDemoAoi(onActivity, onApplied);
      return;
    }
    await executeRuntimePreparation({
      set,
      get,
      onActivity,
      onApplied,
      catalogUnits: undefined,
      maxRadiusM: MAX_CUSTOM_RADIUS_M,
      validationMessage: "Validating AOI geometry and provider limits before acquisition.",
      queuedMessage: "AOI passed preflight; queued a cache-first provider preparation job.",
      jobEndpoint: "/api/aoi/runtime-jobs",
      partialPrefix: "Published a partial AOI snapshot.",
      cachedMessage: "Reused the verified local AOI snapshot.",
      refreshedMessage: "Published a new bounded AOI snapshot.",
      stoppedPrefix: "AOI preparation stopped. Published domains remain available on the map.",
      failedPrefix:
        "AOI preparation could not be completed. No new snapshot was published; the existing map was left unchanged.",
      preserveNoSnapshotPrefix: true,
    });
  },

  applyDemoAoi: async (onActivity, onApplied) => {
    const { busy, runtimeCapability, selectedCategories, catalog } = get();
    const template = runtimeCapability?.demo_template;
    if (busy || !template) {
      return;
    }
    await executeRuntimePreparation({
      set,
      get,
      onActivity,
      onApplied,
      catalogUnits: catalog?.units,
      maxRadiusM: template.max_radius_m,
      validationMessage: `Validating the Poland-bounded demo AOI before preparing ${selectedCategories.length} selected domain${selectedCategories.length === 1 ? "" : "s"}.`,
      jobEndpoint: `/api/aoi/demo-acquisitions/${template.id}`,
      partialPrefix: "Published a partial demo snapshot.",
      cachedMessage: "Reused the verified demo AOI snapshot.",
      refreshedMessage: "Published a refreshed demo AOI snapshot.",
      stoppedPrefix: "Demo AOI preparation stopped. Published domains remain available on the map.",
      failedPrefix:
        "Demo AOI preparation could not be completed. No new snapshot was published; the existing map was left unchanged.",
      preserveNoSnapshotPrefix: false,
    });
  },
}));
