import type Database from "better-sqlite3";

export type AnalyticsEventType =
  | "awareness"
  | "bot_start"
  | "program_open"
  | "follow_through"
  | "funnel";

export type AnalyticsSource = "qr" | "link" | "bot" | "unknown";

export interface AnalyticsEventInput {
  eventType: AnalyticsEventType;
  source?: AnalyticsSource;
  campaignId?: string | null;
  programId?: string | null;
  telegramUserId?: number | null;
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
}

export interface AnalyticsEventRow {
  id: number;
  event_type: AnalyticsEventType;
  source: string | null;
  campaign_id: string | null;
  program_id: string | null;
  telegram_user_id: number | null;
  lat: number | null;
  lng: number | null;
  label: string | null;
  created_at: string;
}

let analyticsDb: Database.Database | null = null;

export function initAnalytics(db: Database.Database): void {
  analyticsDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      source TEXT,
      campaign_id TEXT,
      program_id TEXT,
      telegram_user_id INTEGER,
      lat REAL,
      lng REAL,
      label TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_program ON analytics_events(program_id);
  `);
}

function getDb(): Database.Database {
  if (!analyticsDb) throw new Error("Analytics DB not initialized");
  return analyticsDb;
}

export function recordEvent(input: AnalyticsEventInput): void {
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO analytics_events
        (event_type, source, campaign_id, program_id, telegram_user_id, lat, lng, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.eventType,
      input.source ?? null,
      input.campaignId ?? null,
      input.programId ?? null,
      input.telegramUserId ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.label ?? null,
      createdAt,
    );
}

export function listEvents(): AnalyticsEventRow[] {
  return getDb()
    .prepare(
      `SELECT id, event_type, source, campaign_id, program_id, telegram_user_id,
              lat, lng, label, created_at
       FROM analytics_events
       ORDER BY created_at ASC`,
    )
    .all() as AnalyticsEventRow[];
}

export function countEvents(eventType?: AnalyticsEventType): number {
  if (eventType) {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE event_type = ?`)
      .get(eventType) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM analytics_events`)
    .get() as { n: number };
  return row.n;
}
