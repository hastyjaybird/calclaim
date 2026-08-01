import { Bot, type Context } from "grammy";
import { sanitizeStartPayload } from "../analytics/campaigns.js";
import type { SessionState } from "../corpus/types.js";
import { recordAlphaFeedback } from "../feedback/record.js";
import {
  downloadTelegramFile,
  transcribeVoiceBuffer,
} from "../feedback/transcribe.js";
import { captureTelegramUpdate } from "../db/telegramCapture.js";
import { getOrCreateSession, saveSession } from "../db/session.js";
import { THANKS_FEEDBACK } from "../privacy/copy.js";
import { handleCallback, resetSession, sendOptIn, trackBotStart } from "./flow.js";
import { idleKeyboard } from "./keyboards.js";
import { repeatLastMessage } from "./reply.js";

const COMMANDS = new Set(["/start", "/help", "/stop", "/restart"]);

function isExpectedText(session: SessionState, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (COMMANDS.has(t.split(/\s/)[0] ?? "")) return true;
  if (
    t === "help" ||
    t === "stop" ||
    t === "erase" ||
    t === "start" ||
    t === "restart" ||
    t === "to do" ||
    t === "todo"
  ) {
    return true;
  }
  return false;
}

async function beginFresh(ctx: Context, uid: number): Promise<void> {
  const session = resetSession(uid);
  await sendOptIn(ctx, session);
}

async function acknowledgeFeedback(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  await ctx.reply(THANKS_FEEDBACK);
  const repeated = await repeatLastMessage(ctx, session);
  if (!repeated) {
    await ctx.reply("Tap a button above when you’re ready.");
  }
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Persist everything Telegram exposes on each inbound update
  bot.use(async (ctx, next) => {
    captureTelegramUpdate(ctx);
    await next();
  });

  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const payload = sanitizeStartPayload(ctx.match?.trim());
    const session = resetSession(uid);
    trackBotStart(uid, payload);
    await sendOptIn(ctx, session);
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

  bot.command("restart", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    await beginFresh(ctx, uid);
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
    if (lower === "erase") {
      await handleCallback(ctx, session, "help:erase_ask");
      return;
    }
    if (lower === "start" || lower === "restart") {
      await beginFresh(ctx, uid);
      return;
    }
    if (lower === "to do" || lower === "todo") {
      await handleCallback(ctx, session, "todo:resend");
      return;
    }

    if (isExpectedText(session, text)) return;

    // Alpha feedback (text) — store for developers, do not advance
    recordAlphaFeedback({ session, text, source: "text" });
    await acknowledgeFeedback(ctx, session);
  });

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const session = getOrCreateSession(uid);
    const fileId =
      ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
    if (!fileId) {
      recordAlphaFeedback({
        session,
        text: "[voice/audio with no file id]",
        source: "voice",
        transcriptStatus: "failed",
      });
      await acknowledgeFeedback(ctx, session);
      return;
    }

    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("Missing file_path");
      const buf = await downloadTelegramFile(token, file.file_path);
      const { text, status } = await transcribeVoiceBuffer(buf, "voice.ogg");
      recordAlphaFeedback({
        session,
        text,
        source: "voice",
        transcriptStatus: status,
      });
    } catch (err) {
      console.error("Voice feedback handling failed:", err);
      recordAlphaFeedback({
        session,
        text: "[voice message — download or transcription failed]",
        source: "voice",
        transcriptStatus: "failed",
      });
    }
    await acknowledgeFeedback(ctx, session);
  });

  // Other media: already logged by middleware; treat as soft feedback
  bot.on(
    ["message:contact", "message:location", "message:venue", "message:photo", "message:document"],
    async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const session = getOrCreateSession(uid);
      recordAlphaFeedback({
        session,
        text: `[non-text message: ${ctx.message.photo ? "photo" : ctx.message.document ? "document" : ctx.message.contact ? "contact" : ctx.message.location ? "location" : "media"}]`,
        source: "text",
      });
      await acknowledgeFeedback(ctx, session);
    },
  );

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
