import cron from "node-cron";
import type { Bot } from "grammy";
import {
  getOrCreateSession,
  listIncompleteInactiveSessions,
  listReminderSessions,
  saveSession,
} from "../db/session.js";
import { closestDeadline, openTodos } from "../nextsteps/model.js";
import type { NextStepsItem } from "../library/types.js";
import { inactivityNudgeKeyboard } from "../bot/keyboards.js";

function todayYmd(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysUntil(dateYmd: string, tz: string): number {
  const today = todayYmd(tz);
  const t0 = Date.parse(`${today}T12:00:00`);
  const t1 = Date.parse(`${dateYmd}T12:00:00`);
  return Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
}

function formatItem(item: NextStepsItem): string {
  return `${item.programName}: ${item.action}\n${item.link}`;
}

async function send(bot: Bot, userId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(userId, text);
  } catch (err) {
    console.error(`Reminder failed for ${userId}:`, err);
  }
}

const INACTIVITY_NUDGE_TEXT =
  "Hundreds of thousands of eligible people never follow through to get paid out the benefits they qualify for. Just wanted to remind you that we are here to help.";

/** Ping users who stalled before the Application Guide after 2 weeks idle. */
export async function runInactivityNudgePass(bot: Bot): Promise<number> {
  const sessions = listIncompleteInactiveSessions();
  let messaged = 0;

  for (const session of sessions) {
    try {
      await bot.api.sendMessage(session.telegramUserId, INACTIVITY_NUDGE_TEXT, {
        reply_markup: inactivityNudgeKeyboard(),
      });
      // Bump updatedAt so we do not re-ping until another 2 weeks of silence.
      const live = getOrCreateSession(session.telegramUserId);
      saveSession(live);
      messaged += 1;
    } catch (err) {
      console.error(
        `Inactivity nudge failed for ${session.telegramUserId}:`,
        err,
      );
    }
  }

  return messaged;
}

export function startReminderCron(bot: Bot, tz: string): void {
  // Every day at 12:00 America/Los_Angeles – handles Tue closest + T-3 + T-1
  // plus 2-week inactivity nudges for incomplete journeys.
  cron.schedule(
    "0 12 * * *",
    async () => {
      const sessions = listReminderSessions();
      const today = todayYmd(tz);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      }).format(new Date());

      for (const session of sessions) {
        const open = openTodos(session);
        const dated = open.filter((i) => i.deadlineDate);
        const messages: string[] = [];

        for (const item of dated) {
          const d = daysUntil(item.deadlineDate!, tz);
          if (d === 3) {
            messages.push(`Due in 3 days: ${formatItem(item)}`);
          } else if (d === 1) {
            messages.push(`Due tomorrow: ${formatItem(item)}`);
          }
        }

        if (weekday === "Tue") {
          const closest = closestDeadline(session);
          if (closest?.deadlineDate) {
            const d = daysUntil(closest.deadlineDate, tz);
            // Avoid duplicate if already T-3 or T-1 today
            if (d !== 3 && d !== 1) {
              messages.push(
                `Tuesday check-in – closest deadline:\n${formatItem(closest)}\nDeadline: ${closest.deadlineLabel} (${closest.deadlineDate})`,
              );
            }
          }
        }

        if (messages.length) {
          await send(
            bot,
            session.telegramUserId,
            `${messages.join("\n\n")}\n\nSay 'guide' anytime for your Application Guide. Say STOP to pause reminders, or erase to delete your data.`,
          );
        }
      }

      const nudged = await runInactivityNudgePass(bot);
      console.log(
        `Reminders scanned ${sessions.length} sessions on ${today} (${weekday}); inactivity nudges sent ${nudged}`,
      );
    },
    { timezone: tz },
  );

  console.log(`Reminder cron armed (daily 12:00 ${tz})`);
}
