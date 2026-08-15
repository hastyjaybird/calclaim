import type Database from "better-sqlite3";
import { randomPartnerToken, slugifyPartnerName } from "./db.js";

export interface PartnerEvent {
  id: string;
  slug: string;
  partnerId: string;
  partnerSlug: string;
  campaignId: string;
  name: string;
  createdAt: string;
}

let db: Database.Database | null = null;

export function initPartnerEvents(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_events (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      partner_id TEXT NOT NULL,
      partner_slug TEXT NOT NULL,
      campaign_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_partner_events_partner
      ON partner_events(partner_id);
    CREATE INDEX IF NOT EXISTS idx_partner_events_partner_slug
      ON partner_events(partner_slug);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("Partner events DB not initialized");
  return db;
}

type EventRow = {
  id: string;
  slug: string;
  partner_id: string;
  partner_slug: string;
  campaign_id: string;
  name: string;
  created_at: string;
};

const EVENT_SELECT = `SELECT id, slug, partner_id, partner_slug, campaign_id, name, created_at
  FROM partner_events`;

function rowToEvent(row: EventRow): PartnerEvent {
  return {
    id: row.id,
    slug: row.slug,
    partnerId: row.partner_id,
    partnerSlug: row.partner_slug,
    campaignId: row.campaign_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export function listPartnerEventsByPartnerSlug(partnerSlug: string): PartnerEvent[] {
  if (!db) return [];
  const cleaned = partnerSlug.trim().toLowerCase();
  const rows = getDb()
    .prepare(`${EVENT_SELECT} WHERE partner_slug = ? ORDER BY created_at DESC`)
    .all(cleaned) as EventRow[];
  return rows.map(rowToEvent);
}

export function getPartnerEventBySlug(
  partnerSlug: string,
  eventSlug: string,
): PartnerEvent | undefined {
  if (!db) return undefined;
  const row = getDb()
    .prepare(`${EVENT_SELECT} WHERE partner_slug = ? AND slug = ?`)
    .get(partnerSlug.trim().toLowerCase(), eventSlug.trim().toLowerCase()) as
    | EventRow
    | undefined;
  return row ? rowToEvent(row) : undefined;
}

export function getPartnerEventByCampaignId(
  campaignId: string,
): PartnerEvent | undefined {
  if (!db || !campaignId) return undefined;
  const row = getDb()
    .prepare(`${EVENT_SELECT} WHERE campaign_id = ?`)
    .get(campaignId) as EventRow | undefined;
  if (row) return rowToEvent(row);
  if (campaignId.includes("-")) {
    const alt = getDb()
      .prepare(`${EVENT_SELECT} WHERE campaign_id = ?`)
      .get(campaignId.replaceAll("-", "_")) as EventRow | undefined;
    return alt ? rowToEvent(alt) : undefined;
  }
  return undefined;
}

export function campaignIdsForPartner(partner: {
  id: string;
  campaignId: string;
  slug: string;
}): string[] {
  const ids = new Set<string>([partner.campaignId]);
  if (!db) return [...ids];
  const rows = getDb()
    .prepare(
      `SELECT campaign_id FROM partner_events
       WHERE partner_id = ? OR partner_slug = ?`,
    )
    .all(partner.id, partner.slug) as Array<{ campaign_id: string }>;
  for (const row of rows) ids.add(row.campaign_id);
  return [...ids];
}

function eventSlugExists(slug: string): boolean {
  if (!db) return false;
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM partner_events WHERE slug = ?")
    .get(slug) as { ok: number } | undefined;
  return Boolean(row);
}

function allocateEventSlug(name: string): string {
  const base = slugifyPartnerName(name) || "event";
  let candidate = base.slice(0, 40);
  let n = 0;
  while (eventSlugExists(candidate)) {
    n += 1;
    const suffix = randomPartnerToken(2);
    candidate = `${base.slice(0, 32)}-${suffix}`.slice(0, 48);
    if (n > 20) {
      candidate = `event-${randomPartnerToken(4)}`;
      break;
    }
  }
  return candidate;
}

const MAX_EVENT_NAME = 80;
const MAX_EVENTS_PER_PARTNER = 200;

export function deletePartnerEventsForPartner(
  partnerSlug: string,
  partnerId?: string,
): number {
  if (!db) return 0;
  const info = partnerId
    ? getDb()
        .prepare(
          `DELETE FROM partner_events WHERE partner_slug = ? OR partner_id = ?`,
        )
        .run(partnerSlug.trim().toLowerCase(), partnerId)
    : getDb()
        .prepare(`DELETE FROM partner_events WHERE partner_slug = ?`)
        .run(partnerSlug.trim().toLowerCase());
  return Number(info.changes) || 0;
}

export function createPartnerEvent(input: {
  partnerId: string;
  partnerSlug: string;
  name: string;
}): PartnerEvent | { error: "name_required" | "limit" } {
  const name = input.name.trim().slice(0, MAX_EVENT_NAME);
  if (!name) return { error: "name_required" };

  const countRow = getDb()
    .prepare("SELECT COUNT(*) AS n FROM partner_events WHERE partner_id = ?")
    .get(input.partnerId) as { n: number };
  if ((countRow.n || 0) >= MAX_EVENTS_PER_PARTNER) return { error: "limit" };

  const token = randomPartnerToken(4);
  const event: PartnerEvent = {
    id: `ev_${token}`,
    slug: allocateEventSlug(name),
    partnerId: input.partnerId,
    partnerSlug: input.partnerSlug,
    campaignId: `qr_e_${token}`,
    name,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO partner_events
        (id, slug, partner_id, partner_slug, campaign_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.slug,
      event.partnerId,
      event.partnerSlug,
      event.campaignId,
      event.name,
      event.createdAt,
    );
  return event;
}
