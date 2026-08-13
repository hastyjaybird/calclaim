import { readFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import type { Program, SessionState } from "./types.js";

export type TerritoryId =
  | "pge"
  | "sdge"
  | "sce"
  | "socalgas"
  | "ladwp"
  | "smud";

export type TerritoryKind = "iou" | "muni";

export interface TerritoryMeta {
  id: TerritoryId;
  label: string;
  kind: TerritoryKind;
}

export interface TerritoryProgramLink {
  applyUrl: string;
  applySteps: string[];
  sources: string[];
}

interface TerritoriesFile {
  version: string;
  territories: Record<string, TerritoryMeta>;
  programLinks: Record<string, Record<string, TerritoryProgramLink>>;
}

/** Bill ids that identify an energy utility territory. */
export const ENERGY_TERRITORY_BILL_IDS: TerritoryId[] = [
  "pge",
  "sdge",
  "sce",
  "socalgas",
  "ladwp",
  "smud",
];

const IOU_CARE_FAMILY = new Set([
  "care",
  "fera",
  "esa",
  "amp",
  "medical_baseline",
]);

const PGE_ONLY_PROGRAMS = new Set([
  "smartflex_rewards",
  "pge_preowned_ev",
  "pge_ev_charging",
  "pge_generator_battery",
]);

const MUNI_PROGRAMS: Record<string, TerritoryId> = {
  ladwp_ez_save: "ladwp",
  smud_eapr: "smud",
};

/** Electric IOUs that offer FERA (gas-only SoCalGas does not). */
const FERA_TERRITORIES = new Set<TerritoryId>(["pge", "sce", "sdge"]);

const IOU_TERRITORIES = new Set<TerritoryId>([
  "pge",
  "sdge",
  "sce",
  "socalgas",
]);

let cache: TerritoriesFile | null = null;

function loadTerritoriesFile(): TerritoriesFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(path.join(LIBRARY_DIR, "utility-territories.json"), "utf8"),
    ) as TerritoriesFile;
  }
  return cache;
}

export function clearUtilityTerritoriesCache(): void {
  cache = null;
}

export function listTerritories(): TerritoryMeta[] {
  const file = loadTerritoriesFile();
  return ENERGY_TERRITORY_BILL_IDS.map((id) => file.territories[id]!).filter(
    Boolean,
  );
}

export function territoryLabel(id: string): string {
  return loadTerritoriesFile().territories[id]?.label ?? id;
}

export function isEnergyTerritoryId(id: string): id is TerritoryId {
  return (ENERGY_TERRITORY_BILL_IDS as string[]).includes(id);
}

/** Ordered energy territories from selected bills (session order preserved). */
export function selectedEnergyTerritories(
  session: SessionState | { billsInMyName?: readonly string[] },
): TerritoryId[] {
  const bills = (session.billsInMyName ?? []).filter((id) => id !== "none");
  return bills.filter((id): id is TerritoryId => isEnergyTerritoryId(id));
}

export function programLinkForTerritory(
  programId: string,
  territoryId: string,
): TerritoryProgramLink | null {
  return loadTerritoriesFile().programLinks[programId]?.[territoryId] ?? null;
}

/** Territories that have an apply link for this shared program. */
export function territoriesForProgram(programId: string): TerritoryId[] {
  const links = loadTerritoriesFile().programLinks[programId];
  if (!links) return [];
  return ENERGY_TERRITORY_BILL_IDS.filter((id) => Boolean(links[id]));
}

/**
 * Whether the program is available for the given bill selections.
 * Used by the bills-in-name gate (LIHEAP / LifeLine handled separately).
 */
export function programAvailableForBills(
  program: Program,
  bills: readonly string[],
): boolean {
  const selected = bills.filter((id) => id !== "none");
  if (selected.length === 0) return false;

  if (program.id === "fera") {
    return selected.some(
      (id) => isEnergyTerritoryId(id) && FERA_TERRITORIES.has(id),
    );
  }

  const muniTerritory = MUNI_PROGRAMS[program.id];
  if (muniTerritory) {
    return selected.includes(muniTerritory);
  }

  if (PGE_ONLY_PROGRAMS.has(program.id)) {
    return selected.includes("pge");
  }

  if (IOU_CARE_FAMILY.has(program.id)) {
    return selected.some(
      (id) => isEnergyTerritoryId(id) && IOU_TERRITORIES.has(id),
    );
  }

  // Unknown account-in-name energy program: require any IOU bill.
  return selected.some(
    (id) => isEnergyTerritoryId(id) && IOU_TERRITORIES.has(id),
  );
}

export interface TerritoryApplyLink {
  id: TerritoryId;
  label: string;
  applyUrl: string;
}

export interface ResolvedProgramPresentation {
  applyUrl: string;
  applySteps: string[];
  sources: string[];
  territoryIds: TerritoryId[];
  territoryLabels: string[];
  /** Per-utility apply URLs for the Application Guide (not offer cards). */
  territoryApplyLinks: TerritoryApplyLink[];
}

/**
 * Resolve apply URL / steps / sources from selected utility bills.
 * Falls back to the library program fields when no territory match.
 */
export function resolveProgramPresentation(
  program: Program,
  session: SessionState | { billsInMyName?: readonly string[] } | null,
): ResolvedProgramPresentation {
  const territories = session ? selectedEnergyTerritories(session) : [];
  const matching = territories.filter((t) =>
    Boolean(programLinkForTerritory(program.id, t)),
  );

  if (matching.length === 0) {
    return {
      applyUrl: program.applyUrl,
      applySteps: [...program.applySteps],
      sources: [...program.sources],
      territoryIds: [],
      territoryLabels: [],
      territoryApplyLinks: [],
    };
  }

  const primary = matching[0]!;
  const primaryLink = programLinkForTerritory(program.id, primary)!;
  const territoryApplyLinks: TerritoryApplyLink[] = matching.map((t) => {
    const link = programLinkForTerritory(program.id, t)!;
    return { id: t, label: territoryLabel(t), applyUrl: link.applyUrl };
  });
  const applySteps =
    matching.length === 1
      ? [...primaryLink.applySteps]
      : matching.flatMap((t) => {
          const link = programLinkForTerritory(program.id, t)!;
          const label = territoryLabel(t);
          return link.applySteps.map((s) => `${label} – ${s}`);
        });
  const sources = [
    ...new Set(
      matching.flatMap(
        (t) => programLinkForTerritory(program.id, t)!.sources,
      ),
    ),
  ];

  return {
    applyUrl: primaryLink.applyUrl,
    applySteps,
    sources,
    territoryIds: matching,
    territoryLabels: matching.map(territoryLabel),
    territoryApplyLinks,
  };
}

/** Resolve apply URL when a territory query param is present (tracked /r/ links). */
export function resolveApplyUrlForTerritory(
  program: Program,
  territoryId: string | null | undefined,
): string {
  if (territoryId && isEnergyTerritoryId(territoryId)) {
    const link = programLinkForTerritory(program.id, territoryId);
    if (link) return link.applyUrl;
  }
  return program.applyUrl;
}

/** Primary territory id for tracked apply URLs from the live session. */
export function primaryTerritoryForProgram(
  program: Program,
  session: SessionState,
): TerritoryId | null {
  const matching = selectedEnergyTerritories(session).filter((t) =>
    Boolean(programLinkForTerritory(program.id, t)),
  );
  return matching[0] ?? null;
}

export function sessionHasIouBill(session: SessionState): boolean {
  return selectedEnergyTerritories(session).some((id) =>
    IOU_TERRITORIES.has(id),
  );
}
