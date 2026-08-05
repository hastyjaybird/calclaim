import type Database from "better-sqlite3";
import type { ApplyPeriod } from "./cdss.js";
import { todayYmd } from "./format.js";

export type DisasterWindowStatus = "pending" | "active" | "expired" | "dismissed";

export type DisasterScanSource = "fema" | "cdss" | "fns";

/** How a window reached its current status. */
export type DisasterDecision = "auto_published" | "auto_held" | "manual";

/**
 * Days of failure before a source is worth an alert. The sources are not equally
 * important: FNS decides whether anything can publish at all, FEMA only
 * corroborates (FNS states the declaration date itself), and CDSS supplies a
 * phone number. Alerting on all three at the same threshold would bury the one
 * that matters under noise from the one that does not.
 */
export const STALE_AFTER_DAYS: Record<DisasterScanSource, number> = {
  fns: 2,
  fema: 4,
  cdss: 21,
};

export interface DisasterWindow {
  id: number;
  dedupeKey: string;
  femaDisasterNumber: number | null;
  incidentType: string | null;
  label: string;
  counties: string[];
  zips: string[] | null;
  placeLabels: string[] | null;
  incidentBegin: string | null;
  incidentEnd: string | null;
  applyPeriods: ApplyPeriod[];
  applyPhone: string | null;
  applyUrl: string | null;
  status: DisasterWindowStatus;
  sourceUrl: string | null;
  extractedBy: string | null;
  notes: string | null;
  decision: DisasterDecision | null;
  confidence: string | null;
  /** Full check-by-check validation record, for the /dev audit trail. */
  validation: unknown;
  firstSeenAt: string;
  updatedAt: string;
}

export interface DisasterWindowDraft {
  femaDisasterNumber: number | null;
  incidentType: string | null;
  label: string;
  counties: string[];
  zips: string[] | null;
  placeLabels: string[] | null;
  incidentBegin: string | null;
  incidentEnd: string | null;
  applyPeriods: ApplyPeriod[];
  applyPhone: string | null;
  applyUrl: string | null;
  sourceUrl: string | null;
  extractedBy: string | null;
  notes: string | null;
}

export interface DisasterScanState {
  source: DisasterScanSource;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  contentHash: string | null;
}

let disasterDb: Database.Database | null = null;

export function initDisasterWindows(db: Database.Database): void {
  disasterDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS disaster_windows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      fema_disaster_number INTEGER,
      incident_type TEXT,
      label TEXT NOT NULL,
      counties_json TEXT NOT NULL DEFAULT '[]',
      zips_json TEXT,
      place_labels_json TEXT,
      incident_begin TEXT,
      incident_end TEXT,
      apply_periods_json TEXT NOT NULL DEFAULT '[]',
      apply_phone TEXT,
      apply_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      source_url TEXT,
      extracted_by TEXT,
      notes TEXT,
      decision TEXT,
      confidence TEXT,
      validation_json TEXT,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_disaster_windows_status ON disaster_windows(status);
    CREATE TABLE IF NOT EXISTS disaster_scan_state (
      source TEXT PRIMARY KEY,
      last_success_at TEXT,
      last_attempt_at TEXT,
      last_error TEXT,
      content_hash TEXT
    );
  `);
  // CREATE TABLE IF NOT EXISTS skips these on databases made before the
  // automated decision fields existed.
  for (const [column, type] of [
    ["decision", "TEXT"],
    ["confidence", "TEXT"],
    ["validation_json", "TEXT"],
  ] as const) {
    ensureColumn(db, "disaster_windows", column, type);
  }
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function getDb(): Database.Database {
  if (!disasterDb) throw new Error("Disaster window DB not initialized");
  return disasterDb;
}

/**
 * Lets the ranker fail closed. Without the table there are no windows, and no
 * windows means the Disaster CalFresh card stays hidden – the safe direction.
 */
export function hasDisasterDb(): boolean {
  return disasterDb != null;
}

function parseJsonArray(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out = parsed.filter((x): x is string => typeof x === "string");
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parsePeriods(raw: unknown): ApplyPeriod[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => {
        const rec = p as { start?: unknown; end?: unknown };
        return typeof rec.start === "string" && typeof rec.end === "string"
          ? { start: rec.start, end: rec.end }
          : null;
      })
      .filter((p): p is ApplyPeriod => p != null);
  } catch {
    return [];
  }
}

function rowToWindow(row: Record<string, unknown>): DisasterWindow {
  return {
    id: row.id as number,
    dedupeKey: row.dedupe_key as string,
    femaDisasterNumber: (row.fema_disaster_number as number | null) ?? null,
    incidentType: (row.incident_type as string | null) ?? null,
    label: row.label as string,
    counties: parseJsonArray(row.counties_json) ?? [],
    zips: parseJsonArray(row.zips_json),
    placeLabels: parseJsonArray(row.place_labels_json),
    incidentBegin: (row.incident_begin as string | null) ?? null,
    incidentEnd: (row.incident_end as string | null) ?? null,
    applyPeriods: parsePeriods(row.apply_periods_json),
    applyPhone: (row.apply_phone as string | null) ?? null,
    applyUrl: (row.apply_url as string | null) ?? null,
    status: row.status as DisasterWindowStatus,
    sourceUrl: (row.source_url as string | null) ?? null,
    extractedBy: (row.extracted_by as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    decision: (row.decision as DisasterDecision | null) ?? null,
    confidence: (row.confidence as string | null) ?? null,
    validation: parseJson(row.validation_json),
    firstSeenAt: row.first_seen_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Stable identity across re-scans: the event plus the county scope. Dates are
 * deliberately excluded – FNS can amend or extend an application period, and
 * that has to update the existing row rather than leave the old dates live.
 * Counties stay in the key so staggered per-county windows remain separate.
 */
export function dedupeKeyFor(draft: DisasterWindowDraft): string {
  const scope = draft.counties.length
    ? draft.counties.map((c) => c.toLowerCase()).sort().join("+")
    : draft.label.toLowerCase().replace(/\s+/g, "-").slice(0, 60);
  return draft.femaDisasterNumber
    ? `dr-${draft.femaDisasterNumber}|${scope}`
    : scope;
}

export interface UpsertAudit {
  /** Status to give a brand-new row; automation passes 'active' to publish. */
  initialStatus?: DisasterWindowStatus;
  decision?: DisasterDecision;
  confidence?: string | null;
  validation?: unknown;
  /**
   * Promote an existing pending/expired row to active. A row a human dismissed
   * is never promoted – a manual override outranks the scan.
   */
  promoteToActive?: boolean;
}

/**
 * Insert a scanned window, or refresh a known one. Extensions and corrections
 * update the data; a dismissal is always respected.
 */
export interface UpsertResult {
  window: DisasterWindow;
  isNew: boolean;
  /** True only on the scan that made the card visible, so receipts fire once. */
  published: boolean;
  /** State before this scan, for deciding whether anything is worth reporting. */
  previous: {
    status: DisasterWindowStatus;
    decision: DisasterDecision | null;
    validation: unknown;
  } | null;
}

export function upsertWindow(
  draft: DisasterWindowDraft,
  audit: UpsertAudit = {},
): UpsertResult {
  const key = dedupeKeyFor(draft);
  const now = new Date().toISOString();
  const existing = getDb()
    .prepare(`SELECT * FROM disaster_windows WHERE dedupe_key = ?`)
    .get(key) as Record<string, unknown> | undefined;

  if (existing) {
    getDb()
      .prepare(
        `UPDATE disaster_windows SET
           fema_disaster_number = ?, incident_type = ?, label = ?,
           counties_json = ?, zips_json = ?, place_labels_json = ?,
           incident_begin = ?, incident_end = ?, apply_periods_json = ?,
           apply_phone = ?, apply_url = ?, source_url = ?, extracted_by = ?,
           notes = ?, decision = ?, confidence = ?, validation_json = ?,
           updated_at = ?
         WHERE dedupe_key = ?`,
      )
      .run(
        draft.femaDisasterNumber,
        draft.incidentType,
        draft.label,
        JSON.stringify(draft.counties),
        draft.zips ? JSON.stringify(draft.zips) : null,
        draft.placeLabels ? JSON.stringify(draft.placeLabels) : null,
        draft.incidentBegin,
        draft.incidentEnd,
        JSON.stringify(draft.applyPeriods),
        draft.applyPhone,
        draft.applyUrl,
        draft.sourceUrl,
        draft.extractedBy,
        draft.notes,
        audit.decision ?? (existing.decision as string | null) ?? null,
        audit.confidence ?? (existing.confidence as string | null) ?? null,
        audit.validation !== undefined
          ? JSON.stringify(audit.validation)
          : ((existing.validation_json as string | null) ?? null),
        now,
        key,
      );

    const id = existing.id as number;
    const status = existing.status as DisasterWindowStatus;
    const previous = {
      status,
      decision: (existing.decision as DisasterDecision | null) ?? null,
      validation: parseJson(existing.validation_json),
    };
    const stillOpen = lastDay(draft.applyPeriods) >= todayYmd();
    let published = false;
    // A dismissal is a deliberate override and outranks any later scan.
    if (status !== "dismissed" && audit.promoteToActive && stillOpen) {
      if (status !== "active") {
        setWindowStatus(id, "active");
        published = true;
      }
    } else if (status === "expired" && stillOpen && !audit.promoteToActive) {
      // Re-opened but not validated: surface it rather than leaving it expired.
      setWindowStatus(id, "pending");
    }
    return { window: getWindowByKey(key)!, isNew: published, published, previous };
  }

  getDb()
    .prepare(
      `INSERT INTO disaster_windows
        (dedupe_key, fema_disaster_number, incident_type, label, counties_json,
         zips_json, place_labels_json, incident_begin, incident_end,
         apply_periods_json, apply_phone, apply_url, status, source_url,
         extracted_by, notes, decision, confidence, validation_json,
         first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key,
      draft.femaDisasterNumber,
      draft.incidentType,
      draft.label,
      JSON.stringify(draft.counties),
      draft.zips ? JSON.stringify(draft.zips) : null,
      draft.placeLabels ? JSON.stringify(draft.placeLabels) : null,
      draft.incidentBegin,
      draft.incidentEnd,
      JSON.stringify(draft.applyPeriods),
      draft.applyPhone,
      draft.applyUrl,
      audit.initialStatus ?? "pending",
      draft.sourceUrl,
      draft.extractedBy,
      draft.notes,
      audit.decision ?? null,
      audit.confidence ?? null,
      audit.validation !== undefined ? JSON.stringify(audit.validation) : null,
      now,
      now,
    );
  return {
    window: getWindowByKey(key)!,
    isNew: true,
    published: (audit.initialStatus ?? "pending") === "active",
    previous: null,
  };
}

export function getWindowByKey(key: string): DisasterWindow | null {
  const row = getDb()
    .prepare(`SELECT * FROM disaster_windows WHERE dedupe_key = ?`)
    .get(key) as Record<string, unknown> | undefined;
  return row ? rowToWindow(row) : null;
}

export function getWindow(id: number): DisasterWindow | null {
  const row = getDb()
    .prepare(`SELECT * FROM disaster_windows WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToWindow(row) : null;
}

export function listWindows(
  status?: DisasterWindowStatus | "all",
  limit = 100,
): DisasterWindow[] {
  const rows =
    !status || status === "all"
      ? (getDb()
          .prepare(`SELECT * FROM disaster_windows ORDER BY id DESC LIMIT ?`)
          .all(limit) as Record<string, unknown>[])
      : (getDb()
          .prepare(
            `SELECT * FROM disaster_windows WHERE status = ? ORDER BY id DESC LIMIT ?`,
          )
          .all(status, limit) as Record<string, unknown>[]);
  return rows.map(rowToWindow);
}

export function isPeriodOpen(periods: ApplyPeriod[], today: string): boolean {
  return periods.some((p) => p.start <= today && today <= p.end);
}

/** Last day across all periods; empty string when there are none. */
function lastDay(periods: ApplyPeriod[]): string {
  return periods.reduce((acc, p) => (p.end > acc ? p.end : acc), "");
}

/**
 * Approved windows accepting applications today. Expiry is implicit in the
 * dates, so a row nobody remembers to disable stops matching on its own.
 */
export function listLiveWindows(today: string): DisasterWindow[] {
  return listWindows("active", 200).filter((w) =>
    isPeriodOpen(w.applyPeriods, today),
  );
}

/**
 * Published windows that have not closed yet, including ones whose application
 * period has not opened. FNS approves an operation about two weeks before
 * applications start, and that lead time is the most useful thing the card can
 * say – a household can have documents ready for day one.
 */
export function listApprovedWindows(today: string): DisasterWindow[] {
  return listWindows("active", 200).filter((w) => {
    const last = lastDay(w.applyPeriods);
    return last !== "" && last >= today;
  });
}

export function setWindowStatus(
  id: number,
  status: DisasterWindowStatus,
  decision?: DisasterDecision,
): DisasterWindow | null {
  const now = new Date().toISOString();
  if (decision) {
    getDb()
      .prepare(
        `UPDATE disaster_windows SET status = ?, decision = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, decision, now, id);
  } else {
    getDb()
      .prepare(`UPDATE disaster_windows SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, id);
  }
  return getWindow(id);
}

export function updateWindowPeriods(
  id: number,
  periods: ApplyPeriod[],
): DisasterWindow | null {
  getDb()
    .prepare(
      `UPDATE disaster_windows SET apply_periods_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(periods), new Date().toISOString(), id);
  return getWindow(id);
}

/** Mark active/pending windows whose last apply day has passed as expired. */
export function expirePassedWindows(today: string): number {
  let expired = 0;
  for (const w of [...listWindows("active", 500), ...listWindows("pending", 500)]) {
    const last = lastDay(w.applyPeriods);
    if (last && last < today) {
      setWindowStatus(w.id, "expired");
      expired += 1;
    }
  }
  return expired;
}

export function getScanState(source: DisasterScanSource): DisasterScanState | null {
  const row = getDb()
    .prepare(`SELECT * FROM disaster_scan_state WHERE source = ?`)
    .get(source) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    source: row.source as DisasterScanSource,
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    contentHash: (row.content_hash as string | null) ?? null,
  };
}

/**
 * `error` may be set on a successful run to record a partial failure – it shows
 * in /dev without resetting last_success_at, so it does not raise a false alarm.
 */
export function recordScanResult(
  source: DisasterScanSource,
  opts: { ok: boolean; error?: string | null; contentHash?: string | null },
): void {
  const now = new Date().toISOString();
  const existing = getScanState(source);
  getDb()
    .prepare(
      `INSERT INTO disaster_scan_state
        (source, last_success_at, last_attempt_at, last_error, content_hash)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         last_success_at = excluded.last_success_at,
         last_attempt_at = excluded.last_attempt_at,
         last_error = excluded.last_error,
         content_hash = excluded.content_hash`,
    )
    .run(
      source,
      opts.ok ? now : (existing?.lastSuccessAt ?? null),
      now,
      opts.error ?? (opts.ok ? null : "Unknown error"),
      opts.contentHash ?? existing?.contentHash ?? null,
    );
}

/** Days since the source last succeeded; null when it has never succeeded. */
export function daysSinceSuccess(
  source: DisasterScanSource,
  now: Date = new Date(),
): number | null {
  const state = getScanState(source);
  if (!state?.lastSuccessAt) return null;
  const then = Date.parse(state.lastSuccessAt);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / (24 * 60 * 60 * 1000));
}
