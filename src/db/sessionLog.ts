import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.js";
import type { SessionState } from "../library/types.js";
import { buildProgramStatusRows } from "../queue/statusLog.js";

const SESSION_LOG_DIR = path.join(DATA_DIR, "session-logs");

function logPath(telegramUserId: number): string {
  return path.join(SESSION_LOG_DIR, `${telegramUserId}.json`);
}

/**
 * Per-user QC log: every library program's status (offered, signed up,
 * skipped, not eligible + why, etc). Rewritten on every session save so it
 * always reflects current state – first write happens when the session is
 * created (opt-in / /start).
 */
export function writeSessionProgramLog(session: SessionState): void {
  try {
    fs.mkdirSync(SESSION_LOG_DIR, { recursive: true });
    const payload = {
      telegramUserId: session.telegramUserId,
      updatedAt: session.updatedAt,
      step: session.step,
      branch: session.branch,
      householdSize: session.householdSize,
      incomeBand: session.incomeBand,
      pastDue: session.pastDue,
      hasChildInHousehold: session.hasChildInHousehold,
      hasAgedBlindOrDisabled: session.hasAgedBlindOrDisabled,
      residenceZip: session.residenceZip,
      residenceCounty: session.residenceCounty,
      campaignId: session.campaignId,
      programs: buildProgramStatusRows(session),
    };
    fs.writeFileSync(logPath(session.telegramUserId), JSON.stringify(payload, null, 2));
  } catch (err) {
    // Logging must never break the bot flow.
    console.error("writeSessionProgramLog failed:", err);
  }
}

/** Erase/STOP+erase and /start-reset both wipe this user's data. */
export function eraseSessionProgramLog(telegramUserId: number): void {
  try {
    fs.rmSync(logPath(telegramUserId), { force: true });
  } catch (err) {
    console.error("eraseSessionProgramLog failed:", err);
  }
}
