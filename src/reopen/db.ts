import type Database from "better-sqlite3";

let db: Database.Database | null = null;

export function initReopenWatch(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS program_availability_snap (
      program_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized");
  return db;
}

export interface AvailabilitySnapRow {
  programId: string;
  status: string;
  updatedAt: string;
}

export function listAvailabilitySnaps(): AvailabilitySnapRow[] {
  const rows = getDb()
    .prepare(
      "SELECT program_id, status, updated_at FROM program_availability_snap",
    )
    .all() as { program_id: string; status: string; updated_at: string }[];
  return rows.map((r) => ({
    programId: r.program_id,
    status: r.status,
    updatedAt: r.updated_at,
  }));
}

export function upsertAvailabilitySnap(
  programId: string,
  status: string,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO program_availability_snap (program_id, status, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(program_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .run(programId, status, now);
}
