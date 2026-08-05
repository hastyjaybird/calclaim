import { readFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import type { Program } from "./types.js";

interface ProgramsFile {
  version: string;
  market: string;
  disclaimer: string;
  programs: Program[];
}

interface IncomeBandsFile {
  version: string;
  bandsByHouseholdSize: Record<string, { careMax: number; feraMax: number }>;
}

let programsCache: Program[] | null = null;
let programsMeta: Omit<ProgramsFile, "programs"> | null = null;
let bandsCache: IncomeBandsFile | null = null;
let disclaimerCache = "";

function loadProgramsFile(): ProgramsFile {
  return JSON.parse(
    readFileSync(path.join(LIBRARY_DIR, "programs.json"), "utf8"),
  ) as ProgramsFile;
}

export function loadPrograms(): Program[] {
  if (!programsCache) {
    const raw = loadProgramsFile();
    programsCache = raw.programs;
    programsMeta = {
      version: raw.version,
      market: raw.market,
      disclaimer: raw.disclaimer,
    };
    disclaimerCache = raw.disclaimer;
  }
  return programsCache;
}

export function getLibraryMeta(): { version: string; market: string; disclaimer: string } {
  loadPrograms();
  return programsMeta!;
}

export function getDisclaimer(): string {
  loadPrograms();
  return disclaimerCache;
}

export function getProgram(id: string): Program | undefined {
  return loadPrograms().find((p) => p.id === id);
}

export function loadIncomeBands(): IncomeBandsFile {
  if (!bandsCache) {
    bandsCache = JSON.parse(
      readFileSync(path.join(LIBRARY_DIR, "income-bands.json"), "utf8"),
    ) as IncomeBandsFile;
  }
  return bandsCache;
}

export function incomeBandLabels(householdSize: number): {
  careBand: string;
  feraBand: string;
  aboveFera: string;
} {
  const sizeKey = String(Math.min(Math.max(householdSize, 1), 8));
  const bands = loadIncomeBands().bandsByHouseholdSize[sizeKey];
  if (!bands) {
    return {
      careBand: "About CARE income or less",
      feraBand: "About FERA income range",
      aboveFera: "Above FERA income range",
    };
  }
  const care = bands.careMax.toLocaleString("en-US");
  const fera = bands.feraMax.toLocaleString("en-US");
  return {
    careBand: `About $${care} or less / year`,
    feraBand: `About $${(bands.careMax + 1).toLocaleString("en-US")} – $${fera} / year`,
    aboveFera: `More than about $${fera} / year`,
  };
}
