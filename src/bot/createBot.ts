import { Bot, type Context } from "grammy";
import type { SessionState } from "../corpus/types.js";
import { getOrCreateSession, saveSession } from "../db/session.js";
import { THANKS_REDIRECT } from "../privacy/copy.js";
import { appendQcResponse } from "../qc/responses.js";
import { handleCallback, resetSession, sendOptIn } from "./flow.js";
import { idleKeyboard } from "./keyboards.js";

const COMMANDS = new Set(["/start", "/help", "/stop"]);

function isExpectedText(session: SessionState, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (COMMANDS.has(t.split(/\s/)[0] ?? "")) return true;
  if (t === "help" || t === "stop" || t === "start") return true;
  return false;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const session = resetSession(uid);
    await sendOptIn(ctx);
    saveSession(session);
  });

  bot.command("help", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const session = getOrCreateSession(uid);
    session.step = "help_menu";
    saveSession(session);
    await handleCallback(ctx, session, "help:menu");
  });

  bot.command("stop", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const session = getOrCreateSession(uid);
    await handleCallback(ctx, session, "stop:ask");
  });

  bot.on("callback_query:data", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const session = getOrCreateSession(uid);
    const data = ctx.callbackQuery.data;
    await handleCallback(ctx, session, data);
  });

  bot.on("message:text", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const text = ctx.message.text.trim();
    const lower = text.toLowerCase();
    const session = getOrCreateSession(uid);

    if (lower === "help") {
      await handleCallback(ctx, session, "help:menu");
      return;
    }
    if (lower === "stop") {
      await handleCallback(ctx, session, "stop:ask");
      return;
    }
    if (lower === "start") {
      const fresh = resetSession(uid);
      await sendOptIn(ctx);
      saveSession(fresh);
      return;
    }

    if (isExpectedText(session, text)) return;

    // Free-form / gibberish — quiet QC log, do not advance
    appendQcResponse(session, text);
    await ctx.reply(THANKS_REDIRECT);
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

/** Used by reminder cron */
export async function sendReminder(
  bot: Bot,
  ctxLike: { telegramUserId: number; text: string },
): Promise<void> {
  await bot.api.sendMessage(ctxLike.telegramUserId, ctxLike.text, {
    reply_markup: idleKeyboard(),
  });
}

export type { Context };
