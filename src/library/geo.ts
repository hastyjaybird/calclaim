import { readFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";

interface CmspCountiesFile {
  counties: string[];
}

interface ZipToCountyFile {
  zipToCounty: Record<string, string>;
}

let cmspCounties: Set<string> | null = null;
let zipToCounty: Record<string, string> | null = null;

function loadCmspCounties(): Set<string> {
  if (!cmspCounties) {
    const raw = JSON.parse(
      readFileSync(path.join(LIBRARY_DIR, "cmsp-counties.json"), "utf8"),
    ) as CmspCountiesFile;
    cmspCounties = new Set(raw.counties.map((c) => c.toLowerCase()));
  }
  return cmspCounties;
}

function loadZipToCounty(): Record<string, string> {
  if (!zipToCounty) {
    const raw = JSON.parse(
      readFileSync(path.join(LIBRARY_DIR, "ca-zip-to-county.json"), "utf8"),
    ) as ZipToCountyFile;
    zipToCounty = raw.zipToCounty;
  }
  return zipToCounty;
}

/** Normalize typed ZIP to 5 digits, or null if not a usable US ZIP. */
export function parseZipCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 5 || digits.length === 9) return digits.slice(0, 5);
  return null;
}

/** County name for a CA ZIP, or null if unknown / not in our map. */
export function countyFromZip(zip: string): string | null {
  const normalized = parseZipCode(zip);
  if (!normalized) return null;
  return loadZipToCounty()[normalized] ?? null;
}

export function isCmspCounty(county: string | null | undefined): boolean {
  if (!county) return false;
  return loadCmspCounties().has(county.trim().toLowerCase());
}

export function countyInList(
  county: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!county || allowed.length === 0) return false;
  const needle = county.trim().toLowerCase();
  return allowed.some((c) => c.trim().toLowerCase() === needle);
}

/** ZIP is asked when CMSP or any eligibleCounties program would otherwise unlock. */
export function programNeedsZip(program: {
  requiresCmspCounty?: boolean;
  eligibleCounties?: string[];
}): boolean {
  return (
    program.requiresCmspCounty === true ||
    Boolean(program.eligibleCounties && program.eligibleCounties.length > 0)
  );
}

export function passesCountyEligibility(
  program: {
    requiresCmspCounty?: boolean;
    eligibleCounties?: string[];
  },
  county: string | null | undefined,
): boolean {
  if (program.requiresCmspCounty && !isCmspCounty(county)) return false;
  if (program.eligibleCounties?.length) {
    return countyInList(county, program.eligibleCounties);
  }
  return true;
}
