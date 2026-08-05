const UA =
  "CalClaimDisasterWatcher/1.0 (+https://github.com/local/calclaim; D-CalFresh window checks; not a bot for users)";

const DEFAULT_TIMEOUT_MS = 15_000;
const OPENFEMA_URL = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";

/** How far back to pull declarations. Older events can never have an open window. */
const LOOKBACK_YEARS = 3;

/** One OpenFEMA row: a single designated area within one declaration. */
interface DeclarationRow {
  disasterNumber?: number;
  femaDeclarationString?: string;
  incidentType?: string;
  declarationTitle?: string;
  declarationDate?: string;
  incidentBeginDate?: string;
  incidentEndDate?: string | null;
  lastIAFilingDate?: string | null;
  designatedArea?: string;
  fipsCountyCode?: string;
  ihProgramDeclared?: boolean;
}

/** One declaration, with its designated areas collapsed into a single event. */
export interface FemaEvent {
  disasterNumber: number;
  femaDeclarationString: string;
  incidentType: string;
  title: string;
  declarationDate: string;
  /** Start of the incident period – the date D-CalFresh residency is tested against. */
  incidentBegin: string;
  incidentEnd: string | null;
  lastIaFilingDate: string | null;
  /** Normalized county names, e.g. "Los Angeles" from "Los Angeles (County)". */
  counties: string[];
  /** Designated areas that are not counties, e.g. tribal reservations. */
  otherAreas: string[];
}

function ymd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** "Los Angeles (County)" -> "Los Angeles"; non-county areas return null. */
function countyName(designatedArea: string): string | null {
  const m = designatedArea.match(/^(.*?)\s*\((County|Parish)\)\s*$/i);
  return m?.[1]?.trim() || null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OpenFEMA HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function lookbackDate(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - LOOKBACK_YEARS);
  return d.toISOString().slice(0, 10);
}

/**
 * California major-disaster declarations that authorized Individual Assistance.
 *
 * Filters on ihProgramDeclared (Individuals and Households Program), NOT
 * iaProgramDeclared – the latter is false on every current California record,
 * so filtering on it silently returns nothing.
 */
export async function fetchCaliforniaIaDeclarations(
  now: Date = new Date(),
): Promise<FemaEvent[]> {
  const filter = [
    "state eq 'CA'",
    "ihProgramDeclared eq true",
    `declarationDate ge '${lookbackDate(now)}'`,
  ].join(" and ");
  const url =
    `${OPENFEMA_URL}?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=declarationDate%20desc&$top=1000&$format=jsona`;

  const rows = await fetchJson<DeclarationRow[]>(url);
  if (!Array.isArray(rows)) throw new Error("OpenFEMA returned unexpected shape");

  const byDisaster = new Map<number, FemaEvent>();
  for (const row of rows) {
    const num = row.disasterNumber;
    const begin = ymd(row.incidentBeginDate);
    if (num == null || !begin) continue;

    let event = byDisaster.get(num);
    if (!event) {
      event = {
        disasterNumber: num,
        femaDeclarationString: row.femaDeclarationString ?? `DR-${num}-CA`,
        incidentType: row.incidentType ?? "Disaster",
        title: row.declarationTitle ?? `Disaster ${num}`,
        declarationDate: ymd(row.declarationDate) ?? begin,
        incidentBegin: begin,
        incidentEnd: ymd(row.incidentEndDate),
        lastIaFilingDate: ymd(row.lastIAFilingDate),
        counties: [],
        otherAreas: [],
      };
      byDisaster.set(num, event);
    }

    // Areas can be added weeks later with their own dates; keep the widest span.
    if (begin < event.incidentBegin) event.incidentBegin = begin;
    const end = ymd(row.incidentEndDate);
    if (end && (!event.incidentEnd || end > event.incidentEnd)) {
      event.incidentEnd = end;
    }
    const filing = ymd(row.lastIAFilingDate);
    if (filing && (!event.lastIaFilingDate || filing > event.lastIaFilingDate)) {
      event.lastIaFilingDate = filing;
    }

    const area = (row.designatedArea ?? "").trim();
    if (!area) continue;
    const county = countyName(area);
    if (county) {
      if (!event.counties.includes(county)) event.counties.push(county);
    } else if (!event.otherAreas.includes(area)) {
      event.otherAreas.push(area);
    }
  }

  for (const event of byDisaster.values()) {
    event.counties.sort((a, b) => a.localeCompare(b));
    event.otherAreas.sort((a, b) => a.localeCompare(b));
  }

  return [...byDisaster.values()].sort((a, b) =>
    b.declarationDate.localeCompare(a.declarationDate),
  );
}

/**
 * Events still plausibly able to support a D-CalFresh window: IA filing is
 * still open, or the incident ended within the last 120 days.
 */
export function recentlyActiveEvents(
  events: FemaEvent[],
  todayYmd: string,
): FemaEvent[] {
  const cutoff = new Date(`${todayYmd}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 120);
  const cutoffYmd = cutoff.toISOString().slice(0, 10);

  return events.filter((e) => {
    if (e.lastIaFilingDate && e.lastIaFilingDate >= todayYmd) return true;
    const ended = e.incidentEnd ?? e.incidentBegin;
    return ended >= cutoffYmd;
  });
}

/** Human label like "January 2025 wildfires" for card copy. */
export function eventLabel(event: FemaEvent): string {
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${event.incidentBegin}T12:00:00Z`));
  const kind = event.incidentType.toLowerCase();
  const plural = /s$/.test(kind) ? kind : `${kind}s`;
  return `${month} ${plural}`;
}
