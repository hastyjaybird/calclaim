import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import {
  buildPartnerEventLeaderboard,
  buildPartnerEventStats,
  buildPartnerStats,
  type DailyCount,
  type MapPoint,
  type PartnerEventLeaderboardRow,
  type PartnerStats,
} from "../analytics/stats.js";
import { buildStoreZip } from "./zip.js";

/**
 * Partner data export. Files/columns must match what `/partners/:slug` (and
 * signed-in event pages) display. If you add a metric, chart, or profile field
 * to those pages, update the CSV builders here so downloads stay in sync.
 */
export function buildPartnerWebsiteExportZip(slug: string): Buffer | null {
  const stats = buildPartnerStats(slug);
  if (!stats) return null;

  const events = buildPartnerEventLeaderboard(slug) ?? [];
  const files: Array<{ name: string; data: Buffer }> = [
    { name: "profile.csv", data: Buffer.from(profileCsv(stats), "utf8") },
    { name: "metrics.csv", data: Buffer.from(metricsCsv(stats), "utf8") },
    {
      name: "users-per-day.csv",
      data: Buffer.from(usersPerDayCsv(stats.usersPerDay), "utf8"),
    },
    { name: "map.csv", data: Buffer.from(mapCsv(stats.mapPoints), "utf8") },
    { name: "events.csv", data: Buffer.from(eventsCsv(events), "utf8") },
  ];

  for (const event of events) {
    const eventStats = buildPartnerEventStats(slug, event.slug);
    if (!eventStats) continue;
    const dir = `events/${event.slug}`;
    files.push({
      name: `${dir}/metrics.csv`,
      data: Buffer.from(eventMetricsCsv(eventStats), "utf8"),
    });
    files.push({
      name: `${dir}/users-per-day.csv`,
      data: Buffer.from(usersPerDayCsv(eventStats.usersPerDay), "utf8"),
    });
    files.push({
      name: `${dir}/map.csv`,
      data: Buffer.from(mapCsv(eventStats.mapPoints), "utf8"),
    });
  }

  const logo = readPublicAsset(stats.partner.logo);
  if (logo) {
    files.push({ name: `logo${logo.ext}`, data: logo.data });
  }

  return buildStoreZip(files);
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function profileCsv(stats: PartnerStats): string {
  const p = stats.partner;
  const rows = [
    ["field", "value"],
    ["name", p.name],
    ["city", p.city],
    ["blurb", p.blurb],
    ["account_type", p.accountType],
    ["email_verified", p.emailVerified ? "yes" : "no"],
    ["email_domain", p.emailDomain],
    ["generated_at", stats.generatedAt],
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function metricsCsv(stats: PartnerStats): string {
  const rows = [
    ["metric", "value"],
    ["people_reached", stats.peopleReached],
    ["opened_calclaim", stats.botStarts],
    ["follow_throughs", stats.followThroughs],
    ["est_aid_unlocked_usd", stats.estDollarsUnlocked],
    ["feedback_messages", stats.feedbackMessages],
    ["feedback_tickets", stats.feedbackTickets],
    ["disclaimer", stats.disclaimer],
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function eventMetricsCsv(stats: {
  event: { name: string };
  peopleReached: number;
  botStarts: number;
  followThroughs: number;
  estDollarsUnlocked: number;
  feedbackMessages: number;
  feedbackTickets: number;
  disclaimer: string;
}): string {
  const rows = [
    ["metric", "value"],
    ["event_name", stats.event.name],
    ["people_reached", stats.peopleReached],
    ["opened_calclaim", stats.botStarts],
    ["follow_throughs", stats.followThroughs],
    ["est_aid_unlocked_usd", stats.estDollarsUnlocked],
    ["feedback_messages", stats.feedbackMessages],
    ["feedback_tickets", stats.feedbackTickets],
    ["disclaimer", stats.disclaimer],
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function usersPerDayCsv(series: DailyCount[]): string {
  const rows = [
    ["date", "users", "cumulative"],
    ...series.map((d) => [d.date, d.users, d.cumulative]),
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function mapCsv(points: MapPoint[]): string {
  const rows = [
    ["label", "lat", "lng", "count"],
    ...points.map((p) => [p.label, p.lat, p.lng, p.count]),
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function eventsCsv(events: PartnerEventLeaderboardRow[]): string {
  const rows = [
    [
      "rank",
      "name",
      "created_at",
      "people_reached",
      "opened_calclaim",
      "follow_throughs",
    ],
    ...events.map((e) => [
      e.rank,
      e.name,
      e.createdAt,
      e.peopleReached,
      e.botStarts,
      e.followThroughs,
    ]),
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

function readPublicAsset(
  webPath: string,
): { data: Buffer; ext: string } | null {
  const cleaned = String(webPath || "").trim();
  if (!cleaned.startsWith("/")) return null;
  const rel = cleaned.replace(/^\/+/, "");
  const abs = path.resolve(path.join(ROOT, "public"), rel);
  const publicRoot = path.resolve(path.join(ROOT, "public"));
  if (abs !== publicRoot && !abs.startsWith(publicRoot + path.sep)) return null;
  try {
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs) || ".bin";
    return { data, ext };
  } catch {
    return null;
  }
}
