import { useEffect, useMemo, useState } from "react";

import type { AdministrativeCatalog, ProviderRuntimeResponse, RuntimeCategory } from "../types/api";
import { buildRuntimeRequest } from "../aoiSettings";

const categories: RuntimeCategory[] = ["power", "emergency", "public", "transport", "bridges", "water", "gas", "sewer", "industrial"];

export function AoiSettings({ onApplied }: { onApplied: (result: ProviderRuntimeResponse) => void }) {
  const [catalog, setCatalog] = useState<AdministrativeCatalog | null>(null);
  const [mode, setMode] = useState<"point_radius" | "administrative_selection">("point_radius");
  const [longitude, setLongitude] = useState("18.546285");
  const [latitude, setLatitude] = useState("50.102174");
  const [radius, setRadius] = useState("60000");
  const [unitIds, setUnitIds] = useState<string[]>(["county_rybnik_city", "county_rybnicki"]);
  const [selectedCategories, setSelectedCategories] = useState<RuntimeCategory[]>(["power", "emergency"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unitsByKind = useMemo(() => ({
    voivodeship: catalog?.units.filter((unit) => unit.kind === "voivodeship") ?? [],
    county: catalog?.units.filter((unit) => unit.kind === "county") ?? [],
    gmina: catalog?.units.filter((unit) => unit.kind === "gmina") ?? [],
  }), [catalog]);

  useEffect(() => {
    void fetch("/api/aoi/catalog").then(async (response) => {
      if (!response.ok) throw new Error(`Administrative catalogue: HTTP ${response.status}`);
      return response.json() as Promise<AdministrativeCatalog>;
    }).then(setCatalog).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  function toggleCategory(category: RuntimeCategory, checked: boolean) {
    setSelectedCategories((current) => checked ? [...current, category] : current.filter((candidate) => candidate !== category));
  }

  function toggleUnit(unitId: string, checked: boolean) {
    setUnitIds((current) => checked ? [...new Set([...current, unitId])] : current.filter((candidate) => candidate !== unitId));
  }

  async function apply() {
    setBusy(true); setError(null);
    try {
      const runtimeRequest = buildRuntimeRequest(mode, { longitude, latitude, radius, unitIds }, selectedCategories);
      const response = await fetch("/api/aoi/runtime-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(runtimeRequest) });
      if (!response.ok) throw new Error(`AOI request: HTTP ${response.status}`);
      onApplied(await response.json() as ProviderRuntimeResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  return <section className="inspectorSection aoiSettings">
    <div className="sectionHeading"><h2>AOI settings</h2><span>Poland only</span></div>
    <div className="modeButtons"><button type="button" className={mode === "point_radius" ? "active" : ""} onClick={() => setMode("point_radius")}>Point + radius</button><button type="button" className={mode === "administrative_selection" ? "active" : ""} onClick={() => setMode("administrative_selection")}>Administrative area</button></div>
    {mode === "point_radius" ? <div className="aoiFields"><label>Longitude<input value={longitude} onChange={(event) => setLongitude(event.target.value)} inputMode="decimal" /></label><label>Latitude<input value={latitude} onChange={(event) => setLatitude(event.target.value)} inputMode="decimal" /></label><label>Radius (m)<input value={radius} onChange={(event) => setRadius(event.target.value)} inputMode="numeric" /></label></div> : <div className="aoiUnits">{(["voivodeship", "county", "gmina"] as const).map((kind) => <fieldset key={kind}><legend>{kind}</legend>{unitsByKind[kind].map((unit) => <label className="layerToggle" key={unit.id}><input type="checkbox" checked={unitIds.includes(unit.id)} onChange={(event) => toggleUnit(unit.id, event.target.checked)} /><span><strong>{unit.name}</strong><small>PRG {unit.prg_id}</small></span></label>)}</fieldset>)}</div>}
    <p className="muted">Categories to prepare. A missing fixture remains a visible source gap; it is never rendered as fabricated vector data.</p>
    <div className="categoryGrid">{categories.map((category) => <label className="layerToggle" key={category}><input type="checkbox" checked={selectedCategories.includes(category)} onChange={(event) => toggleCategory(category, event.target.checked)} /><span><strong>{category}</strong></span></label>)}</div>
    <button type="button" disabled={busy || selectedCategories.length === 0 || (mode === "administrative_selection" && unitIds.length === 0)} onClick={() => void apply()}>{busy ? "Preparing…" : "Apply AOI"}</button>
    {error && <p className="inlineError error">{error}</p>}
  </section>;
}
