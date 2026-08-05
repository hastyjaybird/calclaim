import { Bot, GrammyError, HttpError, type Context } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { sanitizeStartPayload } from "../analytics/campaigns.js";
import { DATA_DIR } from "../config.js";
import type { SessionState } from "../library/types.js";
import { recordAlphaFeedback } from "../feedback/record.js";
import {
  downloadTelegramFile,
  transcribeVoiceBuffer,
} from "../feedback/transcribe.js";
import { captureTelegramUpdate } from "../db/telegramCapture.js";
import { getOrCreateSession, saveSession } from "../db/session.js";
import {
  errorAck,
  greetingAck,
  interpretMessage,
  mediaAck,
  suggestAck,
  unknownAck,
  type CommandName,
  type TextIntent,
} from "./interpret.js";
import {
  handleCallback,
  resetSession,
  resumeRemindersAfterMessage,
  sendOptIn,
  trackBotStart,
} from "./flow.js";
import { idleKeyboard } from "./keyboards.js";
import { openTodos } from "../nextsteps/model.js";
import { repeatLastMessage } from "./reply.js";

// #region agent log
function agentDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {},
): void {
  const payload = {
    sessionId: "f9190a",
    runId: "pre-fix",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(DATA_DIR, "debug-f9190a.log"),
      `${JSON.stringify(payload)}\n`,
    );
  } catch {
    /* ignore */
  }
  console.log(`[agent-debug] ${hypothesisId} ${location} ${message}`, data);
  fetch("http://127.0.0.1:7580/ingest/e4761444-e2e7-4508-a7a4-f01794aab8cf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "f9190a",
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

async function noteRemindersResumed(ctx: Context): Promise<void> {
  await ctx.reply("Reminders are back on.");
}

async function safeReply(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text);
  } catch (err) {
    console.error("safeReply failed:", err);
  }
}

async function reorient(
  ctx: Context,
  session: SessionState,
  lead: string,
): Promise<void> {
  await safeReply(ctx, lead);
  const repeated = await repeatLastMessage(ctx, session).catch(() => false);
  if (!repeated) {
    await safeReply(
      ctx,
      "Tap a button below when you're ready — or type help.",
    );
  }
}

async function beginFresh(ctx: Context, uid: number): Promise<void> {
  const session = resetSession(uid);
  await sendOptIn(ctx, session);
}

async function dispatchCommand(
  ctx: Context,
  session: SessionState,
  uid: number,
  command: CommandName,
): Promise<void> {
  switch (command) {
    case "stop":
      await handleCallback(ctx, session, "stop:ask");
      return;
    case "help":
      await handleCallback(ctx, session, "help:menu");
      return;
    case "share":
      await handleCallback(ctx, session, "help:share");
      return;
    case "email":
      await handleCallback(ctx, session, "idle:email");
      return;
    case "erase":
      await handleCallback(ctx, session, "help:erase_ask");
      return;
    case "start":
    case "restart":
      await beginFresh(ctx, uid);
      return;
    case "todo":
      await handleCallback(ctx, session, "todo:resend");
      return;
  }
}

async function handleInterpretedText(
  ctx: Context,
  session: SessionState,
  uid: number,
  rawText: string,
  source: "text" | "voice",
): Promise<boolean> {
  const intent: TextIntent = interpretMessage(rawText, session);

  if (intent.kind === "command") {
    // STOP should not resume reminders; everything else may.
    if (intent.command !== "stop") {
      if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
    }
    await dispatchCommand(ctx, session, uid, intent.command);
    return true;
  }

  if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);

  if (intent.kind === "step_answer") {
    await handleCallback(ctx, session, intent.callback);
    return true;
  }

  if (intent.kind === "greeting") {
    await reorient(ctx, session, greetingAck(session.step));
    return true;
  }

  if (intent.kind === "suggest") {
    await reorient(
      ctx,
      session,
      suggestAck(intent.display, session.step),
    );
    return true;
  }

  // Unknown — log as alpha feedback, stay on the same step
  // Never store free-text while asking immigration status (privacy promise).
  if (session.step !== "has_immigration_status") {
    recordAlphaFeedback({
      session,
      text: rawText,
      source,
      transcriptStatus: source === "voice" ? "ok" : undefined,
    });
  }
  await reorient(ctx, session, unknownAck(session.step));
  return true;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Persist everything Telegram exposes on each inbound update
  bot.use(async (ctx, next) => {
    // #region agent log
    agentDebugLog("B", "createBot.ts:middleware", "update_received", {
      updateId: ctx.update.update_id,
      uid: ctx.from?.id ?? null,
      hasMessage: Boolean(ctx.message),
      hasCallback: Boolean(ctx.callbackQuery),
      text: ctx.message?.text?.slice(0, 80) ?? null,
      callback: ctx.callbackQuery?.data ?? null,
    });
    // #endregion
    captureTelegramUpdate(ctx);
    await next();
  });

  bot.command("start", async (ctx) => {
    const uid = ctx.from?.id;
    // #region agent log
    agentDebugLog("A", "createBot.ts:start", "start_handler_enter", {
      uid: uid ?? null,
      match: ctx.match ?? null,
      text: ctx.message?.text?.slice(0, 80) ?? null,
    });
    // #endregion
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    const payload = sanitizeStartPayload(ctx.match?.trim());
    const session = resetSession(uid);
    session.campaignId = payload;
    saveSession(session);
    trackBotStart(uid, payload);
    // #region agent log
    agentDebugLog("A", "createBot.ts:start", "start_before_sendOptIn", {
      uid,
      payload,
      step: session.step,
    });
    // #endregion
    try {
      await sendOptIn(ctx, session);
      // #region agent log
      agentDebugLog("C", "createBot.ts:start", "start_sendOptIn_ok", { uid });
      // #endregion
    } catch (err) {
      // #region agent log
      agentDebugLog("C", "createBot.ts:start", "start_sendOptIn_fail", {
        uid,
        err: err instanceof Error ? err.message : String(err),
      });
      // #endregion
      throw err;
    }
  });

  bot.command("help", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    const session = getOrCreateSession(uid);
    session.step = "help_menu";
    saveSession(session);
    await handleCallback(ctx, session, "help:menu");
  });

  bot.command("stop", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    const session = getOrCreateSession(uid);
    await handleCallback(ctx, session, "stop:ask");
  });

  bot.command("restart", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    await beginFresh(ctx, uid);
  });

  bot.on("callback_query:data", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    const session = getOrCreateSession(uid);
    const data = ctx.callbackQuery.data;
    // #region agent log
    agentDebugLog("E", "createBot.ts:callback", "callback_enter", {
      uid,
      data,
      step: session.step,
    });
    // #endregion
    await handleCallback(ctx, session, data);
    // #region agent log
    agentDebugLog("E", "createBot.ts:callback", "callback_done", {
      uid,
      data,
      step: session.step,
    });
    // #endregion
  });

  bot.on("message:text", async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    // Slash commands are handled by bot.command(...) above — don't double-run.
    const text = ctx.message.text ?? "";
    if (text.startsWith("/")) return;
    const session = getOrCreateSession(uid);
    await handleInterpretedText(ctx, session, uid, text, "text");
  });

  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    const session = getOrCreateSession(uid);
    const fileId =
      ctx.message.voice?.file_id ?? ctx.message.audio?.file_id;
    if (!fileId) {
      if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
      recordAlphaFeedback({
        session,
        text: "[voice/audio with no file id]",
        source: "voice",
        transcriptStatus: "failed",
      });
      await reorient(ctx, session, mediaAck(session.step));
      return;
    }

    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("Missing file_path");
      const buf = await downloadTelegramFile(token, file.file_path);
      const { text, status } = await transcribeVoiceBuffer(buf, "voice.ogg");

      if (text && status === "ok") {
        const intent = interpretMessage(text, session);
        if (intent.kind !== "unknown") {
          await handleInterpretedText(ctx, session, uid, text, "voice");
          return;
        }
        recordAlphaFeedback({
          session,
          text,
          source: "voice",
          transcriptStatus: status,
        });
        if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
        await reorient(ctx, session, unknownAck(session.step));
        return;
      }

      recordAlphaFeedback({
        session,
        text: text || "[voice — empty transcript]",
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
    if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
    await reorient(ctx, session, mediaAck(session.step));
  });

  // Other media: already logged by middleware; treat as soft feedback
  bot.on(
    [
      "message:contact",
      "message:location",
      "message:venue",
      "message:photo",
      "message:document",
      "message:sticker",
      "message:video",
      "message:animation",
      "message:video_note",
    ],
    async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) {
        await safeReply(ctx, errorAck());
        return;
      }
      const session = getOrCreateSession(uid);
      if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
      const kind = ctx.message.photo
        ? "photo"
        : ctx.message.document
          ? "document"
          : ctx.message.contact
            ? "contact"
            : ctx.message.location
              ? "location"
              : ctx.message.sticker
                ? "sticker"
                : ctx.message.video
                  ? "video"
                  : "media";
      recordAlphaFeedback({
        session,
        text: `[non-text message: ${kind}]`,
        source: "text",
      });
      await reorient(ctx, session, mediaAck(session.step));
    },
  );

  // Catch-all: any other message type still gets a human reply
  bot.on("message", async (ctx) => {
    // Skip if a more specific handler already ran (grammy won't double-fire
    // the same update through overlapping filters in practice for these, but
    // text/voice/media are registered above — this catches leftovers).
    if (
      ctx.message.text ||
      ctx.message.voice ||
      ctx.message.audio ||
      ctx.message.photo ||
      ctx.message.document ||
      ctx.message.contact ||
      ctx.message.location ||
      ctx.message.venue ||
      ctx.message.sticker ||
      ctx.message.video ||
      ctx.message.animation ||
      ctx.message.video_note
    ) {
      return;
    }
    const uid = ctx.from?.id;
    if (!uid) {
      await safeReply(ctx, errorAck());
      return;
    }
    const session = getOrCreateSession(uid);
    if (resumeRemindersAfterMessage(session)) await noteRemindersResumed(ctx);
    recordAlphaFeedback({
      session,
      text: "[unsupported message type]",
      source: "text",
    });
    await reorient(ctx, session, mediaAck(session.step));
  });

  bot.catch(async (err) => {
    const ctx = err.ctx;
    console.error("Bot error:", err.error);
    // #region agent log
    agentDebugLog("A", "createBot.ts:catch", "bot_error", {
      uid: ctx.from?.id ?? null,
      err:
        err.error instanceof Error
          ? err.error.message
          : String(err.error),
      grammy:
        err.error instanceof GrammyError ? err.error.description : null,
    });
    // #endregion
    if (err.error instanceof GrammyError) {
      console.error("Grammy error:", err.error.description);
    } else if (err.error instanceof HttpError) {
      console.error("HTTP error talking to Telegram:", err.error);
    }
    await safeReply(ctx, errorAck());
    const uid = ctx.from?.id;
    if (uid) {
      const session = getOrCreateSession(uid);
      await repeatLastMessage(ctx, session).catch(() => undefined);
    }
  });

  return bot;
}

/** Used by reminder cron */
export async function sendReminder(
  bot: Bot,
  ctxLike: { telegramUserId: number; text: string },
): Promise<void> {
  const session = getOrCreateSession(ctxLike.telegramUserId);
  await bot.api.sendMessage(ctxLike.telegramUserId, ctxLike.text, {
    reply_markup: idleKeyboard(openTodos(session).length > 0),
  });
}

export type { Context };
