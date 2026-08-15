import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { initAnalytics } from "../analytics/db.js";
import {
  erasePeerShareToken,
  eraseReferralEdgesForUser,
  initPeerShare,
} from "../analytics/peerShare.js";
import type { SessionState } from "../library/types.js";
import { migrateBillsInMyName } from "../library/utilityBills.js";
import { initDisasterWindows } from "../disaster/db.js";
import { initFeedbackTodos } from "../feedback/todos.js";
import { initPartnerSignup } from "../partners/db.js";
import { initPartnerEvents } from "../partners/events.js";
import { eraseTelegramUserData, initTelegramCapture } from "./telegramCapture.js";
import { initWatchdog } from "../watchdog/db.js";
import { initReopenWatch } from "../reopen/db.js";
import { initDonations } from "../donate/db.js";
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
  initPeerShare(db);
  initWatchdog(db);
  initTelegramCapture(db);
  initFeedbackTodos(db);
  initPartnerSignup(db);
  initPartnerEvents(db);
  initDisasterWindows(db);
  initReopenWatch(db);
  initDonations(db);
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
    utilityBillsAsked: false,
    billsInMyName: [],
    billNotInMyName: false,
    meterSharing: null,
    inShutoffZone: null,
    shutoffAddressChoices: null,
    residencyTie: null,
    isCaResident: null,
    buyingEvThisYear: null,
    firstTimeZev: null,
    buyingEbikeThisYear: null,
    wouldRetireVehicle: null,
    hasChildInHousehold: null,
    isFosterYouth: null,
    isRefugeeOrAsylee: null,
    hasMedicalDeviceOrCondition: null,
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
    reopenNotifyOptIn: null,
    reopenWatchProgramIds: [],
    savedImmigrationStatus: null,
    awaitingConfirm: null,
    lastBotMessage: null,
    campaignId: null,
    screensSeen: [],
    screenShownAt: null,
    undoStack: [],
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
  if (state.isCaResident === undefined) state.isCaResident = null;
  if (state.residencyTie === undefined) {
    // Migrate older sessions that only stored isCaResident.
    if (state.isCaResident === true) state.residencyTie = "ca_home";
    else if (state.isCaResident === false) state.residencyTie = "out_of_state";
    else state.residencyTie = null;
  }
  if (state.utilityBillsAsked === undefined) {
    // Older sessions only had billNotInMyName (from the past-due third button).
    state.utilityBillsAsked = state.billNotInMyName === true;
    state.billsInMyName = state.billNotInMyName ? ["none"] : [];
  }
  if (state.billsInMyName === undefined) {
    state.billsInMyName = state.billNotInMyName ? ["none"] : [];
  }
  // Collapse legacy PG&E electric/gas + heating_cooling ids.
  state.billsInMyName = migrateBillsInMyName(state.billsInMyName);
  if (state.meterSharing === undefined) state.meterSharing = null;
  if (state.inShutoffZone === undefined) state.inShutoffZone = null;
  if (state.shutoffAddressChoices === undefined) {
    state.shutoffAddressChoices = null;
  }
  if (state.buyingEvThisYear === undefined) state.buyingEvThisYear = null;
  if (state.firstTimeZev === undefined) state.firstTimeZev = null;
  if (state.buyingEbikeThisYear === undefined) state.buyingEbikeThisYear = null;
  if (state.wouldRetireVehicle === undefined) state.wouldRetireVehicle = null;
  if (state.hasChildInHousehold === undefined) state.hasChildInHousehold = null;
  if (state.isFosterYouth === undefined) state.isFosterYouth = null;
  if (state.isRefugeeOrAsylee === undefined) state.isRefugeeOrAsylee = null;
  if (state.hasMedicalDeviceOrCondition === undefined) {
    state.hasMedicalDeviceOrCondition = null;
  }
  if (state.hasAgedBlindOrDisabled === undefined) {
    state.hasAgedBlindOrDisabled = null;
  }
  if (state.workDisruption === undefined) state.workDisruption = null;
  if (state.inDisasterArea === undefined) state.inDisasterArea = null;
  if (state.residenceZip === undefined) state.residenceZip = null;
  if (state.residenceCounty === undefined) state.residenceCounty = null;
  if (state.remindersStopped === undefined) state.remindersStopped = false;
  if (state.reopenNotifyOptIn === undefined) state.reopenNotifyOptIn = null;
  if (state.reopenWatchProgramIds === undefined) {
    state.reopenWatchProgramIds = [];
  }
  if (state.savedImmigrationStatus === undefined) {
    state.savedImmigrationStatus = null;
  }
  if (state.campaignId === undefined) state.campaignId = null;
  if (state.screensSeen === undefined) state.screensSeen = [];
  if (state.screenShownAt === undefined) state.screenShownAt = null;
  if (state.undoStack === undefined) state.undoStack = [];
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
  erasePeerShareToken(telegramUserId);
  eraseReferralEdgesForUser(telegramUserId);
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

/** Users who opted in to waitlist/paused reopen alerts and have not STOPped. */
export function listReopenNotifySessions(): SessionState[] {
  const rows = getDb()
    .prepare("SELECT state_json FROM sessions")
    .all() as { state_json: string }[];
  return rows
    .map((r) => {
      const state = JSON.parse(r.state_json) as SessionState;
      if (state.reopenNotifyOptIn === undefined) state.reopenNotifyOptIn = null;
      if (state.reopenWatchProgramIds === undefined) {
        state.reopenWatchProgramIds = [];
      }
      if (state.savedImmigrationStatus === undefined) {
        state.savedImmigrationStatus = null;
      }
      if (state.remindersStopped === undefined) state.remindersStopped = false;
      return state;
    })
    .filter(
      (s) =>
        s.reopenNotifyOptIn === true &&
        !s.remindersStopped &&
        s.reopenWatchProgramIds.length > 0,
    );
}
