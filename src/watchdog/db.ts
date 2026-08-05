import type Database from "better-sqlite3";
import type {
  DraftFinding,
  Finding,
  FindingStatus,
  ScanRun,
  ScanStatus,
} from "./types.js";

let watchdogDb: Database.Database | null = null;

export function initWatchdog(db: Database.Database): void {
  watchdogDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchdog_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      programs_total INTEGER NOT NULL DEFAULT 0,
      programs_done INTEGER NOT NULL DEFAULT 0,
      findings_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      llm_enabled INTEGER NOT NULL DEFAULT 0,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS watchdog_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      program_id TEXT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      evidence_url TEXT,
      suggested_action TEXT,
      library_field TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES watchdog_scans(id)
    );
    CREATE INDEX IF NOT EXISTS idx_watchdog_findings_scan ON watchdog_findings(scan_id);
    CREATE INDEX IF NOT EXISTS idx_watchdog_findings_status ON watchdog_findings(status);
    CREATE INDEX IF NOT EXISTS idx_watchdog_findings_program ON watchdog_findings(program_id);
  `);
  // Rename legacy column names → library_field on existing DBs.
  const cols = db
    .prepare(`PRAGMA table_info(watchdog_findings)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("library_field")) {
    if (names.has("catalog_field")) {
      db.exec(
        `ALTER TABLE watchdog_findings RENAME COLUMN catalog_field TO library_field`,
      );
    } else if (names.has("corpus_field")) {
      db.exec(
        `ALTER TABLE watchdog_findings RENAME COLUMN corpus_field TO library_field`,
      );
    }
  }
}

function getDb(): Database.Database {
  if (!watchdogDb) throw new Error("Watchdog DB not initialized");
  return watchdogDb;
}

function rowToScan(row: Record<string, unknown>): ScanRun {
  return {
    id: row.id as number,
    status: row.status as ScanStatus,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    programsTotal: row.programs_total as number,
    programsDone: row.programs_done as number,
    findingsCount: row.findings_count as number,
    error: (row.error as string | null) ?? null,
    llmEnabled: Boolean(row.llm_enabled),
    summary: (row.summary as string | null) ?? null,
  };
}

function rowToFinding(row: Record<string, unknown>): Finding {
  return {
    id: row.id as number,
    scanId: row.scan_id as number,
    programId: (row.program_id as string | null) ?? null,
    category: row.category as Finding["category"],
    severity: row.severity as Finding["severity"],
    title: row.title as string,
    detail: row.detail as string,
    evidenceUrl: (row.evidence_url as string | null) ?? null,
    suggestedAction: (row.suggested_action as string | null) ?? null,
    libraryField: (row.library_field as string | null) ?? null,
    status: row.status as FindingStatus,
    source: row.source as Finding["source"],
    createdAt: row.created_at as string,
  };
}

export function createScan(programsTotal: number, llmEnabled: boolean): ScanRun {
  const startedAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO watchdog_scans
        (status, started_at, programs_total, programs_done, findings_count, llm_enabled)
       VALUES ('running', ?, ?, 0, 0, ?)`,
    )
    .run(startedAt, programsTotal, llmEnabled ? 1 : 0);
  return getScan(Number(result.lastInsertRowid))!;
}

export function updateScanProgress(
  scanId: number,
  programsDone: number,
  findingsCount: number,
): void {
  getDb()
    .prepare(
      `UPDATE watchdog_scans SET programs_done = ?, findings_count = ? WHERE id = ?`,
    )
    .run(programsDone, findingsCount, scanId);
}

export function finishScan(
  scanId: number,
  status: "completed" | "failed",
  summary: string | null,
  error: string | null,
  findingsCount: number,
): void {
  getDb()
    .prepare(
      `UPDATE watchdog_scans
       SET status = ?, finished_at = ?, summary = ?, error = ?, findings_count = ?
       WHERE id = ?`,
    )
    .run(status, new Date().toISOString(), summary, error, findingsCount, scanId);
}

export function insertFindings(scanId: number, drafts: DraftFinding[]): number {
  const createdAt = new Date().toISOString();
  const stmt = getDb().prepare(
    `INSERT INTO watchdog_findings
      (scan_id, program_id, category, severity, title, detail, evidence_url,
       suggested_action, library_field, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  );
  const insertMany = getDb().transaction((items: DraftFinding[]) => {
    for (const f of items) {
      stmt.run(
        scanId,
        f.programId,
        f.category,
        f.severity,
        f.title,
        f.detail,
        f.evidenceUrl ?? null,
        f.suggestedAction ?? null,
        f.libraryField ?? null,
        f.source,
        createdAt,
      );
    }
  });
  insertMany(drafts);
  return drafts.length;
}

export function getScan(id: number): ScanRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM watchdog_scans WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToScan(row) : null;
}

export function latestScan(): ScanRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM watchdog_scans ORDER BY id DESC LIMIT 1`)
    .get() as Record<string, unknown> | undefined;
  return row ? rowToScan(row) : null;
}

export function listScans(limit = 20): ScanRun[] {
  const rows = getDb()
    .prepare(`SELECT * FROM watchdog_scans ORDER BY id DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToScan);
}

export function listFindings(opts: {
  scanId?: number;
  status?: FindingStatus | "all";
  limit?: number;
} = {}): Finding[] {
  const limit = opts.limit ?? 200;
  if (opts.scanId != null) {
    const rows = getDb()
      .prepare(
        `SELECT * FROM watchdog_findings WHERE scan_id = ? ORDER BY
          CASE severity
            WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
            WHEN 'low' THEN 3 ELSE 4 END,
          id ASC
         LIMIT ?`,
      )
      .all(opts.scanId, limit) as Record<string, unknown>[];
    return rows.map(rowToFinding);
  }
  const status = opts.status ?? "open";
  if (status === "all") {
    const rows = getDb()
      .prepare(
        `SELECT * FROM watchdog_findings ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToFinding);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM watchdog_findings WHERE status = ? ORDER BY
        CASE severity
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
          WHEN 'low' THEN 3 ELSE 4 END,
        id DESC
       LIMIT ?`,
    )
    .all(status, limit) as Record<string, unknown>[];
  return rows.map(rowToFinding);
}

export function countOpenFindingsByProgram(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT program_id, COUNT(*) AS n FROM watchdog_findings
       WHERE status = 'open' AND program_id IS NOT NULL
       GROUP BY program_id`,
    )
    .all() as Array<{ program_id: string; n: number }>;
  return new Map(rows.map((r) => [r.program_id, r.n]));
}

export function setFindingStatus(id: number, status: FindingStatus): Finding | null {
  getDb()
    .prepare(`UPDATE watchdog_findings SET status = ? WHERE id = ?`)
    .run(status, id);
  const row = getDb()
    .prepare(`SELECT * FROM watchdog_findings WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToFinding(row) : null;
}

export function hasRunningScan(): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM watchdog_scans WHERE status = 'running' LIMIT 1`)
    .get() as { id: number } | undefined;
  return Boolean(row);
}
