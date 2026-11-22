import type { Geometry } from "geojson";

import {
  administrativeSelectionZoom,
  buildRuntimeRequest,
  isPointRadiusValid,
  MAX_CUSTOM_RADIUS_M,
  MAX_DEMO_RADIUS_M,
  parseCoordinate,
  pointRadiusOutline,
  pointRadiusZoom,
  providerResponseMessage,
  runtimeRequestError,
} from "../aoiSettings";
import type { ActivityEvent } from "../components/ActivityWindow";
import type {
  AdministrativeBoundary,
  AdministrativeCatalog,
  AdministrativeUnit,
  ProviderRuntimeJob,
  ProviderRuntimeResponse,
  RuntimeCapability,
  RuntimeCategory,
  RuntimePreflight,
} from "../types/api";

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
  runtimeCapability: RuntimeCapability | null;
  runtimeCapabilityLoading: boolean;
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

  loadCatalog: (
    onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
  ) => Promise<void>;
  loadRuntimeCapability: () => Promise<void>;
  setMode: (mode: "point_radius" | "administrative_selection") => void;
  setLongitude: (longitude: string) => void;
  setLatitude: (latitude: string) => void;
  setRadius: (radius: string) => void;
  setUnitIds: (unitIds: string[]) => void;
  toggleCategory: (category: RuntimeCategory, checked: boolean) => void;
  toggleAllCategories: () => void;
  setPickingAoi: (picking: boolean) => void;
  pickPoint: (
    point: { longitude: number; latitude: number },
    onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
  ) => void;
  applyAoi: (
    onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
    onApplied: (result: ProviderRuntimeResponse) => void,
  ) => Promise<void>;
  applyDemoAoi: (
    onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
    onApplied: (result: ProviderRuntimeResponse) => void,
  ) => Promise<void>;
};

export type StoreSet = (
  state: Partial<AoiState> | ((state: AoiState) => Partial<AoiState>),
) => void;
export type StoreGet = () => AoiState;

let boundaryAbortController: AbortController | null = null;
let boundaryDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function updatePointRadiusDraft(set: StoreSet, get: StoreGet): void {
  const { longitude, latitude, radius } = get();
  if (!radius.trim()) {
    set({ draftAoiOutline: null, aoiViewport: null, mapPoint: null });
    return;
  }
  const rad = parseCoordinate(radius);
  const maxRadius =
    get().runtimeCapability?.mode === "demo_fixed_aoi" ? MAX_DEMO_RADIUS_M : MAX_CUSTOM_RADIUS_M;
  if (Number.isFinite(rad) && rad > maxRadius) {
    set({
      draftAoiOutline: null,
      aoiViewport: null,
      error: `Radius exceeds maximum allowed limit of ${maxRadius / 1000} km (${maxRadius} m).`,
    });
    return;
  }
  if (isPointRadiusValid(longitude, latitude, radius, maxRadius)) {
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

export function triggerBoundaryFetch(unitIds: string[], set: StoreSet, get: StoreGet): void {
  if (boundaryDebounceTimer) {
    clearTimeout(boundaryDebounceTimer);
  }
  if (boundaryAbortController) {
    boundaryAbortController.abort();
  }

  const controller = new AbortController();
  boundaryAbortController = controller;

  boundaryDebounceTimer = setTimeout(() => {
    void (async () => {
      try {
        const response = await fetch("/api/aoi/catalog/boundary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ unit_ids: unitIds }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            await providerResponseMessage(response, "Selected PRG boundary could not be resolved."),
          );
        }
        const boundary = (await response.json()) as AdministrativeBoundary;
        if (!controller.signal.aborted) {
          const catalogUnits = get().catalog?.units ?? [];
          set({
            draftAoiOutline: boundary.aoi.geometry,
            aoiViewport: {
              geometry: boundary.aoi.geometry,
              zoom: administrativeSelectionZoom(unitIds, catalogUnits),
            },
            boundaryMessage: boundary.message,
          });
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.warn("Could not fetch administrative boundary preview:", err);
      }
    })();
  }, 350);
}

export async function pollRuntimeJob(
  initial: ProviderRuntimeJob,
  onProgress: (job: ProviderRuntimeJob) => void,
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void,
  onPublished?: (result: ProviderRuntimeResponse) => void,
): Promise<ProviderRuntimeResponse> {
  let job = initial;
  let publishedAt = "";
  const publishPartial = () => {
    if (job.partial_result && job.partial_result.cached_at !== publishedAt) {
      publishedAt = job.partial_result.cached_at;
      onPublished?.(job.partial_result);
    }
  };
  publishPartial();
  let announced = "";
  const deadline = Date.now() + 9 * 60 * 1000;
  let delayMs = 1_000;
  while (job.state !== "succeeded" && job.state !== "failed") {
    if (Date.now() >= deadline) {
      throw new Error(
        "AOI status monitoring exceeded nine minutes. The server job may still be running; check its status before retrying.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 1.5, 5_000);
    const response = await fetch(`/api/aoi/runtime-jobs/${job.job_id}`, {
      signal: AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now()))),
    });
    if (!response.ok) {
      throw new Error(await runtimeRequestError(response));
    }
    job = (await response.json()) as ProviderRuntimeJob;
    onProgress(job);
    publishPartial();
    const key = `${job.completed_domains}:${job.active_domain ?? ""}`;
    if (job.active_domain && key !== announced) {
      announced = key;
      onActivity({
        phase: "acquisition",
        message: `Preparing ${job.active_domain}: ${job.completed_domains}/${job.total_domains} domains complete.`,
      });
    }
  }
  if (job.state === "failed") {
    throw new Error(job.error ?? "AOI preparation job failed unexpectedly.");
  }
  if (!job.result) {
    throw new Error("AOI preparation finished without a result payload.");
  }
  return job.result;
}

export async function executeRuntimePreparation({
  set,
  get,
  onActivity,
  onApplied,
  catalogUnits,
  maxRadiusM,
  validationMessage,
  queuedMessage,
  jobEndpoint,
  partialPrefix,
  cachedMessage,
  refreshedMessage,
  stoppedPrefix,
  failedPrefix,
  preserveNoSnapshotPrefix,
}: {
  set: StoreSet;
  get: StoreGet;
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  onApplied: (result: ProviderRuntimeResponse) => void;
  catalogUnits: AdministrativeUnit[] | undefined;
  maxRadiusM: number;
  validationMessage: string;
  queuedMessage?: string;
  jobEndpoint: string;
  partialPrefix: string;
  cachedMessage: string;
  refreshedMessage: string;
  stoppedPrefix: string;
  failedPrefix: string;
  preserveNoSnapshotPrefix: boolean;
}): Promise<void> {
  const { mode, longitude, latitude, radius, unitIds, selectedCategories } = get();
  set({ busy: true, error: null, preflight: null, progress: null, result: null });
  try {
    onActivity({ phase: "validation", message: validationMessage });
    const runtimeRequest = buildRuntimeRequest(
      mode,
      { longitude, latitude, radius, unitIds },
      selectedCategories,
      catalogUnits,
      maxRadiusM,
    );
    const preflightResponse = await fetch("/api/aoi/runtime-requests/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runtimeRequest),
    });
    if (!preflightResponse.ok) {
      throw new Error(await runtimeRequestError(preflightResponse));
    }
    const nextPreflight = (await preflightResponse.json()) as RuntimePreflight;
    set({ preflight: nextPreflight, draftAoiOutline: nextPreflight.aoi.geometry });
    if (nextPreflight.status === "blocked") {
      onActivity({ phase: "error", message: nextPreflight.message });
      return;
    }
    if (queuedMessage) {
      onActivity({ phase: "cache", message: queuedMessage });
    }
    const response = await fetch(jobEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runtimeRequest),
    });
    if (!response.ok) {
      throw new Error(await runtimeRequestError(response));
    }
    const initialJob = (await response.json()) as ProviderRuntimeJob;
    set({ progress: initialJob });
    const res = await pollRuntimeJob(
      initialJob,
      (job) => set({ progress: job }),
      onActivity,
      (partial) => {
        set({ result: partial });
        onApplied(partial);
      },
    );
    set({ result: res });
    const failed = res.outcomes.filter((outcome) => outcome.status === "failed");
    onActivity({
      phase: res.request_result === "cache" ? "cache" : "publication",
      message: failed.length
        ? `${partialPrefix} ${failed.map((outcome) => `${outcome.domain}: ${outcome.detail}`).join(" ")}`
        : res.request_result === "cache"
          ? cachedMessage
          : refreshedMessage,
    });
    onApplied(res);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    const output = get().result
      ? `${stoppedPrefix} ${message}`
      : preserveNoSnapshotPrefix && message.startsWith("No new AOI snapshot was published;")
        ? message
        : `${failedPrefix} ${message}`;
    set({ error: output });
    onActivity({ phase: "error", message: output });
  } finally {
    set({ busy: false });
  }
}
