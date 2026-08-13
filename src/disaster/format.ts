import type { ApplyPeriod } from "./cdss.js";
import type { DisasterWindow } from "./db.js";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function todayYmd(tz = process.env.TZ ?? "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parts(ymd: string): { y: number; m: number; d: number } | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function monthDay(ymd: string): string {
  const p = parts(ymd);
  if (!p) return ymd;
  return `${MONTH_ABBR[p.m - 1] ?? p.m} ${p.d}`;
}

function periodText(period: ApplyPeriod): string {
  const a = parts(period.start);
  const b = parts(period.end);
  if (!a || !b) return `${period.start} to ${period.end}`;
  if (period.start === period.end) return monthDay(period.start);
  if (a.m === b.m && a.y === b.y) return `${monthDay(period.start)}-${b.d}`;
  return `${monthDay(period.start)} - ${monthDay(period.end)}`;
}

/** "Feb 10-14 and Feb 18-19, 2025" – one entry per contiguous run of days. */
export function formatApplyPeriods(periods: ApplyPeriod[]): string {
  if (!periods.length) return "";
  const years = new Set(
    periods.flatMap((p) => [parts(p.start)?.y, parts(p.end)?.y]).filter((y) => y != null),
  );
  if (years.size === 1) {
    const year = [...years][0];
    return `${periods.map(periodText).join(" and ")}, ${year}`;
  }
  return periods
    .map((p) => {
      const y = parts(p.start)?.y;
      return y ? `${periodText(p)}, ${y}` : periodText(p);
    })
    .join(" and ");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon, Feb 10" – a weekday helps someone plan around a short window. */
export function formatOpenDay(ymd: string): string {
  const p = parts(ymd);
  if (!p) return ymd;
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS[dow] ?? ""}, ${monthDay(ymd)}`.replace(/^, /, "");
}

/**
 * The dates line for the card. FNS approves an operation before applications
 * open, so the card has to say whether today is a day you can act.
 */
export function formatWindowTiming(
  periods: ApplyPeriod[],
  openToday: boolean,
): string | null {
  if (!periods.length) return null;
  const all = formatApplyPeriods(periods);
  if (openToday) return `Deadline: apply ${all} only`;
  const first = periods[0]!.start;
  return `Applications open ${formatOpenDay(first)} – apply ${all} only`;
}

/** "Jan 7 - Jan 31, 2025" for the incident period residency is tested against. */
export function formatIncidentRange(
  begin: string | null,
  end: string | null,
): string | null {
  if (!begin) return null;
  const a = parts(begin);
  if (!a) return null;
  if (!end || end === begin) return `${monthDay(begin)}, ${a.y}`;
  const b = parts(end);
  if (!b) return `${monthDay(begin)}, ${a.y}`;
  if (a.y === b.y) return `${monthDay(begin)} - ${monthDay(end)}, ${a.y}`;
  return `${monthDay(begin)}, ${a.y} - ${monthDay(end)}, ${b.y}`;
}

export function formatCounties(counties: string[]): string {
  if (!counties.length) return "";
  const named = counties.map((c) => `${c} County`);
  if (named.length === 1) return named[0]!;
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * Area description for the live-or-work question. Counties are the legal
 * boundary; place names and ZIPs are shown as recognizable detail.
 */
export function describeArea(window: DisasterWindow, maxZips = 24): string[] {
  const lines: string[] = [];
  const counties = formatCounties(window.counties);
  const places = window.placeLabels?.length
    ? ` – including ${window.placeLabels.join(", ")}`
    : "";
  if (counties) lines.push(`${counties}${places}`);
  else if (window.placeLabels?.length) lines.push(window.placeLabels.join(", "));

  if (window.zips?.length) {
    const shown = window.zips.slice(0, maxZips).join(", ");
    const extra = window.zips.length > maxZips
      ? ` and ${window.zips.length - maxZips} more`
      : "";
    lines.push(`ZIP codes: ${shown}${extra}`);
  }
  return lines;
}

/**
 * First triage question while a Disaster CalFresh window is offerable.
 * Lists every active window so Yes / No / Not sure can be answered against
 * the real geography.
 */
export function disasterImpactQuestion(windows: DisasterWindow[]): string {
  const lines = [
    "Was your residence or your place of work impacted by any of the following disasters?",
  ];
  for (const window of windows) {
    lines.push("");
    const range = formatIncidentRange(window.incidentBegin, window.incidentEnd);
    lines.push(range ? `${window.label} (${range})` : window.label);
    for (const line of describeArea(window)) lines.push(line);
  }
  lines.push(
    "",
    "Yes if anyone in your household lived or worked there – a job in the area counts even if you live somewhere else.",
  );
  return lines.join("\n");
}

export function disasterZipConfirmPrompt(): string {
  return "What's the ZIP code for the residence or workplace that may have been impacted? (5 digits – used only to check the disaster area.)";
}

/** Prefer work ZIP when we already know home is out of state. */
export function disasterWorkZipConfirmPrompt(): string {
  return "What's the ZIP code for the California workplace that may have been impacted? (5 digits – used only to check the disaster area.)";
}

/**
 * How to apply – per-event phone or URL, never a generic CalFresh link.
 * Includes web URLs, so do not put this on offer cards (those stay in-chat
 * until the list is done; official links belong in the Application Guide PDF).
 */
export function formatApplyChannel(window: DisasterWindow): string | null {
  if (window.applyPhone && window.applyUrl) {
    return `Apply by phone at ${window.applyPhone} or online at ${window.applyUrl}`;
  }
  if (window.applyPhone) return `Apply by phone at ${window.applyPhone}`;
  if (window.applyUrl) return `Apply online at ${window.applyUrl}`;
  return null;
}
