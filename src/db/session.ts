import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initAnalytics } from "../analytics/db.js";
import type { SessionState } from "../library/types.js";
import { initDisasterWindows } from "../disaster/db.js";
import { initFeedbackTodos } from "../feedback/todos.js";
import { initPartnerSignup } from "../partners/db.js";
import { eraseTelegramUserData, initTelegramCapture } from "./telegramCapture.js";
import { initWatchdog } from "../watchdog/db.js";
import { eraseSessionProgramLog, writeSessionProgramLog } from "./sessionLog.js";

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
  initAnalytics(db);
  initWatchdog(db);
  initTelegramCapture(db);
  initFeedbackTodos(db);
  initPartnerSignup(db);
  initDisasterWindows(db);
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
    billNotInMyName: false,
    hasChildInHousehold: null,
    hasAgedBlindOrDisabled: null,
    workDisruption: null,
    inDisasterArea: null,
    residenceZip: null,
    residenceCounty: null,
    docsInHand: [],
    queue: [],
    queueIndex: 0,
    alreadyOn: [],
    items: [],
    remindersEnabled: false,
    remindersStopped: false,
    awaitingConfirm: null,
    lastBotMessage: null,
    campaignId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadSession(telegramUserId: number): SessionState | null {
  const row = getDb()
    .prepare("SELECT state_json FROM sessions WHERE telegram_user_id = ?")
    .get(telegramUserId) as { state_json: string } | undefined;
  if (!row) return null;
  const state = JSON.parse(row.state_json) as SessionState;
  if (state.lastBotMessage === undefined) state.lastBotMessage = null;
  if (state.hasChildInHousehold === undefined) state.hasChildInHousehold = null;
  if (state.hasAgedBlindOrDisabled === undefined) {
    state.hasAgedBlindOrDisabled = null;
  }
  if (state.workDisruption === undefined) state.workDisruption = null;
  if (state.inDisasterArea === undefined) state.inDisasterArea = null;
  if (state.residenceZip === undefined) state.residenceZip = null;
  if (state.residenceCounty === undefined) state.residenceCounty = null;
  if (state.remindersStopped === undefined) state.remindersStopped = false;
  if (state.campaignId === undefined) state.campaignId = null;
  return state;
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
  writeSessionProgramLog(state);
}

export function deleteSession(telegramUserId: number): void {
  eraseTelegramUserData(telegramUserId);
  eraseSessionProgramLog(telegramUserId);
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
    .filter(
      (s) =>
        s.remindersEnabled &&
        !s.remindersStopped &&
        s.items.some(
          (i) =>
            i.status === "todo" ||
            i.status === "in_progress" ||
            i.status === "snoozed",
        ),
    );
}
