import {
  ADDRESS_CONFIDENCE_THRESHOLD,
  canonicalizeAddressQuery,
  guessCanonicalAddress,
  nearestStreetFromCoords,
  pickConfidentMatch,
} from "./pgeAddressGuess.js";
import { getProgramRequirements } from "./requirements.js";
import type { Program, SessionState } from "./types.js";
import { selectedUtilityBills } from "./utilityBills.js";

/** PG&E Wildfire Safety Progress Map address lookup (GBRP green/red bubble). */
const PGE_ADDRESS_LOOKUP_URL =
  "https://89r98rgae5.us-west-2.ss.pge.com/single-address-lookup";

export const SHUTOFF_ADDRESS_PROMPT = `Share your location and we'll use the nearest street as an approximation, or type street and city (example: 123 Main St, Santa Rosa).

We'll check PG&E's map. We don't keep the street or GPS.`;

const PGE_BILL_IDS = new Set(["pge"]);

export interface PgeAddressMatch {
  address: string;
  city: string;
  zipcode: string;
  /** null = PG&E did not return a yes/no for this premise. */
  gbrpEligible: boolean | null;
  epssEligible: boolean | null;
}

/**
 * Shut-off / GBRP map outcome.
 * A ≥90% address guess that PG&E marks not eligible is a hard no.
 * Errors, no confident match, or unknown zone flag → maybe (show the offer).
 */
export type ShutoffLookupVerdict =
  | { kind: "yes"; address: string }
  | { kind: "no"; address: string }
  | { kind: "maybe"; reason: string };

/** Programs that need the PG&E shut-off / fire-threat map pre-check. */
export function programNeedsShutoffZone(program: Program): boolean {
  return getProgramRequirements(program.id).eligibility.includes(
    "fire_threat_district",
  );
}

/** Gate only makes sense after the user said they have a PG&E bill. */
export function sessionHasPgeBill(session: SessionState): boolean {
  return selectedUtilityBills(session).some((id) => PGE_BILL_IDS.has(id));
}

export function shutoffZoneAnswered(session: SessionState): boolean {
  return session.inShutoffZone !== null;
}

function triState(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function mergeMatches(
  ...lists: PgeAddressMatch[][]
): PgeAddressMatch[] {
  const seen = new Set<string>();
  const out: PgeAddressMatch[] = [];
  for (const list of lists) {
    for (const row of list) {
      const key = row.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function pickRow(
  query: string,
  matches: PgeAddressMatch[],
): PgeAddressMatch | null {
  const picked = pickConfidentMatch(
    query,
    matches,
    (item) => ({ address: item.address, city: item.city }),
    ADDRESS_CONFIDENCE_THRESHOLD,
  );
  return picked?.item ?? null;
}

export function verdictFromMatches(
  matches: PgeAddressMatch[],
  query: string,
): ShutoffLookupVerdict {
  const picked = pickRow(query, matches);
  if (picked) {
    if (picked.gbrpEligible === true) {
      return { kind: "yes", address: picked.address };
    }
    if (picked.gbrpEligible === false) {
      return { kind: "no", address: picked.address };
    }
    return { kind: "maybe", reason: "zone_unknown" };
  }
  if (matches.length === 0) {
    return { kind: "maybe", reason: "no_match" };
  }
  return { kind: "maybe", reason: "no_confident_match" };
}

export async function lookupPgeShutoffAddresses(
  query: string,
): Promise<PgeAddressMatch[]> {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (trimmed.length < 5) return [];

  const url = `${PGE_ADDRESS_LOOKUP_URL}?address=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`PG&E address lookup HTTP ${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];

  const out: PgeAddressMatch[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const address = typeof r.address === "string" ? r.address.trim() : "";
    if (!address) continue;
    out.push({
      address,
      city: typeof r.city === "string" ? r.city : "",
      zipcode: typeof r.zipcode === "string" ? r.zipcode : "",
      gbrpEligible: triState(r.gbrp_eligible),
      epssEligible: triState(r.epss_eligible),
    });
  }
  return out;
}

/**
 * Standardize sloppy input when ≥90% sure, send that to PG&E, and only
 * return a hard no when that premise is clearly not GBRP-eligible.
 */
export async function resolveShutoffZone(
  query: string,
): Promise<{ inZone: boolean; message: string }> {
  try {
    const cleaned = canonicalizeAddressQuery(query);
    const [guess, originalMatches] = await Promise.all([
      guessCanonicalAddress(query),
      lookupPgeShutoffAddresses(cleaned),
    ]);

    let matches = originalMatches;
    let picked = guess ? pickRow(guess.address, matches) : null;
    if (
      !picked &&
      guess &&
      guess.address.toLowerCase() !== cleaned.toLowerCase()
    ) {
      matches = mergeMatches(
        await lookupPgeShutoffAddresses(guess.address),
        originalMatches,
      );
      picked = pickRow(guess.address, matches);
    }
    picked = picked ?? pickRow(query, matches);
    const verdict = verdictFromMatches(
      picked ? [picked] : matches,
      picked?.address ?? guess?.address ?? query,
    );

    if (verdict.kind === "yes") {
      return {
        inZone: true,
        message:
          "That address looks like it may pre-qualify for PG&E backup-power incentives in a shut-off / high fire-risk zone.",
      };
    }
    if (verdict.kind === "no") {
      return {
        inZone: false,
        message:
          "That address does not look pre-qualified for the PG&E generator & battery rebate on their map.",
      };
    }
    return {
      inZone: true,
      message:
        "We couldn't get a clear yes/no from PG&E's map, so we'll show you the offer in case you might qualify. You can confirm on their page when you apply.",
    };
  } catch (err) {
    console.error("PG&E shut-off address lookup failed:", err);
    return {
      inZone: true,
      message:
        "PG&E's map didn't respond clearly, so we'll show you the offer in case you might qualify. You can confirm on their page when you apply.",
    };
  }
}

export function parseShutoffLocPayload(
  data: string,
): { lat: number; lng: number } | null {
  const m = /^shutoffloc:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(
    data.trim(),
  );
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export type ShutoffCoordResult =
  | { kind: "resolved"; inZone: boolean; message: string }
  | { kind: "unresolved"; message: string };

/**
 * GPS → nearest street (not stored) → PG&E map. Unresolved means type-in.
 */
export async function resolveShutoffZoneFromCoords(
  lat: number,
  lng: number,
): Promise<ShutoffCoordResult> {
  const nearest = await nearestStreetFromCoords(lat, lng);
  if (!nearest) {
    return {
      kind: "unresolved",
      message:
        "Couldn't pin a nearby street from that location. Type your street and city instead (example: 123 Main St, Santa Rosa).",
    };
  }
  const result = await resolveShutoffZone(nearest.address);
  return {
    kind: "resolved",
    inZone: result.inZone,
    message: `Using the nearest street as an approximation. ${result.message}`,
  };
}
