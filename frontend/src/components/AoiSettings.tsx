import { useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_CUSTOM_RADIUS_M,
  MAX_DEMO_RADIUS_M,
  parseCoordinate,
  validateAdministrativeUnitSelection,
  validatePointRadiusInput,
} from "../aoiSettings";
import { ALL_RUNTIME_CATEGORIES, useAoiStore } from "../stores/aoiStore";
import type { ProviderRuntimeResponse } from "../types/api";
import type { ActivityEvent } from "./ActivityWindow";
import { AdministrativeTree } from "./aoi/AdministrativeTree";
import { RuntimeOutcomeSummary, RuntimeProgress } from "./aoi/RuntimeOutcomeSummary";
import { RuntimeAcquisitionEvidencePanel } from "./RuntimeAcquisitionEvidencePanel";

export { RuntimeOutcomeSummary };

function useTimedBubble<T>(durationMs = 3500): [T | null, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (next: T | null) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setValue(next);
    if (next !== null) {
      timerRef.current = setTimeout(() => setValue(null), durationMs);
    }
  };

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return [value, show];
}

type Props = {
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  onApplied: (result: ProviderRuntimeResponse) => void;
  onResetToDefault?: () => void;
  isDefaultAoiActive?: boolean;
  isDefaultAoiHidden?: boolean;
  onToggleDefaultAoiHidden?: () => void;
};

export function AoiSettings({
  onActivity,
  onApplied,
  onResetToDefault,
  isDefaultAoiActive = true,
  isDefaultAoiHidden = false,
  onToggleDefaultAoiHidden,
}: Props) {
  const catalog = useAoiStore((s) => s.catalog);
  const loadCatalog = useAoiStore((s) => s.loadCatalog);
  const runtimeCapability = useAoiStore((s) => s.runtimeCapability);
  const loadRuntimeCapability = useAoiStore((s) => s.loadRuntimeCapability);
  const mode = useAoiStore((s) => s.mode);
  const setMode = useAoiStore((s) => s.setMode);
  const longitude = useAoiStore((s) => s.longitude);
  const setLongitude = useAoiStore((s) => s.setLongitude);
  const latitude = useAoiStore((s) => s.latitude);
  const setLatitude = useAoiStore((s) => s.setLatitude);
  const radius = useAoiStore((s) => s.radius);
  const setRadius = useAoiStore((s) => s.setRadius);
  const unitIds = useAoiStore((s) => s.unitIds);
  const setUnitIds = useAoiStore((s) => s.setUnitIds);
  const selectedCategories = useAoiStore((s) => s.selectedCategories);
  const toggleCategory = useAoiStore((s) => s.toggleCategory);
  const toggleAllCategories = useAoiStore((s) => s.toggleAllCategories);
  const setPickingAoi = useAoiStore((s) => s.setPickingAoi);
  const busy = useAoiStore((s) => s.busy);
  const error = useAoiStore((s) => s.error);
  const preflight = useAoiStore((s) => s.preflight);
  const boundaryMessage = useAoiStore((s) => s.boundaryMessage);
  const progress = useAoiStore((s) => s.progress);
  const result = useAoiStore((s) => s.result);
  const applyAoi = useAoiStore((s) => s.applyAoi);

  const [latBubble, setLatBubble] = useTimedBubble<string>();
  const [lonBubble, setLonBubble] = useTimedBubble<string>();
  const [radiusBubble, setRadiusBubble] = useTimedBubble<string>();
  const [lastClickedUnitId, setLastClickedUnitId] = useState<string | null>(null);
  const [treeBubble, setTreeBubble] = useTimedBubble<{ unitId: string; message: string }>();
  const [prepareBubble, setPrepareBubble] = useTimedBubble<string>();

  const showTreeError = (unitId: string, message: string) => setTreeBubble({ unitId, message });

  useEffect(() => {
    void loadRuntimeCapability();
  }, [loadRuntimeCapability]);

  useEffect(() => {
    if (runtimeCapability?.supports_custom_aoi) {
      void loadCatalog(onActivity);
    }
  }, [loadCatalog, onActivity, runtimeCapability?.supports_custom_aoi]);

  useEffect(() => {
    if (!error && (!preflight || preflight.status !== "blocked")) {
      return;
    }
    const timer = setTimeout(() => {
      useAoiStore.setState({ error: null });
    }, 3500);
    return () => clearTimeout(timer);
  }, [error, preflight]);

  const activeStoreError = error || (preflight?.status === "blocked" ? preflight.message : null);

  const effectiveTreeBubble =
    treeBubble ||
    (mode === "administrative_selection" && lastClickedUnitId && activeStoreError
      ? { unitId: lastClickedUnitId, message: activeStoreError }
      : null);

  const effectivePrepareBubble =
    prepareBubble ||
    (!lastClickedUnitId || mode !== "administrative_selection" ? activeStoreError : null);

  const unitsByKind = useMemo(() => {
    const list = catalog?.units ?? [];
    return {
      voivodeship: list.filter((u) => u.kind === "voivodeship"),
      county: list.filter((u) => u.kind === "county"),
      gmina: list.filter((u) => u.kind === "gmina"),
    };
  }, [catalog]);

  const allUnits = useMemo(() => catalog?.units ?? [], [catalog]);
  const demoMode = runtimeCapability?.mode === "demo_fixed_aoi";
  const maxRadiusM = demoMode ? MAX_DEMO_RADIUS_M : MAX_CUSTOM_RADIUS_M;
  useEffect(() => {
    const currentRadius = parseCoordinate(radius);
    if (Number.isFinite(currentRadius) && currentRadius > maxRadiusM) {
      setRadius(String(maxRadiusM));
    }
  }, [maxRadiusM, radius, setRadius]);
  const validation = useMemo(() => {
    if (mode === "administrative_selection") {
      return validateAdministrativeUnitSelection(unitIds, allUnits, demoMode ? 1 : 3);
    }
    return validatePointRadiusInput(longitude, latitude, radius, maxRadiusM);
  }, [mode, unitIds, allUnits, longitude, latitude, radius, maxRadiusM, demoMode]);

  const parsedLat = parseCoordinate(latitude);
  const isLatitudeInvalid =
    latitude.trim().length > 0 &&
    (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90);

  const onLatitudeChange = (val: string) => {
    setLatitude(val);
    const parsed = parseCoordinate(val);
    if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed < -90 || parsed > 90)) {
      setLatBubble("Enter a valid latitude between -90 and 90 (e.g. 50.102).");
    } else {
      setLatBubble(null);
    }
  };

  const parsedLon = parseCoordinate(longitude);
  const isLongitudeInvalid =
    longitude.trim().length > 0 &&
    (!Number.isFinite(parsedLon) || parsedLon < -180 || parsedLon > 180);

  const onLongitudeChange = (val: string) => {
    setLongitude(val);
    const parsed = parseCoordinate(val);
    if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed < -180 || parsed > 180)) {
      setLonBubble("Enter a valid longitude between -180 and 180 (e.g. 18.546).");
    } else {
      setLonBubble(null);
    }
  };

  const parsedRadius = parseCoordinate(radius);
  const isRadiusTooLarge = Number.isFinite(parsedRadius) && parsedRadius > maxRadiusM;
  const isRadiusInvalid =
    radius.trim().length > 0 && (!Number.isFinite(parsedRadius) || parsedRadius <= 0);

  const onRadiusChange = (val: string) => {
    setRadius(val);
    const parsed = parseCoordinate(val);
    if (val.trim().length > 0 && Number.isFinite(parsed) && parsed > maxRadiusM) {
      setRadiusBubble(`Radius exceeds maximum allowed limit of ${maxRadiusM / 1000} km.`);
    } else if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed <= 0)) {
      setRadiusBubble("Enter a valid positive radius in meters.");
    } else {
      setRadiusBubble(null);
    }
  };

  const selectedUnitCount = unitIds.length;
  const failedDomainCount = result
    ? result.outcomes.filter((outcome) => outcome.status === "failed").length
    : 0;
  const canPrepare = validation.valid;

  const handleApply = async () => {
    if (!validation.valid && validation.error) {
      if (mode === "administrative_selection" && lastClickedUnitId) {
        showTreeError(lastClickedUnitId, validation.error);
      } else {
        setPrepareBubble(validation.error);
      }
      return;
    }
    await applyAoi(onActivity, onApplied);
  };

  if (runtimeCapability?.mode === "disabled") {
    return (
      <section
        className="drawerContent drawerSection aoiSettings"
        aria-label="AOI & Profile Configuration"
      >
        <div className="sectionHeading">
          <h2>AOI & cache</h2>
          <span>read-only</span>
        </div>
        <div className="runtimeModeNotice">
          <h3>Custom acquisition is unavailable</h3>
          <p>
            This deployment serves verified prepared snapshots only. Start the local bounded runtime
            to prepare a new AOI.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="drawerContent drawerSection aoiSettings"
      aria-label="AOI & Profile Configuration"
    >
      <div className="sectionHeading">
        <h2>AOI & cache</h2>
        <span>{demoMode ? "public demo" : "Poland / PRG"}</span>
      </div>
      <div className="defaultAoiCard">
        <div className="defaultAoiInfo">
          <strong>Default Snapshot: Rybnik (35 km)</strong>
          <p className="muted">All 11 infrastructure domains pre-generated and cached offline.</p>
        </div>
        <div className="defaultAoiActions">
          <button
            type="button"
            disabled={busy || (isDefaultAoiActive && !isDefaultAoiHidden)}
            className="secondaryButton"
            onClick={() => {
              if (isDefaultAoiHidden && onToggleDefaultAoiHidden) {
                onToggleDefaultAoiHidden();
              }
              onResetToDefault?.();
            }}
          >
            {isDefaultAoiActive && !isDefaultAoiHidden ? "Default active" : "Load default"}
          </button>
          <button
            type="button"
            disabled={busy || !isDefaultAoiActive}
            className="secondaryButton"
            onClick={onToggleDefaultAoiHidden}
          >
            {isDefaultAoiHidden ? "Show objects" : "Hide objects"}
          </button>
        </div>
      </div>
      <hr className="drawerDivider" />
      {demoMode ? (
        <div className="runtimeModeNotice">
          <h3>Controlled demo acquisition</h3>
          <p>
            Choose a point inside Poland (maximum 10 km radius) or one PRG county. The server
            prepares the selected provider domains and generates a PMTiles presentation so the map
            can switch to the new AOI.
          </p>
        </div>
      ) : null}
      <div className="sectionSubheading">
        <h3>{demoMode ? "Prepare demo AOI" : "Prepare Custom AOI"}</h3>
      </div>
      <div className="aoiRulesBanner">
        <strong>AOI Selection Rules & Limits:</strong>
        <ul>
          <li>
            <strong>Point on map:</strong> maximum radius of <strong>{maxRadiusM / 1000} km</strong>
            .
          </li>
          <li>
            <strong>Voivodeships:</strong> selecting an entire voivodeship is{" "}
            <strong>blocked</strong> (expand to select counties/gminas).
          </li>
          <li>
            <strong>Counties:</strong> up to <strong>{demoMode ? "1" : "3"}</strong>{" "}
            {demoMode ? "county" : "directly adjacent counties"} in the same voivodeship.
          </li>
          <li>
            <strong>Gminas:</strong>{" "}
            {demoMode
              ? "gminas within the selected county only"
              : "any number of gminas across up to 3 adjacent counties"}
            .
          </li>
        </ul>
      </div>
      <div className="modeButtons">
        <button
          type="button"
          disabled={busy}
          className={mode === "point_radius" ? "active" : ""}
          onClick={() => setMode("point_radius")}
        >
          Point + radius (max {maxRadiusM / 1000} km)
        </button>
        <button
          type="button"
          disabled={busy}
          className={mode === "administrative_selection" ? "active" : ""}
          onClick={() => setMode("administrative_selection")}
        >
          Administrative PRG
        </button>
      </div>
      {mode === "point_radius" ? (
        <div className="aoiFields">
          <label className="contextualAnchor">
            {latBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{latBubble}</span>
              </div>
            )}
            <span>Latitude</span>
            <input
              disabled={busy}
              placeholder="e.g. 50.102"
              value={latitude}
              onChange={(event) => onLatitudeChange(event.target.value)}
              inputMode="decimal"
              className={isLatitudeInvalid ? "inputError" : undefined}
            />
          </label>
          <label className="contextualAnchor">
            {lonBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{lonBubble}</span>
              </div>
            )}
            <span>Longitude</span>
            <input
              disabled={busy}
              placeholder="e.g. 18.546"
              value={longitude}
              onChange={(event) => onLongitudeChange(event.target.value)}
              inputMode="decimal"
              className={isLongitudeInvalid ? "inputError" : undefined}
            />
          </label>
          <label className="contextualAnchor radiusField">
            {radiusBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{radiusBubble}</span>
              </div>
            )}
            <span>
              Radius (m) — max {maxRadiusM.toLocaleString()} m ({maxRadiusM / 1000} km)
            </span>
            <input
              disabled={busy}
              placeholder={`e.g. ${maxRadiusM}`}
              value={radius}
              onChange={(event) => onRadiusChange(event.target.value)}
              inputMode="numeric"
              className={isRadiusTooLarge || isRadiusInvalid ? "inputError" : undefined}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className="secondaryButton"
            onClick={() => setPickingAoi(true)}
          >
            Pick point on map
          </button>
        </div>
      ) : (
        <AdministrativeTree
          disabled={busy}
          maxCounties={demoMode ? 1 : 3}
          unitsByKind={unitsByKind}
          unitIds={unitIds}
          treeBubble={effectiveTreeBubble}
          onShowTreeError={showTreeError}
          onSelectUnit={setLastClickedUnitId}
          onChange={setUnitIds}
        />
      )}
      {boundaryMessage && <p className="muted boundaryMessage">{boundaryMessage}</p>}
      <p className="muted">
        Selected units: {selectedUnitCount}.{" "}
        {demoMode
          ? "Select one county or its gminas."
          : "Choose up to 3 adjacent counties or their gminas within one voivodeship."}
      </p>
      <fieldset className="categorySelector">
        <legend>Provider domains</legend>
        <button type="button" disabled={busy} className="textButton" onClick={toggleAllCategories}>
          {selectedCategories.length === ALL_RUNTIME_CATEGORIES.length ? "Clear all" : "Select all"}
        </button>
        <div className="categoryGrid">
          {ALL_RUNTIME_CATEGORIES.map((category) => (
            <label className="layerToggle" key={category}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selectedCategories.includes(category)}
                onChange={(event) => toggleCategory(category, event.target.checked)}
              />
              <span>
                <strong>{category}</strong>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="contextualAnchor prepareAoiAnchor">
        {effectivePrepareBubble && (
          <div className="contextualBubble" role="alert">
            <span>⚠️</span>
            <span>{effectivePrepareBubble}</span>
          </div>
        )}
        <button
          type="button"
          className="prepareAoiButton"
          disabled={busy || selectedCategories.length === 0 || !canPrepare}
          onClick={() => void handleApply()}
        >
          {busy
            ? "Preparing AOI…"
            : failedDomainCount
              ? "Retry failed domains"
              : demoMode
                ? "Prepare selected demo AOI"
                : "Prepare AOI"}
        </button>
      </div>
      {progress && <RuntimeProgress job={progress} />}
      {result && <RuntimeOutcomeSummary result={result} />}
      <RuntimeAcquisitionEvidencePanel
        aoiId={result?.aoi.aoi_id ?? null}
        refreshToken={result?.cached_at ?? null}
      />
    </section>
  );
}
