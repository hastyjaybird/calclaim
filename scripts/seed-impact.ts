/**
 * Seed demo analytics so the funder dashboard and /dev metrics aren't empty.
 * Usage: npm run seed-impact
 *
 * Clears prior analytics_events so re-runs don't stack.
 * Includes screen_view journeys (per-screen dropout, dwell)
 * and report_created so /dev Dropout / Timing panels have data.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getCampaign } from "../src/analytics/campaigns.js";
import { initAnalytics } from "../src/analytics/db.js";
import { fromCampaignPin } from "../src/analytics/geo.js";
import type { ScreenLocationId } from "../src/analytics/screens.js";
import { DATA_DIR, loadDotEnv } from "../src/config.js";

loadDotEnv();
const dbPath = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "calclaim.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
initAnalytics(db);
db.exec("DELETE FROM analytics_events");

type Loc = ScreenLocationId;

const daysBack = 14;
/** Weighted so partner leaderboard has a clear #1 (Resilient Markets) for demos. */
const campaignWeights: { id: string; weight: number }[] = [
  { id: "qr_resilient_markets", weight: 38 },
  { id: "qr_bay_area_makerfarm", weight: 28 },
  { id: "link_share", weight: 6 },
  { id: "qr_peer_share", weight: 4 },
  { id: "link_website", weight: 2 },
  { id: "qr_website", weight: 12 },
];
const weightTotal = campaignWeights.reduce((s, c) => s + c.weight, 0);

function pickCampaign(seed: number): string {
  let n = ((seed * 37) % weightTotal) + 1;
  for (const c of campaignWeights) {
    n -= c.weight;
    if (n <= 0) return c.id;
  }
  return campaignWeights[0]!.id;
}

const programs = [
  "calfresh",
  "lifeline",
  "care",
  "esa",
  "liheap",
  "tax_credits",
  "wic",
];

/** Already on categorical programs → skip income / most triage. */
const YES_PATH: Loc[] = [
  "opt_in",
  "gate",
  "offer",
  "offer",
  "offer",
  "has_reopen_notify",
  "finish",
];

/** Long NO-arm walk so late-screen dropout fills in. */
const NO_FULL: Loc[] = [
  "opt_in",
  "gate",
  "household_size",
  "income_band",
  "has_ca_residency",
  "has_utility_bills",
  "has_shared_meter",
  "has_shutoff_zone",
  "past_due",
  "has_buying_ev",
  "has_first_time_zev",
  "has_buying_ebike",
  "has_retire_vehicle",
  "has_child",
  "has_foster_youth",
  "has_refugee_status",
  "has_medical_need",
  "has_abd",
  "has_work_disruption",
  "has_disaster_area",
  "has_zip",
  "offer",
  "offer",
  "offer",
  "has_immigration_status",
  "has_reopen_notify",
  "finish",
];

const NO_CA_WORK: Loc[] = [
  "opt_in",
  "gate",
  "household_size",
  "income_band",
  "has_ca_residency",
  "has_ca_work",
  "has_utility_bills",
  "has_shared_meter",
  "has_child",
  "has_work_disruption",
  "offer",
  "offer",
  "has_immigration_status",
  "has_reopen_notify",
  "finish",
];

const NO_DISASTER: Loc[] = [
  "opt_in",
  "gate",
  "household_size",
  "income_band",
  "has_disaster_area",
  "has_disaster_zip",
  "has_utility_bills",
  "has_child",
  "offer",
  "offer",
  "has_immigration_status",
  "has_reopen_notify",
  "finish",
];

/** Last-screen weights: volume at income, high drop *rate* at immigration. */
const LAST_WEIGHTS: Partial<Record<Loc, number>> = {
  opt_in: 16,
  gate: 11,
  household_size: 7,
  income_band: 18,
  has_ca_residency: 4,
  has_ca_work: 3,
  has_utility_bills: 3,
  has_shared_meter: 2,
  has_shutoff_zone: 2,
  past_due: 3,
  has_buying_ev: 2,
  has_child: 3,
  has_medical_need: 2,
  has_work_disruption: 2,
  has_zip: 2,
  has_disaster_zip: 2,
  offer: 4,
  has_immigration_status: 9,
  has_reopen_notify: 4,
  finish: 22,
};

const DWELL_MS: Partial<Record<Loc, [number, number]>> = {
  opt_in: [2_500, 8_000],
  gate: [4_000, 12_000],
  household_size: [7_000, 18_000],
  income_band: [28_000, 120_000],
  has_immigration_status: [18_000, 65_000],
  offer: [8_000, 30_000],
  has_zip: [8_000, 24_000],
  has_disaster_zip: [7_000, 18_000],
  has_reopen_notify: [3_500, 9_000],
  finish: [2_000, 6_000],
};

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

function pickWeighted<T>(rng: () => number, items: { item: T; weight: number }[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let n = rng() * total;
  for (const x of items) {
    n -= x.weight;
    if (n <= 0) return x.item;
  }
  return items[items.length - 1]!.item;
}

function pickPath(rng: () => number): Loc[] {
  const r = rng();
  if (r < 0.22) return YES_PATH;
  if (r < 0.34) return NO_CA_WORK;
  if (r < 0.42) return NO_DISASTER;
  return NO_FULL;
}

function pickStopIndex(path: Loc[], rng: () => number): number {
  const choices = path.map((loc, index) => ({
    item: index,
    weight: LAST_WEIGHTS[loc] ?? 1,
  }));
  return pickWeighted(rng, choices);
}

function dwellMs(loc: Loc, rng: () => number): number {
  const [lo, hi] = DWELL_MS[loc] ?? [3_500, 11_000];
  return Math.round(lo + rng() * (hi - lo));
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10 + (n % 6), (n * 7) % 60, 0, 0);
  return d.toISOString();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const insert = db.prepare(`
  INSERT INTO analytics_events
    (event_type, source, campaign_id, program_id, telegram_user_id, lat, lng, label, meta_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

type Pin = { lat: number; lng: number; label: string };

function emit(
  eventType: string,
  source: string,
  campaignId: string | null,
  programId: string | null,
  uid: number | null,
  pin: Pin | null,
  label: string | null,
  meta: Record<string, unknown> | null,
  createdAt: string,
): void {
  insert.run(
    eventType,
    source,
    campaignId,
    programId,
    uid,
    pin?.lat ?? null,
    pin?.lng ?? null,
    label,
    meta ? JSON.stringify(meta) : null,
    createdAt,
  );
}

function emitJourney(opts: {
  uid: number;
  campaignId: string;
  source: string;
  pin: Pin;
  path: Loc[];
  stopIndex: number;
  sessionStartMs: number;
  rng: () => number;
  /** When true, skip bot_start (returning visitor already has one). */
  returning?: boolean;
}): { lastLoc: Loc; finished: boolean; sawOffer: boolean; firstOfferProgram: string | null } {
  const {
    uid,
    campaignId,
    source,
    pin,
    path,
    stopIndex,
    sessionStartMs,
    rng,
    returning,
  } = opts;

  if (!returning) {
    emit(
      "bot_start",
      source,
      campaignId,
      null,
      uid,
      pin,
      pin.label,
      null,
      iso(sessionStartMs),
    );
  }

  let t = sessionStartMs + 1_500 + Math.round(rng() * 4_000);
  let prevDwell: number | null = null;
  let prevLoc: Loc | null = null;
  let offerN = 0;
  let firstOfferProgram: string | null = null;
  let sawOffer = false;

  const stop = Math.min(stopIndex, path.length - 1);

  for (let i = 0; i <= stop; i++) {
    const loc = path[i]!;
    const seen = i + 1;
    const left = loc === "finish" ? 0 : path.length - seen;
    const pct =
      loc === "finish"
        ? 100
        : Math.round((seen / Math.max(1, seen + left)) * 1000) / 10;
    let programId: string | null = null;
    if (loc === "offer") {
      programId = programs[offerN % programs.length]!;
      offerN += 1;
      if (!sawOffer) {
        sawOffer = true;
        firstOfferProgram = programId;
      }
    }

    const meta: Record<string, unknown> = {
      seen,
      left,
      pct,
      location: loc,
    };
    if (prevDwell != null) {
      meta.prevDwellMs = prevDwell;
      meta.prevLocation = prevLoc;
    }
    if (loc === "finish") {
      meta.journeyMs = Math.max(0, t - sessionStartMs);
    }

    emit(
      "screen_view",
      "bot",
      campaignId,
      programId,
      uid,
      null,
      loc,
      meta,
      iso(t),
    );

    if (loc === "gate") {
      emit(
        "funnel",
        "bot",
        campaignId,
        null,
        uid,
        null,
        "started",
        null,
        iso(t),
      );
    }
    if (i > 0 && path[i - 1] === "gate") {
      emit(
        "funnel",
        "bot",
        campaignId,
        null,
        uid,
        null,
        "gate_done",
        null,
        iso(t),
      );
    }
    if (loc === "offer" && offerN === 1) {
      emit(
        "funnel",
        "bot",
        campaignId,
        programId,
        uid,
        null,
        "triage_done",
        null,
        iso(t),
      );
      emit(
        "funnel",
        "bot",
        campaignId,
        programId,
        uid,
        null,
        "first_offer",
        null,
        iso(t),
      );
    }
    if (loc === "finish") {
      emit(
        "funnel",
        "bot",
        campaignId,
        null,
        uid,
        null,
        "finished",
        null,
        iso(t),
      );
    }

    const dwell = dwellMs(loc, rng);
    let gap = dwell;
    // ~8% walk away overnight – timing treats >30m as a pause, not answer time.
    if (i < stop && rng() < 0.08) {
      gap += 35 * 60 * 1000 + Math.round(rng() * 90 * 60 * 1000);
    }
    prevDwell = dwell;
    prevLoc = loc;
    t += gap;
  }

  if (sawOffer && firstOfferProgram) {
    const goApply = stop >= 0 && path[stop] === "finish" ? rng() < 0.7 : rng() < 0.4;
    if (goApply) {
      emit(
        "program_open",
        "bot",
        campaignId,
        firstOfferProgram,
        uid,
        pin,
        pin.label,
        null,
        iso(t),
      );
      if (rng() < 0.65) {
        t += 8_000 + Math.round(rng() * 20_000);
        emit(
          "follow_through",
          "bot",
          campaignId,
          firstOfferProgram,
          uid,
          null,
          null,
          null,
          iso(t),
        );
      }
    }
  }

  const finished = path[stop] === "finish";
  if (finished && rng() < 0.62) {
    t += 4_000 + Math.round(rng() * 12_000);
    emit(
      "report_created",
      "bot",
      campaignId,
      null,
      uid,
      null,
      "report_created",
      null,
      iso(t),
    );
  }

  return {
    lastLoc: path[stop]!,
    finished,
    sawOffer,
    firstOfferProgram,
  };
}

let awareness = 0;
let userSeq = 2000;

type EarlyDropper = {
  uid: number;
  campaignId: string;
  source: string;
  pin: Pin;
  day: number;
};

const earlyDroppers: EarlyDropper[] = [];

const seedTx = db.transaction(() => {
  for (let day = daysBack; day >= 0; day--) {
    const reachedToday = 5 + ((day * 3) % 6);
    for (let i = 0; i < reachedToday; i++) {
      const campaignId = pickCampaign(day * 11 + i * 3);
      const campaign = getCampaign(campaignId);
      const coarse = fromCampaignPin({
        lat: campaign?.lat ?? 37.77 + (i % 3) * 0.05,
        lng: campaign?.lng ?? -122.42 - (i % 2) * 0.04,
        label: campaign?.label ?? "California",
      });
      const pin: Pin = {
        lat: coarse.lat ?? 37.77,
        lng: coarse.lng ?? -122.42,
        label: coarse.label ?? "California",
      };
      const created = daysAgo(day);
      const source = campaign?.kind === "qr" ? "qr" : "link";

      emit(
        "awareness",
        source,
        campaignId,
        null,
        null,
        pin,
        pin.label,
        null,
        created,
      );
      awareness += 1;

      // ~70% open the bot
      if (i / reachedToday > 0.7) continue;

      const uid = userSeq++;
      const userRng = mulberry32(day * 10_000 + i * 97 + 13);
      const journeyPath = pickPath(userRng);
      const stopIndex = pickStopIndex(journeyPath, userRng);
      const sessionStartMs = Date.parse(created);

      if ((day * 5 + i) % 5 === 0) {
        emit(
          "share_out",
          "link",
          "link_share",
          null,
          uid,
          null,
          null,
          null,
          created,
        );
      }

      const result = emitJourney({
        uid,
        campaignId,
        source,
        pin,
        path: journeyPath,
        stopIndex,
        sessionStartMs,
        rng: userRng,
      });

      if (
        !result.finished &&
        (result.lastLoc === "opt_in" || result.lastLoc === "gate")
      ) {
        earlyDroppers.push({ uid, campaignId, source, pin, day });
      }
    }
  }

  // A few people come back the next day and finish – splits timing journeys at Opt-in.
  const returning = earlyDroppers.slice(0, 4);
  for (let r = 0; r < returning.length; r++) {
    const u = returning[r]!;
    const userRng = mulberry32(9_001 + r * 17);
    const returnDay = Math.max(0, u.day - 1);
    const path = pickPath(userRng);
    emitJourney({
      uid: u.uid,
      campaignId: u.campaignId,
      source: u.source,
      pin: u.pin,
      path,
      stopIndex: path.length - 1,
      sessionStartMs: Date.parse(daysAgo(returnDay)) + 3 * 60 * 60 * 1000,
      rng: userRng,
      returning: true,
    });
  }
});

seedTx();

const funnelCounts = db
  .prepare(
    `SELECT
       SUM(CASE WHEN event_type='awareness' THEN 1 ELSE 0 END) AS reached,
       SUM(CASE WHEN event_type='bot_start' THEN 1 ELSE 0 END) AS bot_start,
       SUM(CASE WHEN event_type='funnel' AND label='started' THEN 1 ELSE 0 END) AS started,
       SUM(CASE WHEN event_type='funnel' AND label='gate_done' THEN 1 ELSE 0 END) AS gate_done,
       SUM(CASE WHEN event_type='funnel' AND label='triage_done' THEN 1 ELSE 0 END) AS triage_done,
       SUM(CASE WHEN event_type='funnel' AND label='first_offer' THEN 1 ELSE 0 END) AS first_offer,
       SUM(CASE WHEN event_type='program_open' THEN 1 ELSE 0 END) AS apply_open,
       SUM(CASE WHEN event_type='follow_through' THEN 1 ELSE 0 END) AS follow_through,
       SUM(CASE WHEN event_type='funnel' AND label='finished' THEN 1 ELSE 0 END) AS finished,
       SUM(CASE WHEN event_type='screen_view' THEN 1 ELSE 0 END) AS screen_view,
       SUM(CASE WHEN event_type='report_created' THEN 1 ELSE 0 END) AS report_created
     FROM analytics_events`,
  )
  .get() as Record<string, number>;

const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
console.log(`Seeded impact events into ${dbPath}`);
console.log(`  awareness=${awareness}`);
console.log("  funnel:", funnelCounts);
console.log(`Open ${base}/impact  (funder demo charts)`);
console.log(`Open ${base}/dev#screen-dropout  (live Dropout / Timing)`);
