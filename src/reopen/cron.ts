import cron from "node-cron";
import type { Bot } from "grammy";
import {
  getOrCreateSession,
  listReopenNotifySessions,
  saveSession,
} from "../db/session.js";
import { getProgram, loadPrograms } from "../library/load.js";
import {
  isHeldFromOffer,
  isOpenNow,
  programAvailability,
} from "../library/requirements.js";
import { buildQueue } from "../queue/ranker.js";
import {
  listAvailabilitySnaps,
  upsertAvailabilitySnap,
} from "./db.js";

function wasHeld(status: string): boolean {
  return status === "paused" || status === "closed";
}

/**
 * Daily: detect waitlisted/paused/closed → open transitions, then text only
 * users who opted in, still have alerts on, still qualify on their saved
 * profile, and were watching that program.
 */
export function startReopenNotifyCron(bot: Bot, tz: string): void {
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        await runReopenNotifyPass(bot);
      } catch (err) {
        console.error("Reopen notify cron failed:", err);
      }
    },
    { timezone: tz },
  );
  console.log(`Reopen-notify cron scheduled daily 08:00 ${tz}`);
}

export async function runReopenNotifyPass(bot: Bot): Promise<{
  reopened: string[];
  messaged: number;
}> {
  const prior = new Map(
    listAvailabilitySnaps().map((r) => [r.programId, r.status]),
  );
  const reopened: string[] = [];

  for (const program of loadPrograms()) {
    const status = programAvailability(program).status;
    const prev = prior.get(program.id);
    upsertAvailabilitySnap(program.id, status);

    // First snapshot day: seed only, do not fan out.
    if (prev == null) continue;
    if (wasHeld(prev) && isOpenNow(status) && !isHeldFromOffer(status)) {
      reopened.push(program.id);
    }
  }

  if (!reopened.length) return { reopened, messaged: 0 };

  let messaged = 0;
  for (const session of listReopenNotifySessions()) {
    const openEligible = new Set(
      buildQueue(session, {
        immigrationStatus: session.savedImmigrationStatus,
      }),
    );

    const hits = reopened.filter(
      (id) =>
        session.reopenWatchProgramIds.includes(id) && openEligible.has(id),
    );
    if (!hits.length) continue;

    const names = hits.map((id) => getProgram(id)?.name ?? id);
    const links = hits
      .map((id) => {
        const p = getProgram(id);
        return p ? `${p.name}: ${p.applyUrl}` : null;
      })
      .filter((x): x is string => Boolean(x));

    const text = [
      "Good news – a program you may qualify for is open again:",
      ...names.map((n) => `• ${n}`),
      "",
      ...links,
      "",
      "Your saved answers were used to check this. If anything changed, tap Restart to go through again – that rewrites your profile.",
      "",
      "Say STOP to pause these alerts (and deadline reminders). Say erase to delete your data.",
    ].join("\n");

    try {
      await bot.api.sendMessage(session.telegramUserId, text);
      messaged += 1;

      const live = getOrCreateSession(session.telegramUserId);
      live.reopenWatchProgramIds = live.reopenWatchProgramIds.filter(
        (id) => !hits.includes(id),
      );
      saveSession(live);
    } catch (err) {
      console.error(
        `Reopen notify failed for ${session.telegramUserId}:`,
        err,
      );
    }
  }

  return { reopened, messaged };
}
