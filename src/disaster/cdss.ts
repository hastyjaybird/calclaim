import { createHash } from "node:crypto";
import { fetchPageText } from "../watchdog/fetch.js";
import { resolveLlmConfig } from "../watchdog/llm.js";

/**
 * The `cdss.ca.gov/disastercalfresh1` shortlink used in 2025 press releases now
 * 302s to a CDSS staff login, so it can only ever fail. It is left out rather
 * than kept as a permanently-failing source that would mask a real outage of
 * the page below.
 */
export const CDSS_SOURCES = [
  "https://www.cdss.ca.gov/inforesources/calfresh/disaster-calfresh",
];

/** One contiguous run of days a county accepts D-CalFresh applications. */
export interface ApplyPeriod {
  start: string;
  end: string;
}

export interface ExtractedWindow {
  label: string;
  counties: string[];
  zips: string[] | null;
  placeLabels: string[] | null;
  applyPeriods: ApplyPeriod[];
  applyPhone: string | null;
  applyUrl: string | null;
  incidentBegin: string | null;
  incidentEnd: string | null;
  sourceUrl: string;
  extractedBy: "llm" | "heuristic";
  notes: string | null;
}

export interface CdssScanResult {
  ok: boolean;
  error: string | null;
  /** Set when some pages fetched and others failed — visible but not an outage. */
  partialError: string | null;
  /** Hash of the combined page text — lets the caller skip the LLM when unchanged. */
  contentHash: string;
  windows: ExtractedWindow[];
  pages: Array<{ url: string; ok: boolean; status: number | null }>;
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

/**
 * D-CalFresh operations only. The CDSS page is dominated by Emergency Response
 * Waivers (replacement benefits for existing CalFresh households), which are a
 * different program and must never produce a window.
 */
function mentionsDCalFreshOperation(text: string): boolean {
  const t = text.toLowerCase();
  const hasProgram = /disaster calfresh|d-calfresh|d-snap/.test(t);
  const hasWindow =
    /application period|apply (?:between|during|from)|may only apply|can apply during/.test(t);
  return hasProgram && hasWindow;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Pull "February 10-14, 2025" / "Oct 18-22 and 25-26, 2021" style ranges.
 * Advisory only — every window lands as pending for human review.
 */
export function parseApplyPeriods(text: string, fallbackYear: number): ApplyPeriod[] {
  const out: ApplyPeriod[] = [];
  const monthNames = Object.keys(MONTHS).join("|");
  const re = new RegExp(
    String.raw`\b(${monthNames})\.?\s+(\d{1,2})` +
      String.raw`(?:\s*(?:-|–|—|to|through)\s*(?:(${monthNames})\.?\s+)?(\d{1,2}))?` +
      String.raw`(?:\s*,?\s*(\d{4}))?`,
    "gi",
  );

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const startMonth = MONTHS[m[1]!.toLowerCase()];
    const startDay = Number(m[2]);
    if (startMonth == null) continue;
    const endMonth = m[3] ? MONTHS[m[3].toLowerCase()] : startMonth;
    const endDay = m[4] ? Number(m[4]) : startDay;
    // A year right after the range wins; otherwise the nearest year in the text.
    const year = m[5]
      ? Number(m[5])
      : nearestYear(text, m.index) ?? fallbackYear;

    const start = toYmd(year, startMonth, startDay);
    const end = toYmd(year, endMonth ?? startMonth, endDay);
    if (!start || !end || end < start) continue;
    if (!out.some((p) => p.start === start && p.end === end)) {
      out.push({ start, end });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function nearestYear(text: string, at: number): number | null {
  const window = text.slice(Math.max(0, at - 120), at + 160);
  const years = [...window.matchAll(/\b(20\d{2})\b/g)].map((y) => Number(y[1]));
  return years.length ? years[years.length - 1]! : null;
}

/** California 5-digit ZIPs only — filters the "00018" style typos in state releases. */
export function parseZips(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(9[0-6]\d{3})\b/g)) found.add(m[1]!);
  return [...found].sort();
}

export function parsePhone(text: string): string | null {
  const m = text.match(/\b(?:1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Conservative fallback when no LLM is configured or the call fails. */
function heuristicWindows(pages: Array<{ url: string; text: string }>): ExtractedWindow[] {
  const out: ExtractedWindow[] = [];
  const year = new Date().getUTCFullYear();

  for (const page of pages) {
    if (!mentionsDCalFreshOperation(page.text)) continue;
    const periods = parseApplyPeriods(page.text, year);
    if (!periods.length) continue;
    const zips = parseZips(page.text);
    out.push({
      label: "Disaster CalFresh window (needs review)",
      counties: [],
      zips: zips.length ? zips : null,
      placeLabels: null,
      applyPeriods: periods,
      applyPhone: parsePhone(page.text),
      applyUrl: null,
      incidentBegin: null,
      incidentEnd: null,
      sourceUrl: page.url,
      extractedBy: "heuristic",
      notes:
        "Extracted without an LLM. Confirm counties, dates, and apply channel against the source page before activating.",
    });
  }
  return out;
}

const SYSTEM_PROMPT = `You extract Disaster CalFresh (D-CalFresh / D-SNAP) application windows from California CDSS page text.

CRITICAL: Only report an ACTUAL D-CalFresh operation with an application period.
Do NOT report Emergency Response Waivers. Timely Reporting Waivers, Automated Mass
Replacement Waivers, replacement benefits, and Hot Foods Waivers are a DIFFERENT
program for households already receiving CalFresh. If the page only describes
waivers, return {"windows":[]}.

For each real D-CalFresh window, extract:
- label: short human name, e.g. "January 2025 Los Angeles wildfires"
- counties: county names without the word "County", e.g. ["Los Angeles"]
- zips: 5-digit ZIP codes if the announcement narrows to ZIPs, else null
- placeLabels: recognizable place names (cities/neighborhoods) if listed, else null
- applyPeriods: [{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}] — one entry per
  contiguous run of days. "Feb 10-14 and Feb 18-19" is TWO entries.
- applyPhone: phone number to apply, else null
- applyUrl: URL to apply, else null. Do NOT use a generic BenefitsCal apply link.
- incidentBegin / incidentEnd: the disaster date range residency is tested against, else null
- notes: anything a human reviewer should check, else null

Never guess dates. Omit the window if there is no explicit application period.
Return JSON only: {"windows":[...]}`;

interface LlmWindowJson {
  label?: string;
  counties?: unknown;
  zips?: unknown;
  placeLabels?: unknown;
  applyPeriods?: unknown;
  applyPhone?: unknown;
  applyUrl?: unknown;
  incidentBegin?: unknown;
  incidentEnd?: unknown;
  notes?: unknown;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return out.length ? out.map((s) => s.trim()) : null;
}

function ymdOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function llmWindows(
  pages: Array<{ url: string; text: string }>,
): Promise<ExtractedWindow[] | null> {
  const cfg = resolveLlmConfig();
  if (!cfg) return null;

  const payload = pages.map((p) => ({ url: p.url, text: p.text.slice(0, 12_000) }));
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
        "X-Title": "CalClaim Disaster Window Watcher",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ pages: payload }) },
        ],
      }),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
      windows?: LlmWindowJson[];
    };
    const raw = Array.isArray(parsed.windows) ? parsed.windows : [];

    return raw
      .slice(0, 10)
      .map((w): ExtractedWindow | null => {
        const periods = Array.isArray(w.applyPeriods)
          ? w.applyPeriods
              .map((p) => {
                const rec = p as { start?: unknown; end?: unknown };
                const start = ymdOrNull(rec.start);
                const end = ymdOrNull(rec.end) ?? start;
                return start && end && end >= start ? { start, end } : null;
              })
              .filter((p): p is ApplyPeriod => p != null)
          : [];
        // No explicit application period means nothing to apply for.
        if (!periods.length) return null;
        return {
          label: typeof w.label === "string" && w.label.trim()
            ? w.label.trim().slice(0, 120)
            : "Disaster CalFresh window",
          counties: strArray(w.counties) ?? [],
          zips: strArray(w.zips)?.filter((z) => /^\d{5}$/.test(z)) ?? null,
          placeLabels: strArray(w.placeLabels),
          applyPeriods: periods.sort((a, b) => a.start.localeCompare(b.start)),
          applyPhone: typeof w.applyPhone === "string" ? parsePhone(w.applyPhone) : null,
          applyUrl: typeof w.applyUrl === "string" && /^https?:\/\//.test(w.applyUrl)
            ? w.applyUrl
            : null,
          incidentBegin: ymdOrNull(w.incidentBegin),
          incidentEnd: ymdOrNull(w.incidentEnd),
          sourceUrl: pages[0]?.url ?? CDSS_SOURCES[0]!,
          extractedBy: "llm",
          notes: typeof w.notes === "string" ? w.notes.slice(0, 500) : null,
        };
      })
      .filter((w): w is ExtractedWindow => w != null);
  } catch {
    return null;
  }
}

/**
 * Fetch the CDSS pages and extract any open D-CalFresh application windows.
 * Pass the previous run's contentHash to skip LLM extraction when nothing changed.
 */
export async function scanCdssWindows(
  previousContentHash?: string | null,
): Promise<CdssScanResult> {
  const fetched = await Promise.all(CDSS_SOURCES.map((url) => fetchPageText(url)));
  const pages = fetched
    .filter((p) => p.ok && p.text)
    .map((p) => ({ url: p.url, text: p.text }));
  const pageStatus = fetched.map((p) => ({
    url: p.url,
    ok: p.ok,
    status: p.status,
  }));

  const failures = fetched
    .filter((p) => !p.ok)
    .map((p) => `${p.url}: ${p.error ?? "failed"}`);

  if (!pages.length) {
    return {
      ok: false,
      error: failures.join("; ") || "No pages fetched",
      partialError: null,
      contentHash: "",
      windows: [],
      pages: pageStatus,
    };
  }
  const partialError = failures.length ? failures.join("; ") : null;

  const contentHash = createHash("sha256")
    .update(pages.map((p) => `${p.url}\n${p.text}`).join("\n---\n"))
    .digest("hex");

  if (previousContentHash && previousContentHash === contentHash) {
    return {
      ok: true,
      error: null,
      partialError,
      contentHash,
      windows: [],
      pages: pageStatus,
    };
  }

  const viaLlm = await llmWindows(pages);
  const windows = viaLlm ?? heuristicWindows(pages);
  return { ok: true, error: null, partialError, contentHash, windows, pages: pageStatus };
}
