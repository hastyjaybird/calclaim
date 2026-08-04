import type { ApplyPeriod, ExtractedWindow } from "./cdss.js";
import type { FemaEvent } from "./fema.js";
import type { FnsDsnapOperation } from "./fns.js";

/**
 * D-SNAP application periods are capped at 7 days by FNS, but extensions have
 * pushed real operations to roughly two weeks. Anything beyond this is a parse
 * error, not a policy change.
 */
const MAX_OPEN_DAYS = 21;

/** A window starting further out than this is a misread year or month. */
const MAX_DAYS_AHEAD = 120;

export type AutoDecision = "publish" | "hold";

export type Confidence = "corroborated" | "fns_only" | "fns_unverified";

export interface ValidationCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface ValidationResult {
  decision: AutoDecision;
  confidence: Confidence;
  checks: ValidationCheck[];
  /** Ids of failed checks, for the audit trail and alerts. */
  failed: string[];
  /** The FEMA declaration this operation was matched to, when found. */
  femaEvent: FemaEvent | null;
  summary: string;
}

function totalOpenDays(periods: ApplyPeriod[]): number {
  let days = 0;
  for (const p of periods) {
    const start = Date.parse(`${p.start}T12:00:00Z`);
    const end = Date.parse(`${p.end}T12:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    days += Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  }
  return days;
}

function daysBetween(aYmd: string, bYmd: string): number {
  const a = Date.parse(`${aYmd}T12:00:00Z`);
  const b = Date.parse(`${bYmd}T12:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function overlaps(a: ApplyPeriod, b: ApplyPeriod): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function matchFemaEvent(
  operation: FnsDsnapOperation,
  events: FemaEvent[],
): FemaEvent | null {
  const wanted = operation.counties.map((c) => c.toLowerCase());
  if (!wanted.length) return null;
  const candidates = events.filter((e) =>
    e.counties.some((c) => wanted.includes(c.toLowerCase())),
  );
  if (!candidates.length) return null;
  if (operation.iaDeclarationDate) {
    const exact = candidates.find(
      (e) => e.declarationDate === operation.iaDeclarationDate,
    );
    if (exact) return exact;
  }
  // Nearest declaration before the application period.
  const start = operation.applyPeriods[0]?.start;
  if (start) {
    const prior = candidates
      .filter((e) => e.declarationDate <= start)
      .sort((a, b) => b.declarationDate.localeCompare(a.declarationDate));
    if (prior[0]) return prior[0];
  }
  return candidates[0] ?? null;
}

/**
 * Decides on its own whether an FNS-reported operation is safe to publish
 * without review. Every check is mechanical: structured FEMA data, arithmetic
 * on the dates, and agreement with CDSS when CDSS has anything to say. A hold
 * means the extraction looks wrong, not that a person needs to approve it.
 */
export function validateOperation(opts: {
  operation: FnsDsnapOperation;
  femaEvents: FemaEvent[];
  femaOk: boolean;
  cdssWindows: ExtractedWindow[];
  todayYmd: string;
}): ValidationResult {
  const { operation, femaEvents, femaOk, cdssWindows, todayYmd } = opts;
  const checks: ValidationCheck[] = [];
  const periods = operation.applyPeriods;

  checks.push({
    id: "has_period",
    ok: periods.length > 0,
    detail: periods.length
      ? `${periods.length} application period(s)`
      : "no application period stated",
  });

  const femaEvent = matchFemaEvent(operation, femaEvents);
  const statedIa = operation.iaDeclarationDate;
  // D-SNAP is only lawful where FEMA declared Individual Assistance. Prefer the
  // structured record; fall back to FNS's own stated declaration date so a FEMA
  // outage cannot suppress a real window.
  checks.push({
    id: "fema_ia_declared",
    ok: femaEvent != null || (!femaOk && statedIa != null),
    detail: femaEvent
      ? `matched ${femaEvent.femaDeclarationString} (${femaEvent.counties.join(", ")})`
      : !femaOk && statedIa
        ? `FEMA unreachable; FNS states IA declared ${statedIa}`
        : "no FEMA Individual Assistance declaration for these counties",
  });

  const declarationDate = femaEvent?.declarationDate ?? statedIa;
  const firstStart = periods[0]?.start ?? null;
  checks.push({
    id: "period_after_declaration",
    ok:
      declarationDate == null || firstStart == null
        ? false
        : firstStart >= declarationDate,
    detail:
      declarationDate && firstStart
        ? `applications open ${firstStart}, declared ${declarationDate}`
        : "missing declaration date or period start",
  });

  const openDays = totalOpenDays(periods);
  checks.push({
    id: "period_length_sane",
    ok: openDays > 0 && openDays <= MAX_OPEN_DAYS,
    detail: `${openDays} open day(s), cap ${MAX_OPEN_DAYS}`,
  });

  const lastEnd = periods.length ? periods[periods.length - 1]!.end : null;
  checks.push({
    id: "not_historical",
    ok: lastEnd != null && lastEnd >= todayYmd,
    detail: lastEnd ? `closes ${lastEnd}, today ${todayYmd}` : "no end date",
  });

  checks.push({
    id: "not_far_future",
    ok:
      firstStart != null && daysBetween(todayYmd, firstStart) <= MAX_DAYS_AHEAD,
    detail: firstStart
      ? `opens in ${daysBetween(todayYmd, firstStart)} day(s), cap ${MAX_DAYS_AHEAD}`
      : "no start date",
  });

  // Ambiguous county scope is tolerable when a ZIP list pins the real boundary.
  checks.push({
    id: "scope_resolved",
    ok: !operation.countyScopeAmbiguous || (operation.zips?.length ?? 0) > 0,
    detail: operation.countyScopeAmbiguous
      ? operation.zips?.length
        ? `several counties named, ${operation.zips.length} ZIPs pin the scope`
        : "several counties named and no ZIP list to disambiguate"
      : `scope: ${operation.counties.join(", ") || "none"}`,
  });

  const conflict = findCdssConflict(operation, cdssWindows);
  checks.push({
    id: "sources_agree",
    ok: conflict == null,
    detail: conflict ?? "no contradiction from CDSS",
  });

  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  const corroboratedByCdss = cdssAgrees(operation, cdssWindows);
  const confidence: Confidence = corroboratedByCdss
    ? "corroborated"
    : femaEvent
      ? "fns_only"
      : "fns_unverified";

  return {
    decision: failed.length === 0 ? "publish" : "hold",
    confidence,
    checks,
    failed,
    femaEvent,
    summary: failed.length
      ? `held: ${failed.join(", ")}`
      : `auto-published (${confidence})`,
  };
}

function sharesCounty(a: string[], b: string[]): boolean {
  const lower = b.map((c) => c.toLowerCase());
  return a.some((c) => lower.includes(c.toLowerCase()));
}

/** CDSS describing a different window for the same counties means one parse is wrong. */
function findCdssConflict(
  operation: FnsDsnapOperation,
  cdssWindows: ExtractedWindow[],
): string | null {
  for (const w of cdssWindows) {
    if (!w.applyPeriods.length) continue;
    if (w.counties.length && !sharesCounty(operation.counties, w.counties)) continue;
    const anyOverlap = w.applyPeriods.some((cp) =>
      operation.applyPeriods.some((fp) => overlaps(cp, fp)),
    );
    if (!anyOverlap) {
      return (
        `CDSS reports ${w.applyPeriods.map((p) => `${p.start}..${p.end}`).join(", ")} ` +
        `but FNS reports ${operation.applyPeriods.map((p) => `${p.start}..${p.end}`).join(", ")}`
      );
    }
  }
  return null;
}

function cdssAgrees(
  operation: FnsDsnapOperation,
  cdssWindows: ExtractedWindow[],
): boolean {
  return cdssWindows.some(
    (w) =>
      w.applyPeriods.length > 0 &&
      (!w.counties.length || sharesCounty(operation.counties, w.counties)) &&
      w.applyPeriods.some((cp) =>
        operation.applyPeriods.some((fp) => overlaps(cp, fp)),
      ),
  );
}

/** Phone number from whichever source published one. */
export function pickApplyChannel(
  operation: FnsDsnapOperation,
  cdssWindows: ExtractedWindow[],
): { phone: string | null; url: string | null } {
  const match = cdssWindows.find(
    (w) => !w.counties.length || sharesCounty(operation.counties, w.counties),
  );
  return { phone: match?.applyPhone ?? null, url: match?.applyUrl ?? null };
}
