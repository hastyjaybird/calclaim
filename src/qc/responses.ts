import fs from "node:fs";
import { RESPONSES_PATH, DATA_DIR } from "../config.js";
import type { SessionState } from "../corpus/types.js";

export interface QcRecord {
  ts: string;
  telegramUserId: number;
  step: string;
  question: string;
  rawText: string;
  sessionSnapshot: Partial<SessionState>;
}

export function appendQcResponse(
  session: SessionState,
  rawText: string,
): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const record: QcRecord = {
    ts: new Date().toISOString(),
    telegramUserId: session.telegramUserId,
    step: session.step,
    question: session.step,
    rawText,
    sessionSnapshot: {
      branch: session.branch,
      householdSize: session.householdSize,
      incomeBand: session.incomeBand,
      queueIndex: session.queueIndex,
      queue: session.queue,
      alreadyOn: session.alreadyOn,
      language: session.language,
    },
  };
  fs.appendFileSync(RESPONSES_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

export function eraseUserQc(telegramUserId: number): void {
  if (!fs.existsSync(RESPONSES_PATH)) return;
  const lines = fs.readFileSync(RESPONSES_PATH, "utf8").split("\n").filter(Boolean);
  const kept = lines.filter((line) => {
    try {
      const row = JSON.parse(line) as QcRecord;
      return row.telegramUserId !== telegramUserId;
    } catch {
      return true;
    }
  });
  fs.writeFileSync(RESPONSES_PATH, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
}
