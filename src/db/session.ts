import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { SessionState } from "../corpus/types.js";

let db: Database.Database | null = null;

export function initDb(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  db = new Database(databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      telegram_user_id INTEGER PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("DB not initialized");
  return db;
}

export function emptySession(telegramUserId: number): SessionState {
  const now = new Date().toISOString();
  return {
    telegramUserId,
    step: "opt_in",
    branch: null,
    language: "en",
    householdSize: null,
    incomeBand: null,
    pastDue: null,
    docsInHand: [],
    queue: [],
    queueIndex: 0,
    alreadyOn: [],
    items: [],
    remindersEnabled: false,
    awaitingConfirm: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadSession(telegramUserId: number): SessionState | null {
  const row = getDb()
    .prepare("SELECT state_json FROM sessions WHERE telegram_user_id = ?")
    .get(telegramUserId) as { state_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.state_json) as SessionState;
}

export function saveSession(state: SessionState): void {
  state.updatedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO sessions (telegram_user_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    )
    .run(state.telegramUserId, JSON.stringify(state), state.updatedAt);
}

export function deleteSession(telegramUserId: number): void {
  getDb()
    .prepare("DELETE FROM sessions WHERE telegram_user_id = ?")
    .run(telegramUserId);
}

export function getOrCreateSession(telegramUserId: number): SessionState {
  const existing = loadSession(telegramUserId);
  if (existing) return existing;
  const fresh = emptySession(telegramUserId);
  saveSession(fresh);
  return fresh;
}

export function listReminderSessions(): SessionState[] {
  const rows = getDb()
    .prepare("SELECT state_json FROM sessions")
    .all() as { state_json: string }[];
  return rows
    .map((r) => JSON.parse(r.state_json) as SessionState)
    .filter((s) => s.remindersEnabled && s.items.some((i) => i.status === "todo" || i.status === "in_progress" || i.status === "snoozed"));
}
