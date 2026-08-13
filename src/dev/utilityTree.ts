import { getProgram } from "../library/load.js";
import {
  ENERGY_TERRITORY_BILL_IDS,
  listTerritories,
  programLinkForTerritory,
  territoriesForProgram,
  territoryLabel,
  type TerritoryId,
  type TerritoryKind,
} from "../library/utilityTerritory.js";

export interface UtilityTreeColumn {
  id: string;
  label: string;
  programId: string | null;
}

export interface UtilityTreeCell {
  available: boolean;
  applyUrl: string | null;
  label: string;
}

export interface UtilityTreeRow {
  id: string;
  label: string;
  kind: TerritoryKind | "other" | "telecom";
  cells: Record<string, UtilityTreeCell>;
}

export interface UtilityTree {
  columns: UtilityTreeColumn[];
  rows: UtilityTreeRow[];
}

const PROGRAM_COLUMNS: UtilityTreeColumn[] = [
  { id: "care", label: "CARE", programId: "care" },
  { id: "fera", label: "FERA", programId: "fera" },
  { id: "esa", label: "ESA", programId: "esa" },
  { id: "amp", label: "AMP", programId: "amp" },
  { id: "medical_baseline", label: "Medical Baseline", programId: "medical_baseline" },
  { id: "liheap", label: "LIHEAP", programId: "liheap" },
  { id: "lifeline", label: "LifeLine", programId: "lifeline" },
  { id: "ladwp_ez_save", label: "EZ-SAVE", programId: "ladwp_ez_save" },
  { id: "smud_eapr", label: "EAPR", programId: "smud_eapr" },
  { id: "pge_only", label: "PG&E-only rebates", programId: null },
];

const PGE_ONLY_NOTE = "SmartFlex, EV rebates, generator/battery";

function cell(
  available: boolean,
  applyUrl: string | null = null,
  label = "",
): UtilityTreeCell {
  return { available, applyUrl, label };
}

function liheapUrl(): string {
  return getProgram("liheap")?.applyUrl ?? "https://www.csd.ca.gov/Pages/LIHEAP.aspx";
}

function lifelineUrl(): string {
  return getProgram("lifeline")?.applyUrl ?? "https://www.californialifeline.com/";
}

function territoryRow(
  id: TerritoryId,
  label: string,
  kind: TerritoryKind,
): UtilityTreeRow {
  const cells: Record<string, UtilityTreeCell> = {};
  for (const col of PROGRAM_COLUMNS) {
    if (col.id === "liheap") {
      cells[col.id] = cell(true, liheapUrl(), "County LIHEAP");
      continue;
    }
    if (col.id === "lifeline") {
      cells[col.id] = cell(false);
      continue;
    }
    if (col.id === "pge_only") {
      cells[col.id] =
        id === "pge"
          ? cell(true, getProgram("smartflex_rewards")?.applyUrl ?? null, PGE_ONLY_NOTE)
          : cell(false);
      continue;
    }
    if (!col.programId) {
      cells[col.id] = cell(false);
      continue;
    }
    const link = programLinkForTerritory(col.programId, id);
    if (link) {
      cells[col.id] = cell(true, link.applyUrl, territoryLabel(id));
    } else {
      cells[col.id] = cell(false);
    }
  }
  return { id, label, kind, cells };
}

function otherEnergyRow(): UtilityTreeRow {
  const cells: Record<string, UtilityTreeCell> = {};
  for (const col of PROGRAM_COLUMNS) {
    if (col.id === "liheap") {
      cells[col.id] = cell(true, liheapUrl(), "County LIHEAP");
    } else {
      cells[col.id] = cell(false);
    }
  }
  return {
    id: "other_heating",
    label: "Other CA utility / heating fuel",
    kind: "other",
    cells,
  };
}

function telecomRow(): UtilityTreeRow {
  const cells: Record<string, UtilityTreeCell> = {};
  for (const col of PROGRAM_COLUMNS) {
    if (col.id === "lifeline") {
      cells[col.id] = cell(true, lifelineUrl(), "Any carrier");
    } else {
      cells[col.id] = cell(false);
    }
  }
  return {
    id: "phone_internet",
    label: "Phone or internet bill",
    kind: "telecom",
    cells,
  };
}

/** Static matrix: utility bill selection × program family with apply URLs. */
export function buildUtilityTree(): UtilityTree {
  const territories = listTerritories();
  const rows: UtilityTreeRow[] = [
    ...ENERGY_TERRITORY_BILL_IDS.map((id) => {
      const meta = territories.find((t) => t.id === id)!;
      return territoryRow(id, meta.label, meta.kind);
    }),
    otherEnergyRow(),
    telecomRow(),
  ];
  return { columns: PROGRAM_COLUMNS, rows };
}

/** Coverage helper for docs / tests. */
export function utilityCoverageSummary(): string[] {
  const lines: string[] = [];
  for (const programId of [
    "care",
    "fera",
    "esa",
    "amp",
    "medical_baseline",
    "ladwp_ez_save",
    "smud_eapr",
  ]) {
    const ids = territoriesForProgram(programId);
    lines.push(
      `${programId}: ${ids.map(territoryLabel).join(", ") || "(none)"}`,
    );
  }
  return lines;
}
