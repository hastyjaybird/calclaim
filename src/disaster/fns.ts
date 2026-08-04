import type { ApplyPeriod } from "./cdss.js";

const UA =
  "CalClaimDisasterWatcher/1.0 (+https://github.com/local/calclaim; D-CalFresh window checks; not a bot for users)";

const TIMEOUT_MS = 20_000;

/**
 * FNS is the agency that actually approves D-SNAP, and this page is its running
 * log of California approvals. It states the application period explicitly,
 * which is the one fact FEMA can never provide.
 */
export const FNS_SOURCE = "https://www.fns.usda.gov/disaster/california";

/** The page carries years of history, so the cap has to fit the whole thing. */
const MAX_TEXT_CHARS = 400_000;

/** Static reference data: county names are matched against this list rather than
 * parsed out of prose, which removes the guesswork from scope extraction. */
export const CA_COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
  "Del Norte", "El Dorado", "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo",
  "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
  "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa",
  "Nevada", "Orange", "Placer", "Plumas", "Riverside", "Sacramento",
  "San Benito", "San Bernardino", "San Diego", "San Francisco", "San Joaquin",
  "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz",
  "Shasta", "Sierra", "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter",
  "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
];

export interface FnsDsnapOperation {
  /** Date FNS approved this request. */
  approvalDate: string;
  /** IA declaration date named in the bullet, when stated. */
  iaDeclarationDate: string | null;
  counties: string[];
  zips: string[] | null;
  applyPeriods: ApplyPeriod[];
  /** Extensions and additions reference an earlier approval. */
  isModification: boolean;
  /** True when the bullet names several counties without a single clear target. */
  countyScopeAmbiguous: boolean;
  text: string;
  sourceUrl: string;
}

export interface FnsScanResult {
  ok: boolean;
  error: string | null;
  contentHash: string;
  /** Operations whose application period has not fully passed. */
  operations: FnsDsnapOperation[];
  /** Bullets that looked like D-SNAP but yielded no usable dates. */
  unparsed: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join("|");
/** "Feb. 10, 2025" / "February 10, 2025" — FNS always writes the year. */
const FULL_DATE = String.raw`(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`;

/**
 * Expand "Feb." to "February". FNS abbreviates months, and the trailing period
 * otherwise reads as a sentence boundary, splitting dates down the middle.
 */
export function normalizeMonths(text: string): string {
  return text.replace(
    /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.\s*/gi,
    (_all, abbr: string) => {
      const m = MONTHS[abbr.toLowerCase()];
      const full = m == null ? abbr : FULL_MONTHS[m - 1];
      return `${full} `;
    },
  );
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(month: string, day: string, year: string): string | null {
  const m = MONTHS[month.toLowerCase()];
  const d = Number(day);
  const y = Number(year);
  if (m == null || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function eachDay(period: ApplyPeriod): string[] {
  const out: string[] = [];
  let cur = period.start;
  // Guard against a bad parse producing an unbounded loop.
  for (let i = 0; i < 400 && cur <= period.end; i += 1) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Re-split spans into contiguous runs after removing closed days. */
function subtractDays(periods: ApplyPeriod[], excluded: string[]): ApplyPeriod[] {
  const drop = new Set(excluded);
  const open = new Set<string>();
  for (const p of periods) {
    for (const day of eachDay(p)) {
      if (!drop.has(day)) open.add(day);
    }
  }
  const sorted = [...open].sort();
  const out: ApplyPeriod[] = [];
  for (const day of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === day) last.end = day;
    else out.push({ start: day, end: day });
  }
  return out;
}

/**
 * Strip HTML but keep block boundaries, so each approval bullet stays its own
 * line. The shared watchdog helper collapses everything to one line, which
 * would merge every approval on the page together.
 */
function stripToLines(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(li|p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
}

/** A bullet describes a D-SNAP operation, not a replacement-benefit waiver. */
function isDsnapOperation(text: string): boolean {
  const mentionsDsnap = /d-snap|disaster supplemental nutrition/i.test(text);
  if (!mentionsDsnap) return false;
  const operates =
    /\boperate\s+(?:a\s+|the\s+)?(?:d-snap|disaster supplemental)/i.test(text) ||
    /\bd-snap\)?\s+operations?\b/i.test(text) ||
    /\bapplication period\b/i.test(text);
  if (!operates) return false;
  // Replacement and reporting waivers are a different program for households
  // already on CalFresh; they must never produce a window.
  const waiverOnly =
    /(mass\s+)?replacement|reporting requirement|hot foods/i.test(text) &&
    !/\boperate\s+(?:a\s+|the\s+)?(?:d-snap|disaster supplemental)|d-snap\)?\s+operations?/i.test(
      text,
    );
  return !waiverOnly;
}

function parseApprovalDate(text: string): string | null {
  const re = new RegExp(String.raw`^On\s+${FULL_DATE}`, "i");
  const m = text.match(re);
  return m ? ymd(m[1]!, m[2]!, m[3]!) : null;
}

function parseIaDeclarationDate(text: string): string | null {
  // "...Major Disaster Declaration with Federal Individual Assistance on Jan. 8, 2025"
  // "...designated San Diego County as eligible for Federal Individual Assistance on Feb. 19, 2024"
  const re = new RegExp(
    String.raw`(?:individual assistance|major disaster[^.]{0,80}?)\s+on\s+${FULL_DATE}`,
    "i",
  );
  const m = text.match(re);
  return m ? ymd(m[1]!, m[2]!, m[3]!) : null;
}

/**
 * Application periods. FNS states them either as explicit ranges joined by
 * "and", or as one span plus the days it will not operate.
 */
export function parseFnsApplyPeriods(raw: string): ApplyPeriod[] {
  const text = normalizeMonths(raw);
  // Only look at sentences about operating dates, so approval and declaration
  // dates elsewhere in the bullet are not mistaken for the window.
  const sentences = text.split(/(?<=\.)\s+/).filter((s) =>
    /application period|operate (?:a |the )?d-snap|d-snap operations|operate d-snap|plans to operate/i.test(
      s,
    ),
  );
  const scope = sentences.length ? sentences.join(" ") : "";
  if (!scope) return [];

  const rangeRe = new RegExp(
    String.raw`${FULL_DATE}\s*,?\s*(?:through|thru|to|and continue through|until)\s*(?:\w+day,?\s+)?${FULL_DATE}`,
    "gi",
  );
  const ranges: ApplyPeriod[] = [];
  const consumed: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(scope)) != null) {
    const start = ymd(m[1]!, m[2]!, m[3]!);
    const end = ymd(m[4]!, m[5]!, m[6]!);
    if (start && end && end >= start) {
      ranges.push({ start, end });
      consumed.push([m.index, m.index + m[0].length]);
    }
  }

  // A lone date can be a single-day operation or an extension end date.
  if (!ranges.length) {
    const singleRe = new RegExp(FULL_DATE, "gi");
    while ((m = singleRe.exec(scope)) != null) {
      const day = ymd(m[1]!, m[2]!, m[3]!);
      if (day) ranges.push({ start: day, end: day });
    }
  }
  if (!ranges.length) return [];

  // "extend the application period through February 20, 2025" states only the
  // new end date, so it has to stretch the last known period rather than
  // register as a period of its own.
  const extendedEnd = parseExtensionEnd(scope);
  if (extendedEnd) {
    const last = ranges.reduce((a, b) => (b.end > a.end ? b : a));
    if (extendedEnd > last.end && withinDays(last.end, extendedEnd, 30)) {
      last.end = extendedEnd;
    }
  }

  const excluded = parseClosedDays(text);
  return subtractDays(ranges, excluded).sort((a, b) => a.start.localeCompare(b.start));
}

function parseExtensionEnd(text: string): string | null {
  const re = new RegExp(
    String.raw`extend[^.]{0,160}?\b(?:through|to)\s+${FULL_DATE}`,
    "i",
  );
  const m = text.match(re);
  return m ? ymd(m[1]!, m[2]!, m[3]!) : null;
}

/** Days inside the span when the county explicitly will not take applications. */
function parseClosedDays(raw: string): string[] {
  const text = normalizeMonths(raw);
  const out: string[] = [];
  const clauseRe =
    /\b(?:will not|did not|does not)\s+(?:accept applications|operate)[^.]*\./gi;
  const clauses = text.match(clauseRe) ?? [];
  const dateRe = new RegExp(FULL_DATE, "gi");
  for (const clause of clauses) {
    let m: RegExpExecArray | null;
    while ((m = dateRe.exec(clause)) != null) {
      const day = ymd(m[1]!, m[2]!, m[3]!);
      if (day) out.push(day);
    }
  }
  return out;
}

function parseZips(text: string): string[] | null {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(9[0-6]\d{3})\b/g)) found.add(m[1]!);
  return found.size ? [...found].sort() : null;
}

/**
 * Counties named in the bullet, matched against the static California list.
 * A bullet that adds one county to an existing operation also restates the
 * original counties, so a single explicit target wins when present.
 */
function parseCounties(text: string): { counties: string[]; ambiguous: boolean } {
  const mentioned = CA_COUNTIES.filter((name) =>
    new RegExp(String.raw`\b${name.replace(/\s+/g, String.raw`\s+`)}\b`, "i").test(text),
  );
  if (mentioned.length <= 1) return { counties: mentioned, ambiguous: false };

  const targetRe = new RegExp(
    String.raw`(?:approval|modification|extension|expansion|additional county|additional counties)[^.]{0,60}?\bfor\s+((?:${CA_COUNTIES.join(
      "|",
    )}))\s+County`,
    "i",
  );
  const target = text.match(targetRe)?.[1];
  if (target) return { counties: [target], ambiguous: false };

  // "in one additional county, San Luis Obispo"
  const addedRe = new RegExp(
    String.raw`additional count(?:y|ies)(?:\s+of)?,?\s+((?:${CA_COUNTIES.join("|")}))\b`,
    "i",
  );
  const added = text.match(addedRe)?.[1];
  if (added) return { counties: [added], ambiguous: false };

  return { counties: mentioned, ambiguous: true };
}

/**
 * Parse D-SNAP operations from the page, dropping any whose application period
 * has already fully passed. The page holds years of history, so without the
 * date filter every past operation would be re-created on each scan.
 */
export function parseFnsDsnapOperations(
  pageText: string,
  todayYmd: string,
): { operations: FnsDsnapOperation[]; unparsed: string[] } {
  // Each entry starts "On <date>, FNS approved" / "On <date>, we approved".
  const boundary = new RegExp(
    String.raw`(?=\bOn\s+${FULL_DATE},?\s+(?:FNS|we|the\s+Food|California))`,
    "gi",
  );
  const bullets = pageText
    .split(boundary)
    .map((b) => normalizeMonths(b.replace(/\s+/g, " ").trim()))
    .filter((b) => /^On\s/i.test(b));

  const operations: FnsDsnapOperation[] = [];
  const unparsed: string[] = [];

  for (const bullet of bullets) {
    if (!isDsnapOperation(bullet)) continue;
    const applyPeriods = parseFnsApplyPeriods(bullet);
    const approvalDate = parseApprovalDate(bullet);
    if (!applyPeriods.length || !approvalDate) {
      unparsed.push(bullet.slice(0, 300));
      continue;
    }
    const lastDay = applyPeriods[applyPeriods.length - 1]!.end;
    if (lastDay < todayYmd) continue;

    const { counties, ambiguous } = parseCounties(bullet);
    operations.push({
      approvalDate,
      iaDeclarationDate: parseIaDeclarationDate(bullet),
      counties,
      zips: parseZips(bullet),
      applyPeriods,
      isModification: /modif|extend|extension|expand|expansion|additional/i.test(bullet),
      countyScopeAmbiguous: ambiguous,
      text: bullet.slice(0, 2000),
      sourceUrl: FNS_SOURCE,
    });
  }

  // Newest approval first: a later modification supersedes an earlier one.
  operations.sort((a, b) => b.approvalDate.localeCompare(a.approvalDate));
  return { operations, unparsed };
}

/**
 * Collapse approvals for the same county scope into one current window. An
 * extension restates the original dates, so the union across approvals is the
 * operation as it now stands.
 */
export function mergeOperations(
  operations: FnsDsnapOperation[],
): FnsDsnapOperation[] {
  const groups: FnsDsnapOperation[] = [];
  for (const op of operations) {
    const scope = op.counties.map((c) => c.toLowerCase()).sort().join("+") || "unknown";
    const existing = groups.find((g) => {
      const gScope = g.counties.map((c) => c.toLowerCase()).sort().join("+") || "unknown";
      if (gScope !== scope) return false;
      // The same county can host operations years apart, so only combine
      // approvals that belong to the same event.
      return withinDays(g.approvalDate, op.approvalDate, 120);
    });
    if (!existing) {
      groups.push({ ...op, applyPeriods: [...op.applyPeriods] });
      continue;
    }
    existing.applyPeriods = subtractDays(
      [...existing.applyPeriods, ...op.applyPeriods],
      parseClosedDays(`${existing.text} ${op.text}`),
    );
    existing.zips = existing.zips || op.zips
      ? [...new Set([...(existing.zips ?? []), ...(op.zips ?? [])])].sort()
      : null;
    existing.iaDeclarationDate = existing.iaDeclarationDate ?? op.iaDeclarationDate;
  }
  return groups;
}

function withinDays(aYmd: string, bYmd: string, days: number): boolean {
  const a = Date.parse(`${aYmd}T12:00:00Z`);
  const b = Date.parse(`${bYmd}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= days * 24 * 60 * 60 * 1000;
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return stripToLines(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

export async function scanFnsDsnap(todayYmd: string): Promise<FnsScanResult> {
  try {
    const text = await fetchText(FNS_SOURCE);
    const { createHash } = await import("node:crypto");
    const contentHash = createHash("sha256").update(text).digest("hex");
    const { operations, unparsed } = parseFnsDsnapOperations(text, todayYmd);
    return {
      ok: true,
      error: null,
      contentHash,
      operations: mergeOperations(operations),
      unparsed,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      contentHash: "",
      operations: [],
      unparsed: [],
    };
  }
}
