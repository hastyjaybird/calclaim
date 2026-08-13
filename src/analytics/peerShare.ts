import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Campaign } from "./campaigns.js";
import { recordEvent } from "./db.js";

/** Legacy Help → Share campaigns (pre per-person tokens). */
export const SHARE_LINK_CAMPAIGN = "link_share";
export const SHARE_QR_CAMPAIGN = "qr_peer_share";

const TOKEN_RE = /^s[lq]_([A-Za-z0-9]{8,16})$/;

let peerShareDb: Database.Database | null = null;

export function initPeerShare(db: Database.Database): void {
  peerShareDb = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_share_tokens (
      telegram_user_id INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
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

/** Drop the user↔token mapping on erase. Historical /go/sl_… events stay anonymous. */
export function erasePeerShareToken(telegramUserId: number): void {
  if (!peerShareDb) return;
  peerShareDb
    .prepare(`DELETE FROM peer_share_tokens WHERE telegram_user_id = ?`)
    .run(telegramUserId);
}

export function trackShareOut(input: {
  telegramUserId: number;
  campaignId: string;
  source: "qr" | "link";
}): void {
  recordEvent({
    eventType: "share_out",
    source: input.source,
    campaignId: input.campaignId,
    telegramUserId: input.telegramUserId,
  });
}
