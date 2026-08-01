/**
 * Seed demo analytics so the funder dashboard isn't empty locally.
 * Usage: npm run seed-impact
 *
 * Clears prior analytics_events so re-runs don't stack.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getCampaign } from "../src/analytics/campaigns.js";
import { initAnalytics } from "../src/analytics/db.js";
import { fromCampaignPin } from "../src/analytics/geo.js";
import { DATA_DIR, loadDotEnv } from "../src/config.js";

loadDotEnv();
const dbPath = process.env.DATABASE_PATH ?? path.join(DATA_DIR, "calclaim.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
initAnalytics(db);
db.exec("DELETE FROM analytics_events");

const daysBack = 14;
const campaigns = [
  "qr_oakland_library",
  "qr_sf_mission",
  "qr_fresno_foodbank",
  "qr_la_family_resource",
  "link_share",
  "link_website",
];
const programs = ["calfresh", "lifeline", "care", "esa", "liheap", "tax_credits", "wic"];

/** Simulated CX fall-off: each stage is a subset of the previous. */
const FUNNEL_DEPTH = [
  "bot_start",
  "started",
  "gate_done",
  "triage_done",
  "first_offer",
  "apply_open",
  "follow_through",
  "finished",
] as const;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10 + (n % 6), (n * 7) % 60, 0, 0);
  return d.toISOString();
}

const insert = db.prepare(`
  INSERT INTO analytics_events
    (event_type, source, campaign_id, program_id, telegram_user_id, lat, lng, label, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let awareness = 0;
let userSeq = 2000;

for (let day = daysBack; day >= 0; day--) {
  const reachedToday = 4 + ((day * 3) % 5);
  for (let i = 0; i < reachedToday; i++) {
    const campaignId = campaigns[(day + i) % campaigns.length]!;
    const campaign = getCampaign(campaignId);
    const pin = fromCampaignPin({
      lat: campaign?.lat ?? 37.77 + (i % 3) * 0.05,
      lng: campaign?.lng ?? -122.42 - (i % 2) * 0.04,
      label: campaign?.label ?? "California",
    });
    const created = daysAgo(day);
    const source = campaign?.kind === "qr" ? "qr" : "link";

    insert.run(
      "awareness",
      source,
      campaignId,
      null,
      null,
      pin.lat,
      pin.lng,
      pin.label,
      created,
    );
    awareness += 1;

    // ~70% open the bot; then stepwise fall-off through the tree
    if (i / reachedToday > 0.7) continue;

    const uid = userSeq++;
    insert.run(
      "bot_start",
      source,
      campaignId,
      null,
      uid,
      pin.lat,
      pin.lng,
      pin.label,
      created,
    );

    // How far this user gets (0 = only bot_start … 7 = finished)
    // Bias: most die between bot_start→started and first_offer→apply
    let depth = 0;
    if (Math.random() < 0.75) depth = 1; // started
    if (depth >= 1 && Math.random() < 0.85) depth = 2; // gate
    if (depth >= 2 && Math.random() < 0.8) depth = 3; // triage
    if (depth >= 3 && Math.random() < 0.9) depth = 4; // first offer
    if (depth >= 4 && Math.random() < 0.55) depth = 5; // apply — biggest intentional drop
    if (depth >= 5 && Math.random() < 0.65) depth = 6; // follow-through
    if (depth >= 6 && Math.random() < 0.5) depth = 7; // finished

    const programId = programs[(day + i) % programs.length]!;

    for (let s = 1; s <= depth; s++) {
      const stage = FUNNEL_DEPTH[s]!;
      if (stage === "apply_open") {
        insert.run(
          "program_open",
          "bot",
          campaignId,
          programId,
          uid,
          pin.lat,
          pin.lng,
          pin.label,
          created,
        );
      } else if (stage === "follow_through") {
        insert.run(
          "follow_through",
          "bot",
          campaignId,
          programId,
          uid,
          null,
          null,
          null,
          created,
        );
      } else {
        insert.run(
          "funnel",
          "bot",
          campaignId,
          stage === "first_offer" ? programId : null,
          uid,
          null,
          null,
          stage,
          created,
        );
      }
    }
  }
}

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
       SUM(CASE WHEN event_type='funnel' AND label='finished' THEN 1 ELSE 0 END) AS finished
     FROM analytics_events`,
  )
  .get() as Record<string, number>;

console.log(`Seeded impact events into ${dbPath}`);
console.log(`  awareness=${awareness}`);
console.log("  funnel:", funnelCounts);
console.log(`Open ${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/impact`);
