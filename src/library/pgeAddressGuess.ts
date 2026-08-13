/**
 * Guess a canonical street address from sloppy user text, then score PG&E
 * lookup rows against that guess. We only treat a row as "the" address at
 * ≥90% confidence (house number must match). Addresses are not persisted.
 */

export const ADDRESS_CONFIDENCE_THRESHOLD = 0.9;

const STREET_SUFFIX: Record<string, string> = {
  street: "st",
  streets: "st",
  str: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  av: "ave",
  boulevard: "blvd",
  blvd: "blvd",
  boul: "blvd",
  drive: "dr",
  dr: "dr",
  drv: "dr",
  road: "rd",
  rd: "rd",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  circle: "cir",
  cir: "cir",
  place: "pl",
  pl: "pl",
  terrace: "ter",
  ter: "ter",
  highway: "hwy",
  hwy: "hwy",
  parkway: "pkwy",
  pkwy: "pkwy",
  way: "way",
  trail: "trl",
  trl: "trl",
  path: "path",
  loop: "loop",
  alley: "aly",
  aly: "aly",
  square: "sq",
  sq: "sq",
  expressway: "expy",
  expy: "expy",
  freeway: "fwy",
  fwy: "fwy",
};

const DIRECTIONAL: Record<string, string> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  n: "n",
  s: "s",
  e: "e",
  w: "w",
  ne: "ne",
  nw: "nw",
  se: "se",
  sw: "sw",
};

const UNIT_MARKERS = new Set([
  "apt",
  "apartment",
  "unit",
  "ste",
  "suite",
  "fl",
  "floor",
  "rm",
  "room",
  "bldg",
  "building",
  "#",
]);

const SKIP_TOKENS = new Set(["ca", "california", "usa", "us"]);

export interface AddressParts {
  house: string;
  street: string;
  suffix: string;
  directional: string;
  unit: string;
  city: string;
  zip: string;
}

export interface ScoredAddress<T> {
  item: T;
  confidence: number;
  parts: AddressParts;
}

export function tokenizeAddress(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[#.,/]/g, " ")
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((t) => STREET_SUFFIX[t] ?? DIRECTIONAL[t] ?? t)
    .filter((t) => t !== "#" && !SKIP_TOKENS.has(t));
}

/** Collapse sloppy punctuation / suffixes so PG&E's search is less noisy. */
export function canonicalizeAddressQuery(raw: string): string {
  const tokens = tokenizeAddress(raw);
  const stripped: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (UNIT_MARKERS.has(t)) {
      i += 1;
      continue;
    }
    stripped.push(t);
  }
  const out = stripped.join(" ").trim();
  if (!out) return raw.trim().replace(/\s+/g, " ");
  return /,\s*ca\b/i.test(raw) || /\bca\b/i.test(out) ? out : `${out} ca`;
}

function isHouseToken(t: string): boolean {
  return /^\d+[a-z]?$/.test(t) && t.length !== 5;
}

function isZipToken(t: string): boolean {
  return /^\d{5}$/.test(t);
}

function housesEqual(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/^0+/, "") || "0";
  const nb = b.toLowerCase().replace(/^0+/, "") || "0";
  return na === nb;
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = editDistance(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function removeSequence(hay: string[], needle: string[]): string[] {
  if (!needle.length) return hay.slice();
  for (let i = 0; i <= hay.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return [...hay.slice(0, i), ...hay.slice(i + needle.length)];
  }
  return hay.slice();
}

function takeHouse(tokens: string[]): { house: string; rest: string[] } | null {
  const withoutZip = tokens.filter((t) => !isZipToken(t));
  const noUnit: string[] = [];
  for (let i = 0; i < withoutZip.length; i++) {
    const t = withoutZip[i]!;
    if (UNIT_MARKERS.has(t)) {
      i += 1;
      continue;
    }
    noUnit.push(t);
  }
  const houseIdx = noUnit.findIndex(isHouseToken);
  if (houseIdx < 0) return null;
  return {
    house: noUnit[houseIdx]!,
    rest: noUnit.filter((_, i) => i !== houseIdx),
  };
}

export function parseAddressParts(
  raw: string,
  hintCity = "",
): AddressParts | null {
  const tokens = tokenizeAddress(raw);
  const zip = tokens.find(isZipToken) ?? "";
  const cityHint = tokenizeAddress(hintCity);
  const houseTaken = takeHouse(tokens);
  if (!houseTaken) return null;

  let rest = houseTaken.rest.filter((t) => !isZipToken(t));
  let city = "";
  if (cityHint.length && containsSequence(rest, cityHint)) {
    city = cityHint.join(" ");
    rest = removeSequence(rest, cityHint);
  }

  let unit = "";
  const unitIdx = rest.findIndex((t) => UNIT_MARKERS.has(t));
  if (unitIdx >= 0) {
    unit = rest[unitIdx + 1] ?? "";
    rest = rest.filter((_, i) => i !== unitIdx && i !== unitIdx + 1);
  }

  let directional = "";
  if (rest[0] && DIRECTIONAL[rest[0]]) {
    directional = DIRECTIONAL[rest[0]] ?? rest[0]!;
    rest = rest.slice(1);
  }
  let suffix = "";
  const last = rest[rest.length - 1];
  if (last && STREET_SUFFIX[last]) {
    suffix = STREET_SUFFIX[last]!;
    rest = rest.slice(0, -1);
  }
  const street = rest.join(" ");
  if (!street) return null;
  return {
    house: houseTaken.house,
    street,
    suffix,
    directional,
    unit,
    city,
    zip,
  };
}

/**
 * Confidence that `candidate` is the address the user meant.
 * House number is a hard gate: mismatch → 0 (never reaches 90%).
 */
export function addressMatchConfidence(
  query: string,
  candidateAddress: string,
  candidateCity = "",
): number {
  const cand = parseAddressParts(candidateAddress, candidateCity);
  if (!cand) return 0;
  const qTokens = tokenizeAddress(query);
  const qHouse = takeHouse(qTokens);
  if (!qHouse || !housesEqual(qHouse.house, cand.house)) return 0;

  const cityTokens = tokenizeAddress(candidateCity || cand.city);
  let leftover = qHouse.rest.filter((t) => !isZipToken(t));
  leftover = leftover.filter((t) => !UNIT_MARKERS.has(t));
  // Drop the unit value token after a marker already stripped by tokenize.
  let cityScore = 0.75;
  if (cityTokens.length && containsSequence(leftover, cityTokens)) {
    cityScore = 1;
    leftover = removeSequence(leftover, cityTokens);
  } else if (cityTokens.length) {
    const leftoverCity = leftover.slice(-cityTokens.length).join(" ");
    const citySim = similarity(leftoverCity, cityTokens.join(" "));
    if (citySim >= 0.8) {
      cityScore = citySim;
      leftover = leftover.slice(0, leftover.length - cityTokens.length);
    } else if (leftover.length) {
      const maybeCity = leftover.filter(
        (t) => !STREET_SUFFIX[t] && !DIRECTIONAL[t],
      );
      const streetBits = new Set(cand.street.split(" ").filter(Boolean));
      const extra = maybeCity.filter(
        (t) => !streetBits.has(t) && similarity(t, cand.street) < 0.8,
      );
      if (extra.length) cityScore = 0.2;
    }
  }

  let qDirectional = "";
  if (leftover[0] && DIRECTIONAL[leftover[0]]) {
    qDirectional = leftover[0]!;
    leftover = leftover.slice(1);
  }
  let qSuffix = "";
  const qLast = leftover[leftover.length - 1];
  if (qLast && STREET_SUFFIX[qLast]) {
    qSuffix = STREET_SUFFIX[qLast]!;
    leftover = leftover.slice(0, -1);
  }
  const qStreet = leftover.join(" ");
  let streetScore = similarity(qStreet, cand.street);
  if (qStreet && cand.street && qStreet !== cand.street) {
    // "stewart" vs "stewrt" should still be high; "main" vs "mainord" should not.
    streetScore = Math.max(streetScore, similarity(qStreet, cand.street));
  }
  if (!qStreet) streetScore = 0.35;

  if (qDirectional && cand.directional && qDirectional !== cand.directional) {
    streetScore = Math.min(streetScore, 0.55);
  }
  let suffixScore = 1;
  if (qSuffix && cand.suffix && qSuffix !== cand.suffix) suffixScore = 0.55;

  const qZip = qTokens.find(isZipToken) ?? "";
  let zipScore = 1;
  if (qZip && cand.zip && qZip !== cand.zip) zipScore = 0.85;

  return (
    0.5 * streetScore + 0.35 * cityScore + 0.1 * suffixScore + 0.05 * zipScore
  );
}

export function pickConfidentMatch<T>(
  query: string,
  items: T[],
  getAddress: (item: T) => { address: string; city?: string },
  minConfidence = ADDRESS_CONFIDENCE_THRESHOLD,
): ScoredAddress<T> | null {
  const scored: ScoredAddress<T>[] = items.map((item) => {
    const { address, city } = getAddress(item);
    const parts =
      parseAddressParts(address, city ?? "") ??
      ({
        house: "",
        street: "",
        suffix: "",
        directional: "",
        unit: "",
        city: city ?? "",
        zip: "",
      } satisfies AddressParts);
    return {
      item,
      parts,
      confidence: addressMatchConfidence(query, address, city ?? ""),
    };
  });
  scored.sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  if (!best || best.confidence < minConfidence) return null;

  const samePremise = (other: ScoredAddress<T>) =>
    other.parts.house === best.parts.house &&
    other.parts.street === best.parts.street &&
    (other.parts.city === best.parts.city || !other.parts.city || !best.parts.city);

  const rival = scored.find(
    (row, i) =>
      i > 0 && row.confidence >= minConfidence && !samePremise(row),
  );
  if (rival && best.confidence - rival.confidence < 0.05) return null;
  return best;
}

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export interface CanonicalAddressGuess {
  address: string;
  city: string;
  zip: string;
  confidence: number;
}

interface CensusAddressMatch {
  matchedAddress?: string;
  addressComponents?: {
    zip?: string;
    streetName?: string;
    city?: string;
    state?: string;
    suffixType?: string;
    preDirection?: string;
    fromAddress?: string;
    toAddress?: string;
  };
}

/**
 * Census one-line geocoder: turns sloppy "1232 stewrt santa rosa" into
 * "1232 STEWART ST, SANTA ROSA, CA, 95404". One-shot; do not store.
 * Soft-fails to null on timeout / non-CA / no house match.
 */
export async function guessCanonicalAddress(
  raw: string,
): Promise<CanonicalAddressGuess | null> {
  const cleaned = canonicalizeAddressQuery(raw);
  if (cleaned.length < 5) return null;
  const url = `${CENSUS_GEOCODER_URL}?${new URLSearchParams({
    address: cleaned,
    benchmark: "Public_AR_Current",
    format: "json",
  }).toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CalClaim/2.0 (eligibility navigator)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { addressMatches?: CensusAddressMatch[] };
    };
    const matches = (body.result?.addressMatches ?? []).filter((m) => {
      const state = (m.addressComponents?.state ?? "").toUpperCase();
      return state === "CA" && typeof m.matchedAddress === "string";
    });
    if (!matches.length) return null;

    const scored = matches
      .map((m) => {
        const address = m.matchedAddress!.trim();
        const city = (m.addressComponents?.city ?? "").trim();
        const zip = (m.addressComponents?.zip ?? "").trim();
        return {
          address,
          city,
          zip,
          confidence: addressMatchConfidence(raw, address, city),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = scored[0];
    if (!best || best.confidence < ADDRESS_CONFIDENCE_THRESHOLD) return null;
    const rival = scored[1];
    if (
      rival &&
      rival.confidence >= ADDRESS_CONFIDENCE_THRESHOLD &&
      best.confidence - rival.confidence < 0.05
    ) {
      return null;
    }
    return best;
  } catch {
    return null;
  }
}

/** Rough California bounding box – skip reverse-geocode outside it. */
const CA_LAT_MIN = 32.5;
const CA_LAT_MAX = 42.1;
const CA_LNG_MIN = -124.5;
const CA_LNG_MAX = -114.1;

const GEOCODE_UA = "CalClaim/2.0 (eligibility navigator)";

function inCaliforniaBox(lat: number, lng: number): boolean {
  return (
    lat >= CA_LAT_MIN &&
    lat <= CA_LAT_MAX &&
    lng >= CA_LNG_MIN &&
    lng <= CA_LNG_MAX
  );
}

function hasHouseNumber(line: string): boolean {
  return /^\d/.test(line.trim()) && !/\d+\s*-\s*\d+/.test(line.trim());
}

function guessFromParts(
  streetLine: string,
  city: string,
  zip: string,
): CanonicalAddressGuess | null {
  const street = streetLine.trim().replace(/\s+/g, " ");
  const cityTrim = city.trim();
  if (!hasHouseNumber(street) || !cityTrim) return null;
  const zipTrim = zip.trim();
  const address = [street, cityTrim, "CA", zipTrim].filter(Boolean).join(", ");
  return { address, city: cityTrim, zip: zipTrim, confidence: 1 };
}

interface ArcGisReverse {
  address?: {
    Address?: string;
    ShortLabel?: string;
    AddNum?: string;
    City?: string;
    Postal?: string;
    Region?: string;
    RegionAbbr?: string;
  };
}

async function reverseGeocodeArcGis(
  lat: number,
  lng: number,
): Promise<CanonicalAddressGuess | null> {
  const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?${new URLSearchParams(
    {
      f: "json",
      location: `${lng},${lat}`,
      featureTypes: "PointAddress,StreetAddress",
      distance: "150",
    },
  ).toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": GEOCODE_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as ArcGisReverse;
  const a = body.address;
  if (!a) return null;
  const region = (a.RegionAbbr ?? "").toUpperCase();
  const regionName = (a.Region ?? "").toLowerCase();
  if (region && region !== "CA") return null;
  if (!region && regionName && !regionName.includes("california")) return null;
  const street = (a.Address || a.ShortLabel || "").trim();
  return guessFromParts(street, a.City ?? "", a.Postal ?? "");
}

interface NominatimReverse {
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
  };
}

async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
): Promise<CanonicalAddressGuess | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams(
    {
      lat: String(lat),
      lon: String(lng),
      format: "jsonv2",
      addressdetails: "1",
      zoom: "18",
    },
  ).toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": GEOCODE_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as NominatimReverse;
  const a = body.address;
  if (!a) return null;
  const state = (a.state ?? "").toLowerCase();
  if (state && state !== "california") return null;
  const house = (a.house_number ?? "").trim();
  const road = (a.road ?? "").trim();
  if (!house || !road) return null;
  const city = (a.city || a.town || a.village || "").trim();
  return guessFromParts(`${house} ${road}`, city, a.postcode ?? "");
}

/**
 * Snap GPS to the nearest street address. One-shot; do not store.
 * ArcGIS rooftop/street first; OpenStreetMap if that misses.
 */
export async function nearestStreetFromCoords(
  lat: number,
  lng: number,
): Promise<CanonicalAddressGuess | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inCaliforniaBox(lat, lng)) return null;
  try {
    return (
      (await reverseGeocodeArcGis(lat, lng)) ??
      (await reverseGeocodeNominatim(lat, lng))
    );
  } catch {
    return null;
  }
}
