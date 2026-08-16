import type { SessionState, StepId } from "../library/types.js";
import {
  currentProgram,
  estimateMaxScreensRemaining,
} from "../queue/ranker.js";
import { recordEvent, type AnalyticsEventRow } from "./db.js";

/** Tree locations that count as experience screens (matches /dev#tree nodes). */
export const SCREEN_LOCATIONS = [
  {
    id: "opt_in",
    label: "Opt-in",
    detail: "Disclaimer · Start",
  },
  {
    id: "gate",
    label: "Gate",
    detail: "Already on categorical programs?",
  },
  {
    id: "offer",
    label: "Offer card",
    detail: "Program card loop",
  },
  {
    id: "household_size",
    label: "Household size",
    detail: "NO arm · size before income",
  },
  {
    id: "income_band",
    label: "Income band",
    detail: "CARE / FERA / above",
  },
  {
    id: "has_ca_residency",
    label: "CA home",
    detail: "Where do you live most of the year?",
  },
  {
    id: "has_ca_work",
    label: "CA work",
    detail: "Follow-up after another state",
  },
  {
    id: "has_utility_bills",
    label: "Utility bills",
    detail: "Bills in your name",
  },
  {
    id: "has_shared_meter",
    label: "Shared meter",
    detail: "Another household on this meter?",
  },
  {
    id: "has_shutoff_zone",
    label: "Shut-off zone",
    detail: "PG&E fire / shut-off area",
  },
  {
    id: "past_due",
    label: "Past due",
    detail: "Utility bill past due?",
  },
  {
    id: "has_medical_need",
    label: "Medical Baseline need",
    detail: "Qualifying medical condition or device",
  },
  {
    id: "has_child",
    label: "Child in household",
    detail: "Kids / pregnancy",
  },
  {
    id: "has_foster_youth",
    label: "Foster youth",
    detail: "Former foster youth 18–25",
  },
  {
    id: "has_refugee_status",
    label: "Refugee / asylee",
    detail: "RCA-eligible newcomer",
  },
  {
    id: "has_abd",
    label: "Aged / blind / disabled",
    detail: "SSI / CAPI / IHSS gate",
  },
  {
    id: "has_work_disruption",
    label: "Work disruption",
    detail: "UI / SDI / PFL",
  },
  {
    id: "has_buying_ebike",
    label: "Buying e-bike",
    detail: "Pedal e-bike this year (not a scooter)",
  },
  {
    id: "has_retire_vehicle",
    label: "Retire old car",
    detail: "Scrap an older vehicle for mobility option",
  },
  {
    id: "has_buying_ev",
    label: "Buying EV",
    detail: "Shopping for EV this year",
  },
  {
    id: "has_first_time_zev",
    label: "First-time ZEV",
    detail: "First battery / hydrogen vehicle",
  },
  {
    id: "has_disaster_area",
    label: "Disaster area",
    detail: "Lived / worked in disaster area",
  },
  {
    id: "has_disaster_zip",
    label: "Disaster ZIP",
    detail: "Not sure → ZIP confirm",
  },
  {
    id: "has_zip",
    label: "Home ZIP",
    detail: "CMSP / local e-bike county",
  },
  {
    id: "has_immigration_status",
    label: "Immigration",
    detail: "Asked last · not stored",
  },
  {
    id: "has_reopen_notify",
    label: "Reopen notify",
    detail: "Waitlist / closed programs alert",
  },
  {
    id: "finish",
    label: "Finish",
    detail: "Queue done · Application Guide",
  },
] as const;

export type ScreenLocationId = (typeof SCREEN_LOCATIONS)[number]["id"];

const LOCATION_SET = new Set<string>(SCREEN_LOCATIONS.map((s) => s.id));

export function isScreenLocation(id: string): id is ScreenLocationId {
  return LOCATION_SET.has(id);
}

/** Collapse step ids onto tree locations used for dropout analytics. */
export function treeLocationForStep(step: StepId): ScreenLocationId | null {
  switch (step) {
    case "opt_in":
      return "opt_in";
    case "gate":
      return "gate";
    case "offer":
      return "offer";
    case "household_size":
    case "household_size_custom":
      return "household_size";
    case "income_band":
      return "income_band";
    case "past_due":
      return "past_due";
    case "has_utility_bills":
      return "has_utility_bills";
    case "has_shared_meter":
      return "has_shared_meter";
    case "has_shutoff_zone":
    case "has_shutoff_address":
      return "has_shutoff_zone";
    case "has_ca_residency":
      return "has_ca_residency";
    case "has_ca_work":
      return "has_ca_work";
    case "has_buying_ev":
      return "has_buying_ev";
    case "has_first_time_zev":
      return "has_first_time_zev";
    case "has_buying_ebike":
      return "has_buying_ebike";
    case "has_retire_vehicle":
      return "has_retire_vehicle";
    case "has_child":
      return "has_child";
    case "has_foster_youth":
      return "has_foster_youth";
    case "has_refugee_status":
      return "has_refugee_status";
    case "has_medical_need":
      return "has_medical_need";
    case "has_abd":
      return "has_abd";
    case "has_work_disruption":
      return "has_work_disruption";
    case "has_disaster_area":
      return "has_disaster_area";
    case "has_disaster_zip":
      return "has_disaster_zip";
    case "has_zip":
      return "has_zip";
    case "has_immigration_status":
      return "has_immigration_status";
    case "has_reopen_notify":
      return "has_reopen_notify";
    case "idle":
      return "finish";
    case "help_menu":
    case "awaiting_feedback":
    case "confirm_stop":
    case "confirm_erase":
      return null;
  }
}

export interface ScreenProgressMeta {
  seen: number;
  left: number;
  pct: number;
  location: ScreenLocationId;
  /** Time spent on the previous screen before this one was shown (ms). */
  prevDwellMs?: number;
  /** Tree location of the previous screen (when prevDwellMs is set). */
  prevLocation?: ScreenLocationId | null;
  /** Wall-clock from session start to this screen (ms); set on finish. */
  journeyMs?: number;
}

function percentThrough(seen: number, left: number): number {
  const denom = seen + left;
  if (denom <= 0) return 0;
  return Math.round((seen / denom) * 1000) / 10;
}

/**
 * Record a flow screen view for journey / dropout analytics.
 * Dedupes consecutive repeats of the same non-offer location (keyboard refreshes).
 */
export function trackExperienceScreen(session: SessionState): void {
  const location = treeLocationForStep(session.step);
  if (!location) return;

  if (!session.screensSeen) session.screensSeen = [];

  const program =
    location === "offer" ? (currentProgram(session)?.id ?? null) : null;
  const pathKey =
    location === "offer" && program ? `offer:${program}` : location;

  const last = session.screensSeen[session.screensSeen.length - 1];
  if (last === pathKey) return;

  const now = Date.now();
  const prevAt = session.screenShownAt
    ? Date.parse(session.screenShownAt)
    : Number.NaN;
  const prevDwellMs = Number.isFinite(prevAt)
    ? Math.max(0, now - prevAt)
    : null;
  const prevLocation = last
    ? last.startsWith("offer:")
      ? "offer"
      : isScreenLocation(last)
        ? last
        : null
    : null;
  const journeyStart = Date.parse(session.createdAt);
  const journeyMs = Number.isFinite(journeyStart)
    ? Math.max(0, now - journeyStart)
    : null;

  session.screensSeen.push(pathKey);
  session.screenShownAt = new Date(now).toISOString();
  const seen = session.screensSeen.length;
  const left =
    location === "finish" ? 0 : estimateMaxScreensRemaining(session);
  const pct = location === "finish" ? 100 : percentThrough(seen, left);

  recordEvent({
    eventType: "screen_view",
    source: "bot",
    telegramUserId: session.telegramUserId,
    campaignId: session.campaignId,
    programId: program,
    label: location,
    meta: {
      seen,
      left,
      pct,
      location,
      ...(prevDwellMs != null
        ? { prevDwellMs, prevLocation: prevLocation ?? last ?? null }
        : {}),
      ...(location === "finish" && journeyMs != null ? { journeyMs } : {}),
    },
  });
}

export function trackReportCreated(
  telegramUserId: number,
  campaignId?: string | null,
): void {
  recordEvent({
    eventType: "report_created",
    source: "bot",
    telegramUserId,
    campaignId: campaignId ?? null,
    label: "report_created",
  });
}

export interface ReportCounts {
  reportsCreated: number;
  reportRecipients: number;
}

export interface ScreenDropoutRow {
  id: ScreenLocationId;
  label: string;
  detail: string;
  /** Unique users who saw this tree location */
  reached: number;
  /** Users whose last recorded screen was here and who never finished */
  dropped: number;
  dropPct: number;
  /** reached / starters (0–100) */
  retentionPct: number;
  /** Mean screens-left estimate when this screen was shown */
  avgLeft: number;
  /** Mean percent-through when this screen was shown */
  avgPct: number;
}

export interface ScreenDropoutStats {
  starters: number;
  screens: ScreenDropoutRow[];
  biggestDropId: ScreenLocationId | null;
  biggestDropPct: number;
}

function parseMeta(raw: string | null): ScreenProgressMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ScreenProgressMeta>;
    if (
      typeof v.seen !== "number" ||
      typeof v.left !== "number" ||
      typeof v.pct !== "number" ||
      typeof v.location !== "string" ||
      !isScreenLocation(v.location)
    ) {
      return null;
    }
    return {
      seen: v.seen,
      left: v.left,
      pct: v.pct,
      location: v.location,
    };
  } catch {
    return null;
  }
}

export function countReports(events: AnalyticsEventRow[]): ReportCounts {
  const reports = events.filter((e) => e.event_type === "report_created");
  const reportUsers = new Set<number>();
  for (const e of reports) {
    if (e.telegram_user_id != null) reportUsers.add(e.telegram_user_id);
  }
  return {
    reportsCreated: reports.length,
    reportRecipients: reportUsers.size,
  };
}

export function buildScreenDropout(
  events: AnalyticsEventRow[],
): ScreenDropoutStats {
  const screenEvents = events.filter((e) => e.event_type === "screen_view");
  const starters = new Set<number>();
  for (const e of events) {
    if (e.event_type === "bot_start" && e.telegram_user_id != null) {
      starters.add(e.telegram_user_id);
    }
    if (e.event_type === "screen_view" && e.telegram_user_id != null) {
      starters.add(e.telegram_user_id);
    }
  }

  const reached = new Map<ScreenLocationId, Set<number>>();
  const leftSum = new Map<ScreenLocationId, number>();
  const pctSum = new Map<ScreenLocationId, number>();
  const samples = new Map<ScreenLocationId, number>();
  const lastByUser = new Map<number, ScreenLocationId>();
  const finished = new Set<number>();

  for (const loc of SCREEN_LOCATIONS) {
    reached.set(loc.id, new Set());
  }

  const ordered = [...screenEvents].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  for (const e of ordered) {
    if (e.telegram_user_id == null) continue;
    const loc =
      parseMeta(e.meta_json)?.location ??
      (isScreenLocation(e.label ?? "") ? (e.label as ScreenLocationId) : null);
    if (!loc) continue;
    reached.get(loc)?.add(e.telegram_user_id);
    lastByUser.set(e.telegram_user_id, loc);
    if (loc === "finish") finished.add(e.telegram_user_id);

    const meta = parseMeta(e.meta_json);
    if (meta) {
      leftSum.set(loc, (leftSum.get(loc) ?? 0) + meta.left);
      pctSum.set(loc, (pctSum.get(loc) ?? 0) + meta.pct);
      samples.set(loc, (samples.get(loc) ?? 0) + 1);
    }
  }

  const droppedAt = new Map<ScreenLocationId, number>();
  for (const loc of SCREEN_LOCATIONS) droppedAt.set(loc.id, 0);
  for (const [uid, loc] of lastByUser) {
    if (finished.has(uid)) continue;
    if (loc === "finish") continue;
    droppedAt.set(loc, (droppedAt.get(loc) ?? 0) + 1);
  }

  const starterCount = starters.size;
  let biggestDropId: ScreenLocationId | null = null;
  let biggestDropPct = 0;

  const screens: ScreenDropoutRow[] = SCREEN_LOCATIONS.map((meta) => {
    const r = reached.get(meta.id)?.size ?? 0;
    const d = droppedAt.get(meta.id) ?? 0;
    const dropPct = r === 0 ? 0 : Math.round((d / r) * 1000) / 10;
    const n = samples.get(meta.id) ?? 0;
    const avgLeft =
      n === 0 ? 0 : Math.round(((leftSum.get(meta.id) ?? 0) / n) * 10) / 10;
    const avgPct =
      n === 0 ? 0 : Math.round(((pctSum.get(meta.id) ?? 0) / n) * 10) / 10;
    if (
      r >= 3 &&
      dropPct > biggestDropPct &&
      meta.id !== "finish"
    ) {
      biggestDropPct = dropPct;
      biggestDropId = meta.id;
    }
    return {
      id: meta.id,
      label: meta.label,
      detail: meta.detail,
      reached: r,
      dropped: d,
      dropPct,
      retentionPct:
        starterCount === 0
          ? 0
          : Math.round((r / starterCount) * 1000) / 10,
      avgLeft,
      avgPct,
    };
  });

  return {
    starters: starterCount,
    screens,
    biggestDropId,
    biggestDropPct,
  };
}

/**
 * Gaps longer than this are treated as pauses (overnight / walked away),
 * not answering time. Used for per-question dwell and active time-to-finish.
 */
export const SCREEN_IDLE_MS = 30 * 60 * 1000;

export interface DurationStats {
  /** Journeys / answers included in the percentiles. */
  samples: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
}

export interface ScreenDwellRow extends DurationStats {
  id: ScreenLocationId;
  label: string;
  detail: string;
}

export interface ScreenTimingStats {
  /** Finishers with at least one countable answering interval. */
  finishers: number;
  /** Active time from first screen to Finish (idle gaps omitted). */
  journey: DurationStats;
  screens: ScreenDwellRow[];
  slowestId: ScreenLocationId | null;
  slowestMedianMs: number;
}

export function emptyScreenTiming(): ScreenTimingStats {
  return {
    finishers: 0,
    journey: { samples: 0, medianMs: 0, p90Ms: 0, meanMs: 0 },
    screens: [],
    slowestId: null,
    slowestMedianMs: 0,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return Math.round(sorted[0]!);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loV = sorted[lo]!;
  const hiV = sorted[hi]!;
  if (lo === hi) return Math.round(loV);
  return Math.round(loV + (hiV - loV) * (idx - lo));
}

function durationFrom(values: number[]): DurationStats {
  if (values.length === 0) {
    return { samples: 0, medianMs: 0, p90Ms: 0, meanMs: 0 };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p90Ms: percentile(values, 0.9),
    meanMs: Math.round(sum / values.length),
  };
}

function eventTimeMs(row: AnalyticsEventRow): number {
  const t = Date.parse(row.created_at);
  return Number.isFinite(t) ? t : 0;
}

function locationOfScreenEvent(row: AnalyticsEventRow): ScreenLocationId | null {
  return (
    parseMeta(row.meta_json)?.location ??
    (isScreenLocation(row.label ?? "") ? (row.label as ScreenLocationId) : null)
  );
}

/**
 * Per-question dwell and time-to-finish from consecutive screen_view timestamps.
 * Restarts at Opt-in after leaving it count as a new journey. Gaps over
 * SCREEN_IDLE_MS are dropped so overnight pauses do not inflate the stats.
 */
export function buildScreenTiming(
  events: AnalyticsEventRow[],
): ScreenTimingStats {
  const screenEvents = events
    .filter((e) => e.event_type === "screen_view" && e.telegram_user_id != null)
    .slice()
    .sort((a, b) => {
      const dt = a.created_at.localeCompare(b.created_at);
      return dt !== 0 ? dt : a.id - b.id;
    });

  const byUser = new Map<number, AnalyticsEventRow[]>();
  for (const e of screenEvents) {
    const uid = e.telegram_user_id!;
    const list = byUser.get(uid);
    if (list) list.push(e);
    else byUser.set(uid, [e]);
  }

  const dwellByLoc = new Map<ScreenLocationId, number[]>();
  for (const loc of SCREEN_LOCATIONS) dwellByLoc.set(loc.id, []);
  const journeyTimes: number[] = [];

  for (const rows of byUser.values()) {
    const journeys: AnalyticsEventRow[][] = [];
    let current: AnalyticsEventRow[] = [];
    for (const e of rows) {
      const loc = locationOfScreenEvent(e);
      if (!loc) continue;
      const prev = current[current.length - 1];
      const prevLoc = prev ? locationOfScreenEvent(prev) : null;
      if (prev && loc === "opt_in" && prevLoc !== "opt_in") {
        journeys.push(current);
        current = [e];
        continue;
      }
      current.push(e);
    }
    if (current.length) journeys.push(current);

    for (const journey of journeys) {
      let activeMs = 0;
      let finished = false;
      for (let i = 0; i < journey.length; i++) {
        const row = journey[i]!;
        const loc = locationOfScreenEvent(row);
        if (loc === "finish") finished = true;
        if (i >= journey.length - 1) continue;
        const next = journey[i + 1]!;
        const dt = eventTimeMs(next) - eventTimeMs(row);
        if (dt <= 0 || dt > SCREEN_IDLE_MS || !loc) continue;
        dwellByLoc.get(loc)?.push(dt);
        activeMs += dt;
      }
      if (finished && activeMs > 0) journeyTimes.push(activeMs);
    }
  }

  const journey = durationFrom(journeyTimes);
  let slowestId: ScreenLocationId | null = null;
  let slowestMedianMs = 0;

  const screens: ScreenDwellRow[] = SCREEN_LOCATIONS.map((meta) => {
    const values = dwellByLoc.get(meta.id) ?? [];
    const stats = durationFrom(values);
    if (
      stats.samples >= 3 &&
      stats.medianMs > slowestMedianMs &&
      meta.id !== "finish"
    ) {
      slowestMedianMs = stats.medianMs;
      slowestId = meta.id;
    }
    return {
      id: meta.id,
      label: meta.label,
      detail: meta.detail,
      ...stats,
    };
  });

  return {
    finishers: journey.samples,
    journey,
    screens,
    slowestId,
    slowestMedianMs,
  };
}
