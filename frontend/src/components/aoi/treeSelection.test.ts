import { describe, expect, it } from "vitest";

import type { AdministrativeUnit } from "../../types/api";
import { buildAdministrativeBranches, nextTreeSelection } from "./treeSelection";

const UNITS: AdministrativeUnit[] = [
  { id: "v:24", kind: "voivodeship", name: "Śląskie", prg_id: "24", parent_id: null },
  { id: "c:2412", kind: "county", name: "Powiat rybnicki", prg_id: "2412", parent_id: "v:24" },
  { id: "c:2473", kind: "county", name: "Rybnik", prg_id: "2473", parent_id: "v:24" },
  {
    id: "g:241201",
    kind: "gmina",
    name: "Czerwionka-Leszczyny",
    prg_id: "241201",
    parent_id: "c:2412",
  },
  { id: "g:241202", kind: "gmina", name: "Gaszowice", prg_id: "241202", parent_id: "c:2412" },
];

describe("administrativeTree", () => {
  it("groups counties and gminas alphabetically under their voivodeship", () => {
    const branches = buildAdministrativeBranches({
      voivodeship: [UNITS[0]],
      county: [UNITS[2], UNITS[1]],
      gmina: [UNITS[4], UNITS[3]],
    });
    expect(branches).toHaveLength(1);
    expect(branches[0].counties.map((c) => c.unit.id)).toEqual(["c:2412", "c:2473"]);
    expect(branches[0].counties[0].gminas.map((g) => g.id)).toEqual(["g:241201", "g:241202"]);
  });

  it("expands a whole county into remaining leaves when unchecking a single gmina", () => {
    const branches = buildAdministrativeBranches({
      voivodeship: [UNITS[0]],
      county: [UNITS[1], UNITS[2]],
      gmina: [UNITS[3], UNITS[4]],
    });
    const next = nextTreeSelection(
      ["c:2412"],
      UNITS,
      branches[0],
      branches[0].counties[0],
      UNITS[3],
      false,
    );
    expect(next).toEqual(["g:241202"]);
  });
});
