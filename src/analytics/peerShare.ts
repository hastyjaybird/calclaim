import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Campaign } from "./campaigns.js";
import { recordEvent } from "./db.js";

/** Legacy Help → Share campaigns (pre per-person tokens). */
export const SHARE_LINK_CAMPAIGN = "link_share";
export const SHARE_QR_CAMPAIGN = "qr_peer_share";

const TOKEN_RE = /^s[lq]_([A-Za-z0-9]{8,16})$/;

export type ShareOutPrompt = "opt_in" | "help" | "idle" | "unknown";

export interface ReferralEdgeRow {
  id: number;
  referrer_user_id: number | null;
  recipient_user_id: number;
  campaign_id: string;
  share_kind: "link" | "qr";
  referrer_token: string | null;
  created_at: string;
}

let peerShareDb: Database.Database | null = null;

export function initPeerShare(db: Database.Database): void {
  peerShareDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_share_tokens (
      telegram_user_id INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS referral_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER,
      recipient_user_id INTEGER NOT NULL UNIQUE,
      campaign_id TEXT NOT NULL,
      share_kind TEXT NOT NULL,
      referrer_token TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_referral_edges_referrer
      ON referral_edges(referrer_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_edges_created
      ON referral_edges(created_at);
  `);
}

function getDb(): Database.Database {
  if (!peerShareDb) throw new Error("Peer-share DB not initialized");
  return peerShareDb;
}

export function isPeerShareCampaignId(id: string | null | undefined): boolean {
  if (!id) return false;
  return (
    id === SHARE_LINK_CAMPAIGN ||
    id === SHARE_QR_CAMPAIGN ||
    TOKEN_RE.test(id)
  );
}

export function peerShareCampaignKind(
  id: string,
): "qr" | "link" | null {
  if (id === SHARE_QR_CAMPAIGN || id.startsWith("sq_")) return "qr";
  if (id === SHARE_LINK_CAMPAIGN || id.startsWith("sl_")) return "link";
  return null;
}

/** Parse the opaque token from `sl_*` / `sq_*` (null for legacy shared campaigns). */
export function peerShareTokenFromCampaignId(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const m = TOKEN_RE.exec(id);
  return m?.[1] ?? null;
}

/** Resolve a friend-share start payload to a campaign pin (no lat/lng). */
export function lookupPeerShareCampaign(id: string): Campaign | undefined {
  const kind = peerShareCampaignKind(id);
  if (!kind) return undefined;
  return {
    id,
    name: "Friend share",
    kind,
    lat: null,
    lng: null,
    label: "Friend share",
    zip: null,
  };
}

export interface PeerShareCampaigns {
  token: string;
  linkCampaignId: string;
  qrCampaignId: string;
}

function campaignsForToken(token: string): PeerShareCampaigns {
  return {
    token,
    linkCampaignId: `sl_${token}`,
    qrCampaignId: `sq_${token}`,
  };
}

export function getOrCreatePeerShareCampaigns(
  telegramUserId: number,
): PeerShareCampaigns {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT token FROM peer_share_tokens WHERE telegram_user_id = ?`,
    )
    .get(telegramUserId) as { token: string } | undefined;
  if (existing?.token) return campaignsForToken(existing.token);

  const token = randomBytes(5).toString("hex").slice(0, 10);
  const createdAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO peer_share_tokens (telegram_user_id, token, created_at)
       VALUES (?, ?, ?)`,
    ).run(telegramUserId, token, createdAt);
    return campaignsForToken(token);
  } catch {
    const raced = db
      .prepare(
        `SELECT token FROM peer_share_tokens WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as { token: string } | undefined;
    if (raced?.token) return campaignsForToken(raced.token);
    throw new Error("Could not allocate a friend-share token");
  }
}

/** Look up who owns a friend-share campaign (null for legacy / unknown tokens). */
export function lookupReferrerUserId(
  campaignId: string | null | undefined,
): number | null {
  if (!peerShareDb) return null;
  const token = peerShareTokenFromCampaignId(campaignId);
  if (!token) return null;
  const row = peerShareDb
    .prepare(
      `SELECT telegram_user_id FROM peer_share_tokens WHERE token = ?`,
    )
    .get(token) as { telegram_user_id: number } | undefined;
  return row?.telegram_user_id ?? null;
}

/**
 * Meta for peer-share awareness / bot_start events so clicks and starts
 * carry attribution without waiting for a join at query time.
 */
export function peerShareAttributionMeta(
  campaignId: string,
): Record<string, unknown> | null {
  if (!isPeerShareCampaignId(campaignId)) return null;
  const kind = peerShareCampaignKind(campaignId);
  const token = peerShareTokenFromCampaignId(campaignId);
  return {
    share_kind: kind,
    referrer_token: token,
    referrer_user_id: lookupReferrerUserId(campaignId),
  };
}

/**
 * First-touch peer referral: recipient started the bot via someone's share link/QR.
 * Skips self-starts and recipients who already have an edge (multi-/start keeps first).
 * Also writes a `share_in` analytics event for the event log.
 */
export function recordReferralFromBotStart(input: {
  recipientUserId: number;
  campaignId: string | null;
}): void {
  if (!peerShareDb || !input.campaignId) return;
  if (!isPeerShareCampaignId(input.campaignId)) return;

  const kind = peerShareCampaignKind(input.campaignId);
  if (!kind) return;

  const token = peerShareTokenFromCampaignId(input.campaignId);
  const referrerUserId = lookupReferrerUserId(input.campaignId);
  if (referrerUserId != null && referrerUserId === input.recipientUserId) {
    return;
  }

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM referral_edges WHERE recipient_user_id = ?`,
    )
    .get(input.recipientUserId) as { id: number } | undefined;
  if (existing) return;

  const createdAt = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO referral_edges
        (referrer_user_id, recipient_user_id, campaign_id, share_kind, referrer_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      referrerUserId,
      input.recipientUserId,
      input.campaignId,
      kind,
      token,
      createdAt,
    );
  } catch {
    // UNIQUE(recipient_user_id) race – first writer wins.
    return;
  }

  recordEvent({
    eventType: "share_in",
    source: kind,
    campaignId: input.campaignId,
    telegramUserId: input.recipientUserId,
    meta: {
      referrer_user_id: referrerUserId,
      referrer_token: token,
      share_kind: kind,
    },
  });
}

/** All first-touch edges (for a future viral tree). Operator use only. */
export function listReferralEdges(): ReferralEdgeRow[] {
  if (!peerShareDb) return [];
  return peerShareDb
    .prepare(
      `SELECT id, referrer_user_id, recipient_user_id, campaign_id,
              share_kind, referrer_token, created_at
       FROM referral_edges
       ORDER BY created_at ASC`,
    )
    .all() as ReferralEdgeRow[];
}

/** Drop the user↔token mapping on erase. Historical /go/sl_… events stay anonymous. */
export function erasePeerShareToken(telegramUserId: number): void {
  if (!peerShareDb) return;
  peerShareDb
    .prepare(`DELETE FROM peer_share_tokens WHERE telegram_user_id = ?`)
    .run(telegramUserId);
}

/** Remove referral graph rows that name this user (as sharer or recipient). */
export function eraseReferralEdgesForUser(telegramUserId: number): void {
  if (!peerShareDb) return;
  peerShareDb
    .prepare(
      `DELETE FROM referral_edges
       WHERE referrer_user_id = ? OR recipient_user_id = ?`,
    )
    .run(telegramUserId, telegramUserId);
}

export function trackShareOut(input: {
  telegramUserId: number;
  campaignId: string;
  source: "qr" | "link";
  prompt?: ShareOutPrompt;
}): void {
  const token = peerShareTokenFromCampaignId(input.campaignId);
  recordEvent({
    eventType: "share_out",
    source: input.source,
    campaignId: input.campaignId,
    telegramUserId: input.telegramUserId,
    meta: {
      prompt: input.prompt ?? "unknown",
      share_kind: input.source,
      referrer_token: token,
    },
  });
}
