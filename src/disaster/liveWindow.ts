import type { Program } from "../library/types.js";
import {
  hasDisasterDb,
  isPeriodOpen,
  listApprovedWindows,
  listLiveWindows,
  type DisasterWindow,
} from "./db.js";
import { todayYmd } from "./format.js";

/**
 * Published windows that have not closed yet, whether or not applications are
 * open today. Returns empty when the table is missing or unreadable, so a broken
 * scan hides the offer rather than advertising a program nobody can apply for.
 */
export function offerableDisasterWindows(): DisasterWindow[] {
  if (!hasDisasterDb()) return [];
  try {
    return listApprovedWindows(todayYmd());
  } catch {
    return [];
  }
}

/** Windows accepting applications today. */
export function liveDisasterWindows(): DisasterWindow[] {
  if (!hasDisasterDb()) return [];
  try {
    return listLiveWindows(todayYmd());
  } catch {
    return [];
  }
}

/**
 * Whether the disaster-gated card can be offered at all. True during an open
 * window and during the approved-but-not-open run-up to one.
 */
export function hasOfferableDisasterWindow(): boolean {
  return offerableDisasterWindows().length > 0;
}

/**
 * The window a disaster-gated card should describe. One that is open today wins;
 * otherwise the one opening soonest.
 */
export function windowForProgram(program: Program): DisasterWindow | null {
  if (!program.requiresActiveDisasterWindow) return null;
  const windows = offerableDisasterWindows();
  if (!windows.length) return null;
  const today = todayYmd();
  const open = windows.find((w) => isPeriodOpen(w.applyPeriods, today));
  if (open) return open;
  return [...windows].sort((a, b) =>
    (firstApplyDay(a) ?? "9999").localeCompare(firstApplyDay(b) ?? "9999"),
  )[0]!;
}

/** Last day of the final open application period — the real "act by" date. */
export function lastApplyDay(window: DisasterWindow): string | null {
  return window.applyPeriods.reduce<string | null>(
    (acc, p) => (acc == null || p.end > acc ? p.end : acc),
    null,
  );
}

/** First day applications are accepted. */
export function firstApplyDay(window: DisasterWindow): string | null {
  return window.applyPeriods.reduce<string | null>(
    (acc, p) => (acc == null || p.start < acc ? p.start : acc),
    null,
  );
}

export function isOpenToday(
  window: DisasterWindow,
  today = todayYmd(),
): boolean {
  return isPeriodOpen(window.applyPeriods, today);
}

/** Days until applications open; 0 once they are open. */
export function daysUntilOpen(
  window: DisasterWindow,
  today = todayYmd(),
): number {
  if (isOpenToday(window, today)) return 0;
  const first = firstApplyDay(window);
  if (!first || first <= today) return 0;
  const ms =
    Date.parse(`${first}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`);
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}
