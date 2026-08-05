import type { Context } from "grammy";
import type { LastBotMessage, SessionState } from "../library/types.js";
import { saveSession } from "../db/session.js";

type ReplyExtra = Parameters<Context["reply"]>[1];

function serializeMarkup(markup: unknown): LastBotMessage["replyMarkup"] {
  if (!markup || typeof markup !== "object") return null;
  if ("inline_keyboard" in markup) {
    return {
      inline_keyboard: (markup as { inline_keyboard: unknown }).inline_keyboard,
    };
  }
  return null;
}

/** Send a bot prompt and remember it so alpha feedback can re-show the same screen. */
export async function replyTracked(
  ctx: Context,
  session: SessionState,
  text: string,
  extra?: ReplyExtra,
): Promise<void> {
  await ctx.reply(text, extra);
  session.lastBotMessage = {
    text,
    replyMarkup: serializeMarkup(extra?.reply_markup),
  };
  saveSession(session);
}

export async function repeatLastMessage(
  ctx: Context,
  session: SessionState,
): Promise<boolean> {
  const last = session.lastBotMessage;
  if (!last?.text) return false;
  await ctx.reply(
    last.text,
    last.replyMarkup
      ? { reply_markup: last.replyMarkup as never }
      : undefined,
  );
  return true;
}
