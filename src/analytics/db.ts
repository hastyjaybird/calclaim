import type Database from "better-sqlite3";

export type AnalyticsEventType =
  | "awareness"
  | "bot_start"
  | "program_open"
  | "follow_through"
  | "funnel"
  | "screen_view"
  | "report_created"
  | "share_out";

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
  meta?: Record<string, unknown> | null;
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
  meta_json: string | null;
  created_at: string;
}

let analyticsDb: Database.Database | null = null;

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

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
  ensureColumn(db, "analytics_events", "meta_json", "TEXT");
}

function getDb(): Database.Database {
  if (!analyticsDb) throw new Error("Analytics DB not initialized");
  return analyticsDb;
}

export function recordEvent(input: AnalyticsEventInput): void {
  const createdAt = new Date().toISOString();
  const metaJson =
    input.meta == null ? null : JSON.stringify(input.meta);
  getDb()
    .prepare(
      `INSERT INTO analytics_events
        (event_type, source, campaign_id, program_id, telegram_user_id, lat, lng, label, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      metaJson,
      createdAt,
    );
}

export function listEvents(): AnalyticsEventRow[] {
  return getDb()
    .prepare(
      `SELECT id, event_type, source, campaign_id, program_id, telegram_user_id,
              lat, lng, label, meta_json, created_at
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
