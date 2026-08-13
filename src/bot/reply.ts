import type { Context } from "grammy";
import { trackExperienceScreen } from "../analytics/screens.js";
import type { LastBotMessage, SessionState } from "../library/types.js";
import { saveSession } from "../db/session.js";
import { shutoffAddressReplyKeyboard } from "./keyboards.js";

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
  const parseMode = extra?.parse_mode;
  session.lastBotMessage = {
    text,
    replyMarkup: serializeMarkup(extra?.reply_markup),
    ...(parseMode === "HTML" ||
    parseMode === "Markdown" ||
    parseMode === "MarkdownV2"
      ? { parseMode }
      : {}),
  };
  trackExperienceScreen(session);
  saveSession(session);
}

export async function repeatLastMessage(
  ctx: Context,
  session: SessionState,
): Promise<boolean> {
  const last = session.lastBotMessage;
  if (!last?.text) return false;
  const replyMarkup =
    session.step === "has_shutoff_address"
      ? shutoffAddressReplyKeyboard()
      : last.replyMarkup
        ? (last.replyMarkup as never)
        : undefined;
  await ctx.reply(last.text, {
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(last.parseMode ? { parse_mode: last.parseMode } : {}),
  });
  return true;
}
