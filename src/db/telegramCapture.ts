import type Database from "better-sqlite3";
import type { Context } from "grammy";
import { isAwaitingImmigrationPrompt } from "../queue/immigrationMemory.js";

let captureDb: Database.Database | null = null;

export function initTelegramCapture(db: Database.Database): void {
  captureDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      telegram_user_id INTEGER PRIMARY KEY,
      is_bot INTEGER NOT NULL DEFAULT 0,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      language_code TEXT,
      is_premium INTEGER,
      phone_number TEXT,
      vcard TEXT,
      chat_id INTEGER,
      chat_type TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_user_json TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      chat_id INTEGER,
      message_id INTEGER,
      update_kind TEXT NOT NULL,
      content_type TEXT,
      text TEXT,
      callback_data TEXT,
      phone_number TEXT,
      contact_user_id INTEGER,
      contact_first_name TEXT,
      contact_last_name TEXT,
      latitude REAL,
      longitude REAL,
      horizontal_accuracy REAL,
      file_id TEXT,
      file_unique_id TEXT,
      mime_type TEXT,
      file_name TEXT,
      caption TEXT,
      date_unix INTEGER,
      created_at TEXT NOT NULL,
      raw_json TEXT,
      FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(telegram_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tg_messages_user
      ON telegram_messages(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_tg_messages_created
      ON telegram_messages(created_at);
  `);
}

function getDb(): Database.Database {
  if (!captureDb) throw new Error("Telegram capture DB not initialized");
  return captureDb;
}

function boolInt(v: boolean | undefined): number | null {
  if (v === undefined) return null;
  return v ? 1 : 0;
}

/** Upsert profile fields Telegram exposes on the User object (+ optional contact). */
export function upsertTelegramUser(ctx: Context): void {
  const from = ctx.from;
  if (!from) return;

  const now = new Date().toISOString();
  const chat = ctx.chat;
  const contact = ctx.message?.contact;
  // Only store phone if they shared a contact (usually their own)
  const phone =
    contact && (!contact.user_id || contact.user_id === from.id)
      ? contact.phone_number
      : null;
  const vcard = contact?.vcard ?? null;

  getDb()
    .prepare(
      `INSERT INTO telegram_users (
         telegram_user_id, is_bot, first_name, last_name, username,
         language_code, is_premium, phone_number, vcard,
         chat_id, chat_type, first_seen_at, last_seen_at, updated_at, raw_user_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         is_bot = excluded.is_bot,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         username = excluded.username,
         language_code = excluded.language_code,
         is_premium = excluded.is_premium,
         phone_number = COALESCE(excluded.phone_number, telegram_users.phone_number),
         vcard = COALESCE(excluded.vcard, telegram_users.vcard),
         chat_id = COALESCE(excluded.chat_id, telegram_users.chat_id),
         chat_type = COALESCE(excluded.chat_type, telegram_users.chat_type),
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at,
         raw_user_json = excluded.raw_user_json`,
    )
    .run(
      from.id,
      from.is_bot ? 1 : 0,
      from.first_name ?? null,
      from.last_name ?? null,
      from.username ?? null,
      from.language_code ?? null,
      boolInt(from.is_premium),
      phone,
      vcard,
      chat?.id ?? null,
      chat?.type ?? null,
      now,
      now,
      now,
      JSON.stringify(from),
    );
}

function contentTypeFromMessage(msg: NonNullable<Context["message"]>): string {
  if (msg.text) return "text";
  if (msg.contact) return "contact";
  if (msg.location) return "location";
  if (msg.venue) return "venue";
  if (msg.photo?.length) return "photo";
  if (msg.document) return "document";
  if (msg.audio) return "audio";
  if (msg.voice) return "voice";
  if (msg.video) return "video";
  if (msg.video_note) return "video_note";
  if (msg.sticker) return "sticker";
  if (msg.animation) return "animation";
  return "other";
}

/** Log one inbound update (message or callback). */
export function logTelegramUpdate(ctx: Context): void {
  const from = ctx.from;
  if (!from) return;

  // Immigration-status answers are never persisted (privacy promise on that prompt).
  const cbData = ctx.callbackQuery?.data;
  if (cbData?.startsWith("status:")) return;
  if (
    isAwaitingImmigrationPrompt(from.id) &&
    (ctx.message?.text || ctx.message?.voice || ctx.editedMessage?.text)
  ) {
    return;
  }

  const now = new Date().toISOString();
  const msg = ctx.message ?? ctx.editedMessage;
  const cb = ctx.callbackQuery;

  let updateKind = "other";
  let contentType: string | null = null;
  let messageId: number | null = null;
  let text: string | null = null;
  let callbackData: string | null = null;
  let phoneNumber: string | null = null;
  let contactUserId: number | null = null;
  let contactFirstName: string | null = null;
  let contactLastName: string | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let horizontalAccuracy: number | null = null;
  let fileId: string | null = null;
  let fileUniqueId: string | null = null;
  let mimeType: string | null = null;
  let fileName: string | null = null;
  let caption: string | null = null;
  let dateUnix: number | null = null;
  let raw: unknown = null;

  if (cb) {
    updateKind = "callback_query";
    contentType = "callback";
    callbackData = cb.data ?? null;
    messageId = cb.message && "message_id" in cb.message ? cb.message.message_id : null;
    dateUnix = Math.floor(Date.now() / 1000);
    raw = cb;
  } else if (msg) {
    updateKind = ctx.editedMessage ? "edited_message" : "message";
    contentType = contentTypeFromMessage(msg);
    messageId = msg.message_id;
    text = msg.text ?? msg.caption ?? null;
    caption = msg.caption ?? null;
    dateUnix = msg.date ?? null;
    raw = msg;

    if (msg.contact) {
      phoneNumber = msg.contact.phone_number;
      contactUserId = msg.contact.user_id ?? null;
      contactFirstName = msg.contact.first_name ?? null;
      contactLastName = msg.contact.last_name ?? null;
    }
    if (msg.location) {
      latitude = msg.location.latitude;
      longitude = msg.location.longitude;
      horizontalAccuracy = msg.location.horizontal_accuracy ?? null;
    }
    if (msg.venue?.location) {
      latitude = msg.venue.location.latitude;
      longitude = msg.venue.location.longitude;
    }
    const file =
      msg.document ??
      msg.audio ??
      msg.voice ??
      msg.video ??
      msg.video_note ??
      msg.animation ??
      msg.sticker ??
      (msg.photo?.length ? msg.photo[msg.photo.length - 1] : undefined);
    if (file) {
      fileId = "file_id" in file ? file.file_id : null;
      fileUniqueId = "file_unique_id" in file ? file.file_unique_id : null;
      mimeType = "mime_type" in file ? (file.mime_type as string | undefined) ?? null : null;
      fileName = "file_name" in file ? (file.file_name as string | undefined) ?? null : null;
    }
  } else {
    return;
  }

  getDb()
    .prepare(
      `INSERT INTO telegram_messages (
         telegram_user_id, chat_id, message_id, update_kind, content_type,
         text, callback_data, phone_number, contact_user_id,
         contact_first_name, contact_last_name,
         latitude, longitude, horizontal_accuracy,
         file_id, file_unique_id, mime_type, file_name, caption,
         date_unix, created_at, raw_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      from.id,
      ctx.chat?.id ?? null,
      messageId,
      updateKind,
      contentType,
      text,
      callbackData,
      phoneNumber,
      contactUserId,
      contactFirstName,
      contactLastName,
      latitude,
      longitude,
      horizontalAccuracy,
      fileId,
      fileUniqueId,
      mimeType,
      fileName,
      caption,
      dateUnix,
      now,
      JSON.stringify(raw),
    );
}

/** Capture profile + inbound update. Safe no-op if DB not ready. */
export function captureTelegramUpdate(ctx: Context): void {
  if (!captureDb || !ctx.from) return;
  try {
    upsertTelegramUser(ctx);
    logTelegramUpdate(ctx);
  } catch (err) {
    console.error("telegramCapture failed:", err);
  }
}

export function eraseTelegramUserData(telegramUserId: number): void {
  if (!captureDb) return;
  const db = getDb();
  db.prepare("DELETE FROM telegram_messages WHERE telegram_user_id = ?").run(
    telegramUserId,
  );
  db.prepare("DELETE FROM telegram_users WHERE telegram_user_id = ?").run(
    telegramUserId,
  );
}
