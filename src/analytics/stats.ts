import { getProgram, loadPrograms } from "../corpus/load.js";
import { listEvents, type AnalyticsEventRow } from "./db.js";
import { getCampaign, loadCampaignsFile } from "./campaigns.js";
import { FUNNEL_STAGES, type FunnelStageId } from "./funnel.js";

export interface DailyCount {
  date: string;
  users: number;
  cumulative: number;
}

export interface ProgramStat {
  programId: string;
  name: string;
  category: string;
  opens: number;
  followThroughs: number;
  estAnnualUsd: number;
  estDollarsUnlocked: number;
}

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  count: number;
  kind: "qr" | "link" | "ip" | "mixed";
}

export interface FunnelStep {
  id: FunnelStageId;
  label: string;
  detail: string;
  count: number;
  /** Absolute drop from previous stage */
  dropOff: number;
  /** Percent lost from previous stage (0–100) */
  dropPct: number;
  /** Share of top-of-funnel still here (0–100) */
  retentionPct: number;
}

export interface FunnelStats {
  stages: FunnelStep[];
  /** Stage id entered *from* — where the largest absolute drop happens */
  biggestDropFrom: FunnelStageId | null;
  biggestDropTo: FunnelStageId | null;
  biggestDropCount: number;
  biggestDropPct: number;
}

export interface ImpactStats {
  generatedAt: string;
  peopleReached: number;
  qrScans: number;
  linkClicks: number;
  botStarts: number;
  programOpens: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  usersPerDay: DailyCount[];
  programs: ProgramStat[];
  mapPoints: MapPoint[];
  funnel: FunnelStats;
  disclaimer: string;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function estForProgram(programId: string): number {
  return getProgram(programId)?.estAnnualUsd ?? 0;
}

export function buildImpactStats(): ImpactStats {
  const events = listEvents();
  const awareness = events.filter((e) => e.event_type === "awareness");
  const qrScans = awareness.filter((e) => e.source === "qr").length;
  const linkClicks = awareness.filter((e) => e.source === "link").length;
  const peopleReached = awareness.length;
  const botStarts = events.filter((e) => e.event_type === "bot_start").length;
  const programOpens = events.filter((e) => e.event_type === "program_open").length;
  const followThroughs = events.filter((e) => e.event_type === "follow_through");

  let estDollarsUnlocked = 0;
  for (const e of followThroughs) {
    if (e.program_id) estDollarsUnlocked += estForProgram(e.program_id);
  }

  const usersPerDay = buildUsersPerDay(awareness);
  const programs = buildProgramStats(events);
  const mapPoints = buildMapPoints(awareness);
  const funnel = buildFunnel(events);

  return {
    generatedAt: new Date().toISOString(),
    peopleReached,
    qrScans,
    linkClicks,
    botStarts,
    programOpens,
    followThroughs: followThroughs.length,
    estDollarsUnlocked,
    usersPerDay,
    programs,
    mapPoints,
    funnel,
    disclaimer:
      "Estimates only. Dollar totals use corpus annual benefit estimates × follow-through taps — not verified agency payouts. Map shows QR placement sites and coarse city-level IP when available; never street addresses. Funnel counts unique Telegram users per stage (QR/link reach is event count).",
  };
}

function uniqueUsers(events: AnalyticsEventRow[]): number {
  const ids = new Set<number>();
  let anon = 0;
  for (const e of events) {
    if (e.telegram_user_id != null) ids.add(e.telegram_user_id);
    else anon += 1;
  }
  return ids.size + anon;
}

function buildFunnel(events: AnalyticsEventRow[]): FunnelStats {
  const byStage = new Map<FunnelStageId, number>();

  byStage.set(
    "reached",
    events.filter((e) => e.event_type === "awareness").length,
  );
  byStage.set(
    "bot_start",
    uniqueUsers(events.filter((e) => e.event_type === "bot_start")),
  );
  byStage.set(
    "apply_open",
    uniqueUsers(events.filter((e) => e.event_type === "program_open")),
  );
  byStage.set(
    "follow_through",
    uniqueUsers(events.filter((e) => e.event_type === "follow_through")),
  );

  const funnelEvents = events.filter((e) => e.event_type === "funnel" && e.label);
  for (const stage of FUNNEL_STAGES) {
    if (
      stage.id === "reached" ||
      stage.id === "bot_start" ||
      stage.id === "apply_open" ||
      stage.id === "follow_through"
    ) {
      continue;
    }
    byStage.set(
      stage.id,
      uniqueUsers(funnelEvents.filter((e) => e.label === stage.id)),
    );
  }

  const stages: FunnelStep[] = [];
  let prev = 0;
  let top = 0;
  let biggestDropFrom: FunnelStageId | null = null;
  let biggestDropTo: FunnelStageId | null = null;
  let biggestDropCount = 0;
  let biggestDropPct = 0;

  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const meta = FUNNEL_STAGES[i]!;
    const count = byStage.get(meta.id) ?? 0;
    if (i === 0) top = count;
    const dropOff = i === 0 ? 0 : Math.max(0, prev - count);
    const dropPct = i === 0 || prev === 0 ? 0 : Math.round((dropOff / prev) * 1000) / 10;
    const retentionPct = top === 0 ? 0 : Math.round((count / top) * 1000) / 10;

    // Prefer steepest % drop (where the tree leaks); break ties by absolute count
    if (
      i > 0 &&
      dropOff > 0 &&
      (dropPct > biggestDropPct ||
        (dropPct === biggestDropPct && dropOff > biggestDropCount))
    ) {
      biggestDropCount = dropOff;
      biggestDropPct = dropPct;
      biggestDropFrom = FUNNEL_STAGES[i - 1]!.id;
      biggestDropTo = meta.id;
    }

    stages.push({
      id: meta.id,
      label: meta.label,
      detail: meta.detail,
      count,
      dropOff,
      dropPct,
      retentionPct,
    });
    prev = count;
  }

  return {
    stages,
    biggestDropFrom,
    biggestDropTo,
    biggestDropCount,
    biggestDropPct,
  };
}

function buildUsersPerDay(awareness: AnalyticsEventRow[]): DailyCount[] {
  const byDay = new Map<string, number>();
  for (const e of awareness) {
    const d = dayKey(e.created_at);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const days = [...byDay.keys()].sort();
  let cumulative = 0;
  return days.map((date) => {
    const users = byDay.get(date) ?? 0;
    cumulative += users;
    return { date, users, cumulative };
  });
}

function buildProgramStats(events: AnalyticsEventRow[]): ProgramStat[] {
  const opens = new Map<string, number>();
  const follows = new Map<string, number>();
  for (const e of events) {
    if (!e.program_id) continue;
    if (e.event_type === "program_open") {
      opens.set(e.program_id, (opens.get(e.program_id) ?? 0) + 1);
    }
    if (e.event_type === "follow_through") {
      follows.set(e.program_id, (follows.get(e.program_id) ?? 0) + 1);
    }
  }

  const ids = new Set([...opens.keys(), ...follows.keys(), ...loadPrograms().map((p) => p.id)]);
  const rows: ProgramStat[] = [];
  for (const id of ids) {
    const program = getProgram(id);
    const openCount = opens.get(id) ?? 0;
    const followCount = follows.get(id) ?? 0;
    const estAnnualUsd = program?.estAnnualUsd ?? 0;
    rows.push({
      programId: id,
      name: program?.name ?? id,
      category: program?.category ?? "other",
      opens: openCount,
      followThroughs: followCount,
      estAnnualUsd,
      estDollarsUnlocked: followCount * estAnnualUsd,
    });
  }
  rows.sort((a, b) => b.opens - a.opens || b.followThroughs - a.followThroughs || a.name.localeCompare(b.name));
  return rows;
}

function buildMapPoints(awareness: AnalyticsEventRow[]): MapPoint[] {
  const buckets = new Map<string, MapPoint>();

  for (const e of awareness) {
    let lat = e.lat;
    let lng = e.lng;
    let label = e.label;
    let kind: MapPoint["kind"] = e.source === "qr" ? "qr" : e.source === "link" ? "link" : "ip";

    if ((lat == null || lng == null) && e.campaign_id) {
      const c = getCampaign(e.campaign_id);
      if (c?.lat != null && c.lng != null) {
        lat = c.lat;
        lng = c.lng;
        label = c.label ?? c.name;
        kind = c.kind === "qr" ? "qr" : "link";
      }
    }

    if (lat == null || lng == null) continue;
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.kind !== kind) existing.kind = "mixed";
    } else {
      buckets.set(key, {
        lat,
        lng,
        label: label ?? "Unknown area",
        count: 1,
        kind,
      });
    }
  }

  // Ensure known QR placements appear even with zero scans (ghost pins for demo context)
  for (const c of loadCampaignsFile().campaigns) {
    if (c.kind !== "qr" || c.lat == null || c.lng == null) continue;
    const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        lat: c.lat,
        lng: c.lng,
        label: `${c.name} (no scans yet)`,
        count: 0,
        kind: "qr",
      });
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}
