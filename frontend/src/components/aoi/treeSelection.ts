import { administrativeSelectionRoots } from "../../aoiSettings";
import type { AdministrativeUnit } from "../../types/api";

export type AdministrativeBranch = {
  unit: AdministrativeUnit;
  counties: Array<{ unit: AdministrativeUnit; gminas: AdministrativeUnit[] }>;
};

export function buildAdministrativeBranches(unitsByKind: {
  voivodeship: AdministrativeUnit[];
  county: AdministrativeUnit[];
  gmina: AdministrativeUnit[];
}): AdministrativeBranch[] {
  const gminasByCounty = new Map<string, AdministrativeUnit[]>();
  unitsByKind.gmina.forEach((gmina) =>
    gminasByCounty.set(gmina.parent_id ?? "", [
      ...(gminasByCounty.get(gmina.parent_id ?? "") ?? []),
      gmina,
    ]),
  );
  const countiesByVoivodeship = new Map<string, AdministrativeUnit[]>();
  unitsByKind.county.forEach((county) =>
    countiesByVoivodeship.set(county.parent_id ?? "", [
      ...(countiesByVoivodeship.get(county.parent_id ?? "") ?? []),
      county,
    ]),
  );
  return [...unitsByKind.voivodeship]
    .sort((left, right) => left.name.localeCompare(right.name, "pl"))
    .map((unit) => ({
      unit,
      counties: (countiesByVoivodeship.get(unit.id) ?? [])
        .sort((left, right) => left.name.localeCompare(right.name, "pl"))
        .map((county) => ({
          unit: county,
          gminas: [...(gminasByCounty.get(county.id) ?? [])].sort((left, right) =>
            left.name.localeCompare(right.name, "pl"),
          ),
        })),
    }));
}

export function nextTreeSelection(
  current: string[],
  allUnits: AdministrativeUnit[],
  branch: AdministrativeBranch,
  county: { unit: AdministrativeUnit; gminas: AdministrativeUnit[] } | null,
  gmina: AdministrativeUnit | null,
  checked: boolean,
): string[] {
  const byId = new Map(allUnits.map((u) => [u.id, u]));
  const countyLeaves = county?.gminas.map((item) => item.id) ?? [];

  const currentRoots = administrativeSelectionRoots(current, allUnits);
  const isDifferentRoot = currentRoots.length > 0 && !currentRoots.includes(branch.unit.id);
  const base = isDifferentRoot ? [] : current;

  const involvedCounties = new Set<string>();
  for (const id of base) {
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

  if (checked) {
    if (!county) {
      return current; // Voivodeship selection blocked
    }
    if (!gmina) {
      if (!involvedCounties.has(county.unit.id) && involvedCounties.size >= 3) {
        return current;
      }
      const filtered = base.filter((id) => id !== county.unit.id && !countyLeaves.includes(id));
      return normalizedSelection([...filtered, county.unit.id]);
    }
    if (!involvedCounties.has(county.unit.id) && involvedCounties.size >= 3) {
      return current;
    }
    if (base.includes(county.unit.id)) {
      return base;
    }
    return normalizedSelection([...base, gmina.id]);
  }

  // Unchecked
  if (!county) {
    return current;
  }
  if (!gmina) {
    return normalizedSelection(
      current.filter((id) => id !== county.unit.id && !countyLeaves.includes(id)),
    );
  }
  if (current.includes(county.unit.id)) {
    return normalizedSelection(
      current
        .filter((id) => id !== county.unit.id)
        .concat(countyLeaves.filter((id) => id !== gmina.id)),
    );
  }
  return normalizedSelection(current.filter((id) => id !== gmina.id));
}

export function normalizedSelection(unitIds: string[]): string[] {
  return [...new Set(unitIds)].sort();
}
