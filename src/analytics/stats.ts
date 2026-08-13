import { getProgram, loadPrograms } from "../library/load.js";
import { countPartnerFeedbackMetrics } from "../feedback/todos.js";
import { listEvents, type AnalyticsEventRow } from "./db.js";
import { getCampaign, loadCampaignsFile } from "./campaigns.js";
import { FUNNEL_STAGES, type FunnelStageId } from "./funnel.js";
import {
  buildJourneyProgress,
  buildScreenDropout,
  buildScreenTiming,
  emptyScreenTiming,
  type JourneyProgressStats,
  type ScreenDropoutStats,
  type ScreenTimingStats,
} from "./screens.js";
import { reachChannelForCampaign, type ReachChannel } from "./channels.js";
import { isPeerShareCampaignId } from "./peerShare.js";
import {
  getPartnerBySlug,
  listLeaderboardPartners,
  listPartners,
  type Partner,
} from "./partners.js";
import { getSignedUpPartnerBySlug } from "../partners/db.js";
import {
  campaignIdsForPartner,
  getPartnerEventBySlug,
  listPartnerEventsByPartnerSlug,
  type PartnerEvent,
} from "../partners/events.js";

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
  /** Stage id entered *from* – where the largest absolute drop happens */
  biggestDropFrom: FunnelStageId | null;
  biggestDropTo: FunnelStageId | null;
  biggestDropCount: number;
  biggestDropPct: number;
}

export type StatsSource = "demo" | "live";

export interface ReachChannelStats {
  peopleReached: number;
  botStarts: number;
  followThroughs: number;
  estDollarsUnlocked: number;
}

export interface ChannelDailyCount {
  date: string;
  organizations: number;
  friends: number;
  website: number;
}

export interface SharingStats {
  /** Unique people who opened Share in the bot. */
  peopleWhoShared: number;
  /** Landings from friend-share links / QRs (including individual partner QRs). */
  friendClicks: number;
  /** Distinct friend-share codes that received at least one click. */
  activeSharers: number;
  /** Friend-link clicks per person who shared (0 if nobody shared). */
  clicksPerSharer: number;
  organizations: ReachChannelStats;
  friends: ReachChannelStats;
  website: ReachChannelStats;
  usersPerDayByChannel: ChannelDailyCount[];
}

export interface ImpactStats {
  generatedAt: string;
  /** Which dataset the public site is currently serving. */
  statsSource: StatsSource;
  peopleReached: number;
  qrScans: number;
  linkClicks: number;
  botStarts: number;
  programOpens: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  sharing: SharingStats;
  /** Series shown on the charts (demo sample or live). */
  usersPerDay: DailyCount[];
  /** Always the live analytics series – kept so we can flip back later. */
  usersPerDayLive: DailyCount[];
  /** @deprecated Use statsSource – "sample" means demo charts. */
  chartSeriesSource: "sample" | "live";
  programs: ProgramStat[];
  mapPoints: MapPoint[];
  funnel: FunnelStats;
  /** Application Guide PDFs delivered (live only; 0 in demo). */
  reportsCreated: number;
  /** Unique people who received at least one PDF (live only). */
  reportRecipients: number;
  /** Percent-through / dropout bands from screen_view events (live). */
  journey: JourneyProgressStats;
  /** Per tree-location dropout for developer feedback (live). */
  screenDropout: ScreenDropoutStats;
  /** Time-on-question + time-to-finish for developer UX (live). */
  screenTiming: ScreenTimingStats;
  disclaimer: string;
}

/**
 * Default public-site stats mode. Env `IMPACT_STATS_MODE=demo|live` overrides.
 * Demo = staged “fully running” numbers for funders; live = collected events
 * (operator Telegram ids excluded). Say “switch website to live data” to flip.
 */
export const DEFAULT_IMPACT_STATS_MODE: StatsSource = "demo";

/** @deprecated Use DEFAULT_IMPACT_STATS_MODE / impactStatsMode(). */
export const USE_SAMPLE_CHART_SERIES = DEFAULT_IMPACT_STATS_MODE === "demo";

export function impactStatsMode(): StatsSource {
  const env = process.env.IMPACT_STATS_MODE?.trim().toLowerCase();
  if (env === "live" || env === "demo") return env;
  return DEFAULT_IMPACT_STATS_MODE;
}

/** Telegram user ids excluded from live rollups (comma/space-separated). */
export function operatorTelegramUserIds(): Set<number> {
  const ids = new Set<number>();
  const raw = process.env.OPERATOR_TELEGRAM_USER_IDS ?? "";
  for (const part of raw.split(/[,\s]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isFinite(n) && n > 0) ids.add(Math.trunc(n));
  }
  // Private chats: chat id === user id
  const devChat = Number(process.env.DEVELOPER_TELEGRAM_CHAT_ID ?? "");
  if (Number.isFinite(devChat) && devChat > 0) ids.add(Math.trunc(devChat));
  return ids;
}

/** Live events with operator Telegram traffic stripped. */
export function listEventsForStats(): AnalyticsEventRow[] {
  const exclude = operatorTelegramUserIds();
  const all = listEvents();
  if (exclude.size === 0) return all;
  return all.filter(
    (e) => e.telegram_user_id == null || !exclude.has(e.telegram_user_id),
  );
}

const SAMPLE_CHART_DAYS = 90;

/** Relative activity profiles for known partners (matches leaderboard feel). */
const PARTNER_SAMPLE_PROFILES: Record<
  string,
  { base: number; growth: number; startOffsetDays: number }
> = {
  "fresno-food-bank": { base: 18, growth: 0.12, startOffsetDays: 0 },
  "oakland-library": { base: 13, growth: 0.09, startOffsetDays: 8 },
  "la-family-resource": { base: 11, growth: 0.07, startOffsetDays: 14 },
  "mission-community": { base: 8, growth: 0.06, startOffsetDays: 22 },
  website: { base: 5, growth: 0.045, startOffsetDays: 10 },
};

/** Demo program mix – weighted opens once the funnel is “at scale”. */
const DEMO_PROGRAM_WEIGHTS: { id: string; weight: number }[] = [
  { id: "calfresh", weight: 22 },
  { id: "medi_cal", weight: 18 },
  { id: "lifeline", weight: 14 },
  { id: "care", weight: 12 },
  { id: "liheap", weight: 10 },
  { id: "wic", weight: 8 },
  { id: "tax_credits", weight: 7 },
  { id: "esa", weight: 5 },
  { id: "caleitc", weight: 4 },
];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localDayKey(daysAgo: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sampleProfileForSlug(slug: string): {
  base: number;
  growth: number;
  startOffsetDays: number;
} {
  const known = PARTNER_SAMPLE_PROFILES[slug];
  if (known) return known;
  const rnd = mulberry32(hashSeed(`partner:${slug}`));
  return {
    base: 3 + Math.floor(rnd() * 5),
    growth: 0.03 + rnd() * 0.04,
    startOffsetDays: 20 + Math.floor(rnd() * 40),
  };
}

/** Deterministic daily series for one partner over SAMPLE_CHART_DAYS. */
export function buildSamplePartnerUsersPerDay(slug: string): DailyCount[] {
  const profile = sampleProfileForSlug(slug);
  const rnd = mulberry32(hashSeed(`series:${slug}`));
  const out: DailyCount[] = [];
  let cumulative = 0;

  for (let ago = SAMPLE_CHART_DAYS - 1; ago >= 0; ago--) {
    const dayIndex = SAMPLE_CHART_DAYS - 1 - ago;
    const date = localDayKey(ago);
    if (dayIndex < profile.startOffsetDays) {
      out.push({ date, users: 0, cumulative });
      continue;
    }
    const activeDay = dayIndex - profile.startOffsetDays;
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.55 : 1;
    const ramp = 1 + profile.growth * Math.sqrt(activeDay);
    const noise = 0.75 + rnd() * 0.5;
    // Gentle mid-period dip, stronger late growth (outreach events)
    const wave = 1 + 0.15 * Math.sin(activeDay / 11);
    const eventBoost =
      activeDay > 0 && activeDay % 23 === 0 ? 1.8 + rnd() * 0.6 : 1;
    const users = Math.max(
      0,
      Math.round(profile.base * ramp * weekendFactor * noise * wave * eventBoost),
    );
    cumulative += users;
    out.push({ date, users, cumulative });
  }
  return out;
}

/** Site-wide sample: sum of partner series + modest non-partner link traffic. */
export function buildSampleImpactUsersPerDay(): DailyCount[] {
  const partners = listPartners();
  const seriesList = partners.map((p) => buildSamplePartnerUsersPerDay(p.slug));
  const linkRnd = mulberry32(hashSeed("link-traffic"));
  const byDate = new Map<string, number>();

  for (const series of seriesList) {
    for (const d of series) {
      byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.users);
    }
  }

  // Shared date spine even if there are no partners yet
  for (let ago = SAMPLE_CHART_DAYS - 1; ago >= 0; ago--) {
    const date = localDayKey(ago);
    if (!byDate.has(date)) byDate.set(date, 0);
  }

  const days = [...byDate.keys()].sort();
  let cumulative = 0;
  return days.map((date, i) => {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.6 : 1;
    const linkUsers = Math.max(
      0,
      Math.round((2 + i * 0.04) * weekendFactor * (0.7 + linkRnd() * 0.6)),
    );
    const users = (byDate.get(date) ?? 0) + linkUsers;
    cumulative += users;
    return { date, users, cumulative };
  });
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function estForProgram(programId: string): number {
  return getProgram(programId)?.estAnnualUsd ?? 0;
}

const IMPACT_DISCLAIMER =
  "Estimates only. Dollar totals use library annual benefit estimates × follow-through taps – not verified agency payouts. Map shows QR placement sites and coarse city-level IP when available; never street addresses. Funnel counts unique people per stage (QR/link reach is event count). Friend-share links use anonymous per-person codes – we count clicks, not names.";

function seriesTotal(series: DailyCount[]): number {
  return series.length ? series[series.length - 1]!.cumulative : 0;
}

function funnelFromStageCounts(counts: Map<FunnelStageId, number>): FunnelStats {
  const stages: FunnelStep[] = [];
  let prev = 0;
  let top = 0;
  let biggestDropFrom: FunnelStageId | null = null;
  let biggestDropTo: FunnelStageId | null = null;
  let biggestDropCount = 0;
  let biggestDropPct = 0;

  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const meta = FUNNEL_STAGES[i]!;
    const count = counts.get(meta.id) ?? 0;
    if (i === 0) top = count;
    const dropOff = i === 0 ? 0 : Math.max(0, prev - count);
    const dropPct = i === 0 || prev === 0 ? 0 : Math.round((dropOff / prev) * 1000) / 10;
    const retentionPct = top === 0 ? 0 : Math.round((count / top) * 1000) / 10;

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

function buildDemoProgramStats(programOpens: number, followThroughs: number): ProgramStat[] {
  const weightTotal = DEMO_PROGRAM_WEIGHTS.reduce((s, p) => s + p.weight, 0);
  const rnd = mulberry32(hashSeed("demo-programs"));
  const rows: ProgramStat[] = [];
  let opensLeft = programOpens;
  let followsLeft = followThroughs;

  for (let i = 0; i < DEMO_PROGRAM_WEIGHTS.length; i++) {
    const { id, weight } = DEMO_PROGRAM_WEIGHTS[i]!;
    const program = getProgram(id);
    const share = weight / weightTotal;
    const isLast = i === DEMO_PROGRAM_WEIGHTS.length - 1;
    const opens = isLast
      ? opensLeft
      : Math.max(0, Math.round(programOpens * share * (0.85 + rnd() * 0.3)));
    const follows = isLast
      ? followsLeft
      : Math.min(
          opens,
          Math.max(0, Math.round(followThroughs * share * (0.85 + rnd() * 0.3))),
        );
    opensLeft = Math.max(0, opensLeft - opens);
    followsLeft = Math.max(0, followsLeft - follows);
    const estAnnualUsd = program?.estAnnualUsd ?? 0;
    rows.push({
      programId: id,
      name: program?.name ?? id,
      category: program?.category ?? "other",
      opens,
      followThroughs: follows,
      estAnnualUsd,
      estDollarsUnlocked: follows * estAnnualUsd,
    });
  }

  const seen = new Set(rows.map((r) => r.programId));
  for (const program of loadPrograms()) {
    if (seen.has(program.id)) continue;
    rows.push({
      programId: program.id,
      name: program.name,
      category: program.category,
      opens: 0,
      followThroughs: 0,
      estAnnualUsd: program.estAnnualUsd ?? 0,
      estDollarsUnlocked: 0,
    });
  }

  rows.sort(
    (a, b) =>
      b.opens - a.opens ||
      b.followThroughs - a.followThroughs ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

function buildDemoMapPoints(): MapPoint[] {
  const points: MapPoint[] = [];
  for (const partner of listLeaderboardPartners()) {
    const campaign = getCampaign(partner.campaignId);
    if (campaign?.lat == null || campaign.lng == null) continue;
    const reached = seriesTotal(buildSamplePartnerUsersPerDay(partner.slug));
    points.push({
      lat: campaign.lat,
      lng: campaign.lng,
      label: campaign.label ?? partner.name,
      count: reached,
      kind: campaign.kind === "qr" ? "qr" : "link",
    });
  }
  // A few coarse city IP dots so the map looks lived-in beyond poster pins
  const ipDots: MapPoint[] = [
    { lat: 38.58, lng: -121.49, label: "Sacramento, CA", count: 42, kind: "ip" },
    { lat: 32.72, lng: -117.16, label: "San Diego, CA", count: 31, kind: "ip" },
    { lat: 37.34, lng: -121.89, label: "San Jose, CA", count: 27, kind: "ip" },
  ];
  points.push(...ipDots);
  return points.sort((a, b) => b.count - a.count);
}

function buildDemoFunnel(peopleReached: number, botStarts: number, programOpens: number, followThroughs: number): FunnelStats {
  const counts = new Map<FunnelStageId, number>();
  counts.set("reached", peopleReached);
  counts.set("bot_start", botStarts);
  counts.set("started", Math.round(botStarts * 0.86));
  counts.set("gate_done", Math.round(botStarts * 0.74));
  counts.set("triage_done", Math.round(botStarts * 0.62));
  // Intentionally steep drop into apply (matches /dev funnel story)
  const firstOffer = Math.max(programOpens, Math.round(botStarts * 0.56));
  counts.set("first_offer", firstOffer);
  counts.set("apply_open", programOpens);
  counts.set("follow_through", followThroughs);
  counts.set("finished", Math.round(followThroughs * 0.72));
  counts.set("report_created", Math.round(followThroughs * 0.58));
  return funnelFromStageCounts(counts);
}

function emptyChannelStats(): ReachChannelStats {
  return {
    peopleReached: 0,
    botStarts: 0,
    followThroughs: 0,
    estDollarsUnlocked: 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function splitByChannelShare(
  total: number,
  orgN: number,
  friendN: number,
  websiteN: number,
): { organizations: number; friends: number; website: number } {
  const denom = orgN + friendN + websiteN;
  if (total <= 0 || denom <= 0) {
    return { organizations: 0, friends: 0, website: 0 };
  }
  const organizations = Math.round((total * orgN) / denom);
  const friends = Math.round((total * friendN) / denom);
  const website = Math.max(0, total - organizations - friends);
  return { organizations, friends, website };
}

/** Demo: friend shares start small and proliferate; orgs stay the larger channel. */
function splitSampleUsersPerDay(usersPerDay: DailyCount[]): ChannelDailyCount[] {
  const rnd = mulberry32(hashSeed("channel-split"));
  const n = usersPerDay.length;
  return usersPerDay.map((d, i) => {
    const t = n <= 1 ? 1 : i / (n - 1);
    const friendsShare = 0.08 + 0.2 * t * t;
    const websiteShare = 0.07 - 0.02 * t;
    const users = d.users;
    let friends = Math.round(users * friendsShare * (0.88 + rnd() * 0.24));
    let website = Math.round(users * websiteShare * (0.88 + rnd() * 0.24));
    friends = Math.max(0, Math.min(friends, users));
    website = Math.max(0, Math.min(website, users - friends));
    const organizations = Math.max(0, users - friends - website);
    return { date: d.date, organizations, friends, website };
  });
}

function sumChannelDays(days: ChannelDailyCount[], key: Exclude<ReachChannel, "other">): number {
  return days.reduce((s, d) => s + d[key], 0);
}

function scaleChannelStats(
  people: { organizations: number; friends: number; website: number },
  botStarts: number,
  followThroughs: number,
  estDollarsUnlocked: number,
): Pick<SharingStats, "organizations" | "friends" | "website"> {
  const bots = splitByChannelShare(
    botStarts,
    people.organizations,
    people.friends,
    people.website,
  );
  const follows = splitByChannelShare(
    followThroughs,
    people.organizations,
    people.friends,
    people.website,
  );
  const dollars = splitByChannelShare(
    estDollarsUnlocked,
    people.organizations,
    people.friends,
    people.website,
  );
  return {
    organizations: {
      peopleReached: people.organizations,
      botStarts: bots.organizations,
      followThroughs: follows.organizations,
      estDollarsUnlocked: dollars.organizations,
    },
    friends: {
      peopleReached: people.friends,
      botStarts: bots.friends,
      followThroughs: follows.friends,
      estDollarsUnlocked: dollars.friends,
    },
    website: {
      peopleReached: people.website,
      botStarts: bots.website,
      followThroughs: follows.website,
      estDollarsUnlocked: dollars.website,
    },
  };
}

function buildDemoSharingStats(
  usersPerDay: DailyCount[],
  botStarts: number,
  followThroughs: number,
  estDollarsUnlocked: number,
): SharingStats {
  const usersPerDayByChannel = splitSampleUsersPerDay(usersPerDay);
  const people = {
    organizations: sumChannelDays(usersPerDayByChannel, "organizations"),
    friends: sumChannelDays(usersPerDayByChannel, "friends"),
    website: sumChannelDays(usersPerDayByChannel, "website"),
  };
  const peopleWhoShared = Math.max(1, Math.round(people.friends / 1.6));
  return {
    peopleWhoShared,
    friendClicks: people.friends,
    activeSharers: Math.max(1, Math.round(peopleWhoShared * 0.62)),
    clicksPerSharer: round1(people.friends / peopleWhoShared),
    ...scaleChannelStats(people, botStarts, followThroughs, estDollarsUnlocked),
    usersPerDayByChannel,
  };
}

function channelOfEvent(
  e: AnalyticsEventRow,
  userCampaign: Map<number, string>,
): ReachChannel {
  if (e.campaign_id) return reachChannelForCampaign(e.campaign_id);
  if (e.telegram_user_id != null) {
    return reachChannelForCampaign(userCampaign.get(e.telegram_user_id) ?? null);
  }
  return "other";
}

function buildLiveSharingStats(
  events: AnalyticsEventRow[],
  userCampaign: Map<number, string>,
): SharingStats {
  const shareOut = events.filter((e) => e.event_type === "share_out");
  const awareness = events.filter((e) => e.event_type === "awareness");
  const botStarts = events.filter((e) => e.event_type === "bot_start");
  const followThroughs = events.filter((e) => e.event_type === "follow_through");

  const channels: Record<Exclude<ReachChannel, "other">, ReachChannelStats> = {
    organizations: emptyChannelStats(),
    friends: emptyChannelStats(),
    website: emptyChannelStats(),
  };

  const addReached = (channel: ReachChannel) => {
    if (channel === "other") return;
    channels[channel].peopleReached += 1;
  };
  for (const e of awareness) {
    addReached(reachChannelForCampaign(e.campaign_id));
  }

  const addUnique = (
    key: "botStarts" | "followThroughs",
    list: AnalyticsEventRow[],
  ) => {
    const seen: Record<Exclude<ReachChannel, "other">, Set<string>> = {
      organizations: new Set(),
      friends: new Set(),
      website: new Set(),
    };
    for (const e of list) {
      const channel = channelOfEvent(e, userCampaign);
      if (channel === "other") continue;
      const id =
        e.telegram_user_id != null ? `u:${e.telegram_user_id}` : `a:${e.id}`;
      if (seen[channel].has(id)) continue;
      seen[channel].add(id);
      channels[channel][key] += 1;
    }
  };
  addUnique("botStarts", botStarts);
  addUnique("followThroughs", followThroughs);

  for (const e of followThroughs) {
    const channel = channelOfEvent(e, userCampaign);
    if (channel === "other" || !e.program_id) continue;
    channels[channel].estDollarsUnlocked += estForProgram(e.program_id);
  }

  const friendAwareness = awareness.filter((e) =>
    isPeerShareCampaignId(e.campaign_id),
  );
  // Share-button landings only (individual partner QRs still count on the Friends card).
  const friendClicks = friendAwareness.length;
  const activeSharers = new Set(
    friendAwareness
      .map((e) => e.campaign_id)
      .filter((id): id is string => Boolean(id)),
  ).size;
  const peopleWhoShared = uniqueUsers(shareOut);
  const sharerBase = peopleWhoShared || activeSharers;

  const byDay = new Map<string, ChannelDailyCount>();
  for (const e of awareness) {
    const date = dayKey(e.created_at);
    let row = byDay.get(date);
    if (!row) {
      row = { date, organizations: 0, friends: 0, website: 0 };
      byDay.set(date, row);
    }
    const channel = reachChannelForCampaign(e.campaign_id);
    if (channel !== "other") row[channel] += 1;
  }
  const usersPerDayByChannel = [...byDay.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    peopleWhoShared,
    friendClicks,
    activeSharers,
    clicksPerSharer: sharerBase === 0 ? 0 : round1(friendClicks / sharerBase),
    organizations: channels.organizations,
    friends: channels.friends,
    website: channels.website,
    usersPerDayByChannel,
  };
}

function emptyJourney(): JourneyProgressStats {
  return {
    starters: 0,
    finishers: 0,
    reportsCreated: 0,
    reportRecipients: 0,
    buckets: [],
    avgPctThrough: 0,
  };
}

function emptyScreenDropout(): ScreenDropoutStats {
  return {
    starters: 0,
    screens: [],
    biggestDropId: null,
    biggestDropPct: 0,
  };
}

function buildDemoImpactStats(usersPerDayLive: DailyCount[]): ImpactStats {
  const usersPerDay = buildSampleImpactUsersPerDay();
  const peopleReached = seriesTotal(usersPerDay);
  const qrScans = Math.round(peopleReached * 0.84);
  const linkClicks = Math.max(0, peopleReached - qrScans);
  const botStarts = Math.round(peopleReached * 0.68);
  const programOpens = Math.round(botStarts * 0.4);
  const followThroughs = Math.round(programOpens * 0.58);
  const programs = buildDemoProgramStats(programOpens, followThroughs);
  const estDollarsUnlocked = programs.reduce((s, p) => s + p.estDollarsUnlocked, 0);

  const reportsCreated = Math.round(followThroughs * 0.58);
  const sharing = buildDemoSharingStats(
    usersPerDay,
    botStarts,
    followThroughs,
    estDollarsUnlocked,
  );
  return {
    generatedAt: new Date().toISOString(),
    statsSource: "demo",
    peopleReached,
    qrScans,
    linkClicks,
    botStarts,
    programOpens,
    followThroughs,
    estDollarsUnlocked,
    sharing,
    usersPerDay,
    usersPerDayLive,
    chartSeriesSource: "sample",
    programs,
    mapPoints: buildDemoMapPoints(),
    funnel: buildDemoFunnel(peopleReached, botStarts, programOpens, followThroughs),
    reportsCreated,
    reportRecipients: reportsCreated,
    journey: emptyJourney(),
    screenDropout: emptyScreenDropout(),
    screenTiming: emptyScreenTiming(),
    disclaimer: IMPACT_DISCLAIMER,
  };
}

function buildLiveImpactStats(events: AnalyticsEventRow[]): ImpactStats {
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

  const usersPerDayLive = buildUsersPerDay(awareness);
  const journey = buildJourneyProgress(events);
  const screenDropout = buildScreenDropout(events);
  const screenTiming = buildScreenTiming(events);
  const sharing = buildLiveSharingStats(events, firstBotStartCampaignByUser(events));

  return {
    generatedAt: new Date().toISOString(),
    statsSource: "live",
    peopleReached,
    qrScans,
    linkClicks,
    botStarts,
    programOpens,
    followThroughs: followThroughs.length,
    estDollarsUnlocked,
    sharing,
    usersPerDay: usersPerDayLive,
    usersPerDayLive,
    chartSeriesSource: "live",
    programs: buildProgramStats(events),
    mapPoints: buildMapPoints(awareness),
    funnel: buildFunnel(events),
    reportsCreated: journey.reportsCreated,
    reportRecipients: journey.reportRecipients,
    journey,
    screenDropout,
    screenTiming,
    disclaimer: IMPACT_DISCLAIMER,
  };
}

/**
 * Public-site stats (demo or live per IMPACT_STATS_MODE).
 * Pass `{ source: "live" }` for operator tools that must ignore the funder demo set.
 */
export function buildImpactStats(opts?: { source?: StatsSource }): ImpactStats {
  const events = listEventsForStats();
  const awareness = events.filter((e) => e.event_type === "awareness");
  const usersPerDayLive = buildUsersPerDay(awareness);
  const mode = opts?.source ?? impactStatsMode();
  if (mode === "demo") {
    return buildDemoImpactStats(usersPerDayLive);
  }
  return buildLiveImpactStats(events);
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
  byStage.set(
    "report_created",
    uniqueUsers(events.filter((e) => e.event_type === "report_created")),
  );

  const funnelEvents = events.filter((e) => e.event_type === "funnel" && e.label);
  for (const stage of FUNNEL_STAGES) {
    if (
      stage.id === "reached" ||
      stage.id === "bot_start" ||
      stage.id === "apply_open" ||
      stage.id === "follow_through" ||
      stage.id === "report_created"
    ) {
      continue;
    }
    byStage.set(
      stage.id,
      uniqueUsers(funnelEvents.filter((e) => e.label === stage.id)),
    );
  }

  return funnelFromStageCounts(byStage);
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

function buildMapPoints(
  awareness: AnalyticsEventRow[],
  opts?: { ghostPins?: boolean },
): MapPoint[] {
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
  if (opts?.ghostPins === false) {
    return [...buckets.values()].sort((a, b) => b.count - a.count);
  }
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

export interface PartnerLeaderboardRow {
  rank: number;
  id: string;
  slug: string;
  name: string;
  city: string;
  logo: string;
  blurb: string;
  campaignId: string;
  accountType: "organization" | "individual";
  emailDomain: string;
  emailVerified: boolean;
  peopleReached: number;
  botStarts: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  /** Feedback submissions that still have ≥1 credited (non-disqualified) ticket. */
  feedbackMessages: number;
  /** Dev tickets created from feedback; disqualified tickets are excluded. */
  feedbackTickets: number;
}

export interface PartnerStats {
  generatedAt: string;
  statsSource: StatsSource;
  partner: {
    id: string;
    slug: string;
    name: string;
    city: string;
    logo: string;
    blurb: string;
    campaignId: string;
    accountType: "organization" | "individual";
    emailDomain: string;
    emailVerified: boolean;
  };
  /** True for live signups (editable profile); false for library demo partners. */
  editable: boolean;
  peopleReached: number;
  botStarts: number;
  programOpens: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  feedbackMessages: number;
  feedbackTickets: number;
  usersPerDay: DailyCount[];
  usersPerDayLive: DailyCount[];
  /** @deprecated Use statsSource – "sample" means demo charts. */
  chartSeriesSource: "sample" | "live";
  mapPoints: MapPoint[];
  programs: ProgramStat[];
  disclaimer: string;
}

const PARTNER_DISCLAIMER =
  "Partner stats credit people reached via this partner’s unique QR code and any event QR codes they generate. Downstream metrics use session attribution from those QRs. Feedback tickets come from this page’s feedback box and from testers who started via a partner or event QR; disqualified tickets are removed from the tally. Estimates only – not verified agency payouts.";

const EVENT_DISCLAIMER =
  "Event stats count scans of this event’s QR code. Those same scans still credit the parent partner on the public community leaderboard. Estimates only – not verified agency payouts.";

/** Map telegram users → first bot_start campaign (sticky attribution fallback). */
function firstBotStartCampaignByUser(
  events: AnalyticsEventRow[],
): Map<number, string> {
  const map = new Map<number, string>();
  const starts = events
    .filter((e) => e.event_type === "bot_start" && e.telegram_user_id != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const e of starts) {
    const uid = e.telegram_user_id!;
    if (map.has(uid)) continue;
    if (e.campaign_id) map.set(uid, e.campaign_id);
  }
  return map;
}

function eventMatchesCampaignSet(
  e: AnalyticsEventRow,
  campaignIds: Set<string>,
  userCampaign: Map<number, string>,
): boolean {
  if (e.campaign_id && campaignIds.has(e.campaign_id)) return true;
  if (e.telegram_user_id != null) {
    const cid = userCampaign.get(e.telegram_user_id);
    return Boolean(cid && campaignIds.has(cid));
  }
  return false;
}

function campaignIdSetForPartner(partner: Partner): Set<string> {
  return new Set(campaignIdsForPartner(partner));
}

function rollupCampaignSet(
  campaignIds: Set<string>,
  events: AnalyticsEventRow[],
  userCampaign: Map<number, string>,
): {
  peopleReached: number;
  botStarts: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  feedbackMessages: number;
  feedbackTickets: number;
} {
  const awareness = events.filter(
    (e) =>
      e.event_type === "awareness" &&
      e.campaign_id != null &&
      campaignIds.has(e.campaign_id),
  );
  const botStarts = events.filter(
    (e) =>
      e.event_type === "bot_start" &&
      eventMatchesCampaignSet(e, campaignIds, userCampaign),
  );
  const followThroughs = events.filter(
    (e) =>
      e.event_type === "follow_through" &&
      eventMatchesCampaignSet(e, campaignIds, userCampaign),
  );
  let estDollarsUnlocked = 0;
  for (const e of followThroughs) {
    if (e.program_id) estDollarsUnlocked += estForProgram(e.program_id);
  }
  const feedback = countPartnerFeedbackMetrics([...campaignIds]);
  return {
    peopleReached: awareness.length,
    botStarts: uniqueUsers(botStarts),
    followThroughs: uniqueUsers(followThroughs),
    estDollarsUnlocked,
    feedbackMessages: feedback.feedbackMessages,
    feedbackTickets: feedback.feedbackTickets,
  };
}

function rollupPartner(
  partner: Partner,
  events: AnalyticsEventRow[],
  userCampaign: Map<number, string>,
): Omit<PartnerLeaderboardRow, "rank"> {
  const summary = rollupCampaignSet(
    campaignIdSetForPartner(partner),
    events,
    userCampaign,
  );
  return {
    id: partner.id,
    slug: partner.slug,
    name: partner.name,
    city: partner.city,
    logo: partner.logo,
    blurb: partner.blurb,
    campaignId: partner.campaignId,
    accountType: partner.accountType,
    emailDomain: partner.emailDomain,
    emailVerified: partner.emailVerified,
    ...summary,
  };
}

function demoPartnerRollup(partner: Partner): Omit<PartnerLeaderboardRow, "rank"> {
  const series = buildSamplePartnerUsersPerDay(partner.slug);
  const peopleReached = seriesTotal(series);
  const botStarts = Math.round(peopleReached * 0.7);
  const followThroughs = Math.round(botStarts * 0.22);
  const programs = buildDemoProgramStats(
    Math.round(botStarts * 0.38),
    followThroughs,
  );
  const estDollarsUnlocked = programs.reduce((s, p) => s + p.estDollarsUnlocked, 0);
  // Feedback metrics are always live (real tickets), even when funnel stats are demo.
  const feedback = countPartnerFeedbackMetrics(campaignIdsForPartner(partner));
  return {
    id: partner.id,
    slug: partner.slug,
    name: partner.name,
    city: partner.city,
    logo: partner.logo,
    blurb: partner.blurb,
    campaignId: partner.campaignId,
    accountType: partner.accountType,
    emailDomain: partner.emailDomain,
    emailVerified: partner.emailVerified,
    peopleReached,
    botStarts,
    followThroughs,
    estDollarsUnlocked,
    feedbackMessages: feedback.feedbackMessages,
    feedbackTickets: feedback.feedbackTickets,
  };
}

export function buildPartnerLeaderboard(): PartnerLeaderboardRow[] {
  // Public front-page leaderboard: organizations only (individuals use private status URLs).
  const partners = listLeaderboardPartners();
  if (impactStatsMode() === "demo") {
    const rows = partners.map((p) => demoPartnerRollup(p));
    rows.sort(
      (a, b) =>
        b.peopleReached - a.peopleReached ||
        b.botStarts - a.botStarts ||
        a.name.localeCompare(b.name),
    );
    return rows.map((row, i) => ({ ...row, rank: i + 1 }));
  }

  const events = listEventsForStats();
  const userCampaign = firstBotStartCampaignByUser(events);
  const rows = partners.map((p) => rollupPartner(p, events, userCampaign));
  rows.sort(
    (a, b) =>
      b.peopleReached - a.peopleReached ||
      b.botStarts - a.botStarts ||
      a.name.localeCompare(b.name),
  );
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildPartnerStats(slug: string): PartnerStats | null {
  const partner = getPartnerBySlug(slug);
  if (!partner) return null;

  const events = listEventsForStats();
  const userCampaign = firstBotStartCampaignByUser(events);
  const campaignIds = campaignIdSetForPartner(partner);
  const awarenessLive = events.filter(
    (e) =>
      e.event_type === "awareness" &&
      e.campaign_id != null &&
      campaignIds.has(e.campaign_id),
  );
  const usersPerDayLive = buildUsersPerDay(awarenessLive);
  const campaign = getCampaign(partner.campaignId);

  if (impactStatsMode() === "demo") {
    const summary = demoPartnerRollup(partner);
    const usersPerDay = buildSamplePartnerUsersPerDay(partner.slug);
    const programOpens = Math.round(summary.botStarts * 0.38);
    const programs = buildDemoProgramStats(programOpens, summary.followThroughs);
    const mapPoints: MapPoint[] = [];
    if (campaign?.lat != null && campaign.lng != null) {
      mapPoints.push({
        lat: campaign.lat,
        lng: campaign.lng,
        label: campaign.label ?? partner.name,
        count: summary.peopleReached,
        kind: "qr",
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      statsSource: "demo",
      partner: {
        id: partner.id,
        slug: partner.slug,
        name: partner.name,
        city: partner.city,
        logo: partner.logo,
        blurb: partner.blurb,
        campaignId: partner.campaignId,
        accountType: partner.accountType,
        emailDomain: partner.emailDomain,
        emailVerified: partner.emailVerified,
      },
      editable: Boolean(getSignedUpPartnerBySlug(partner.slug)),
      peopleReached: summary.peopleReached,
      botStarts: summary.botStarts,
      programOpens,
      followThroughs: summary.followThroughs,
      estDollarsUnlocked: summary.estDollarsUnlocked,
      feedbackMessages: summary.feedbackMessages,
      feedbackTickets: summary.feedbackTickets,
      usersPerDay,
      usersPerDayLive,
      chartSeriesSource: "sample",
      mapPoints,
      programs: programs.filter((p) => p.opens > 0 || p.followThroughs > 0),
      disclaimer: PARTNER_DISCLAIMER,
    };
  }

  const summary = rollupPartner(partner, events, userCampaign);
  const attributed = events.filter((e) =>
    eventMatchesCampaignSet(e, campaignIds, userCampaign),
  );
  const programOpens = attributed.filter((e) => e.event_type === "program_open");

  const mapPoints = buildMapPoints(awarenessLive);
  if (
    campaign?.lat != null &&
    campaign.lng != null &&
    !mapPoints.some(
      (p) =>
        Math.abs(p.lat - campaign.lat!) < 0.01 &&
        Math.abs(p.lng - campaign.lng!) < 0.01,
    )
  ) {
    mapPoints.push({
      lat: campaign.lat,
      lng: campaign.lng,
      label: campaign.label ?? partner.name,
      count: awarenessLive.length,
      kind: "qr",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    statsSource: "live",
    partner: {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      city: partner.city,
      logo: partner.logo,
      blurb: partner.blurb,
      campaignId: partner.campaignId,
      accountType: partner.accountType,
      emailDomain: partner.emailDomain,
      emailVerified: partner.emailVerified,
    },
    editable: Boolean(getSignedUpPartnerBySlug(partner.slug)),
    peopleReached: summary.peopleReached,
    botStarts: summary.botStarts,
    programOpens: programOpens.length,
    followThroughs: summary.followThroughs,
    estDollarsUnlocked: summary.estDollarsUnlocked,
    feedbackMessages: summary.feedbackMessages,
    feedbackTickets: summary.feedbackTickets,
    usersPerDay: usersPerDayLive,
    usersPerDayLive,
    chartSeriesSource: "live",
    mapPoints,
    programs: buildProgramStats(attributed).filter(
      (p) => p.opens > 0 || p.followThroughs > 0,
    ),
    disclaimer: PARTNER_DISCLAIMER,
  };
}

export interface PartnerEventLeaderboardRow {
  rank: number;
  id: string;
  slug: string;
  name: string;
  campaignId: string;
  createdAt: string;
  peopleReached: number;
  botStarts: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  feedbackMessages: number;
  feedbackTickets: number;
}

export interface PartnerEventStats {
  generatedAt: string;
  statsSource: "live";
  partner: PartnerStats["partner"];
  event: {
    id: string;
    slug: string;
    name: string;
    campaignId: string;
    createdAt: string;
  };
  peopleReached: number;
  botStarts: number;
  programOpens: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  feedbackMessages: number;
  feedbackTickets: number;
  usersPerDay: DailyCount[];
  mapPoints: MapPoint[];
  programs: ProgramStat[];
  disclaimer: string;
}

function eventToRow(
  event: PartnerEvent,
  summary: ReturnType<typeof rollupCampaignSet>,
  rank: number,
): PartnerEventLeaderboardRow {
  return {
    rank,
    id: event.id,
    slug: event.slug,
    name: event.name,
    campaignId: event.campaignId,
    createdAt: event.createdAt,
    ...summary,
  };
}

/** Always live – event boards should reflect real scans even when the public site is in demo mode. */
export function buildPartnerEventLeaderboard(
  partnerSlug: string,
): PartnerEventLeaderboardRow[] | null {
  const partner = getPartnerBySlug(partnerSlug);
  if (!partner) return null;
  const events = listEventsForStats();
  const userCampaign = firstBotStartCampaignByUser(events);
  const rows = listPartnerEventsByPartnerSlug(partner.slug).map((event) => {
    const summary = rollupCampaignSet(
      new Set([event.campaignId]),
      events,
      userCampaign,
    );
    return eventToRow(event, summary, 0);
  });
  rows.sort(
    (a, b) =>
      b.peopleReached - a.peopleReached ||
      b.botStarts - a.botStarts ||
      b.createdAt.localeCompare(a.createdAt),
  );
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function buildPartnerEventStats(
  partnerSlug: string,
  eventSlug: string,
): PartnerEventStats | null {
  const partner = getPartnerBySlug(partnerSlug);
  if (!partner) return null;
  const event = getPartnerEventBySlug(partner.slug, eventSlug);
  if (!event) return null;

  const events = listEventsForStats();
  const userCampaign = firstBotStartCampaignByUser(events);
  const campaignIds = new Set([event.campaignId]);
  const summary = rollupCampaignSet(campaignIds, events, userCampaign);
  const awarenessLive = events.filter(
    (e) => e.event_type === "awareness" && e.campaign_id === event.campaignId,
  );
  const attributed = events.filter((e) =>
    eventMatchesCampaignSet(e, campaignIds, userCampaign),
  );
  const programOpens = attributed.filter((e) => e.event_type === "program_open");
  const campaign = getCampaign(event.campaignId);
  const mapPoints = buildMapPoints(awarenessLive, { ghostPins: false });
  if (
    campaign?.lat != null &&
    campaign.lng != null &&
    !mapPoints.some(
      (p) =>
        Math.abs(p.lat - campaign.lat!) < 0.01 &&
        Math.abs(p.lng - campaign.lng!) < 0.01,
    )
  ) {
    mapPoints.push({
      lat: campaign.lat,
      lng: campaign.lng,
      label: campaign.label ?? event.name,
      count: awarenessLive.length,
      kind: "qr",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    statsSource: "live",
    partner: {
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      city: partner.city,
      logo: partner.logo,
      blurb: partner.blurb,
      campaignId: partner.campaignId,
      accountType: partner.accountType,
      emailDomain: partner.emailDomain,
      emailVerified: partner.emailVerified,
    },
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      campaignId: event.campaignId,
      createdAt: event.createdAt,
    },
    peopleReached: summary.peopleReached,
    botStarts: summary.botStarts,
    programOpens: programOpens.length,
    followThroughs: summary.followThroughs,
    estDollarsUnlocked: summary.estDollarsUnlocked,
    feedbackMessages: summary.feedbackMessages,
    feedbackTickets: summary.feedbackTickets,
    usersPerDay: buildUsersPerDay(awarenessLive),
    mapPoints,
    programs: buildProgramStats(attributed).filter(
      (p) => p.opens > 0 || p.followThroughs > 0,
    ),
    disclaimer: EVENT_DISCLAIMER,
  };
}
