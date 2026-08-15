import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { PartnerAccountType } from "./emailDomains.js";

export interface SignedUpPartner {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
  /** Optional public website URL (shown on the community partner leaderboard). */
  website: string;
  createdAt: string;
  accountType: PartnerAccountType;
  emailDomain: string;
  /** ISO timestamp when the signup email was verified; null until confirmed. */
  emailVerifiedAt: string | null;
  /** ISO timestamp when the partner canceled; null while active. */
  canceledAt: string | null;
  /**
   * When false, the partner stays off the public community leaderboard
   * (status page + QR attribution still work). Default true for public signups.
   */
  showOnLeaderboard: boolean;
}

let db: Database.Database | null = null;

/** Reserved path segments under /partners/ that are not partner slugs. */
export const RESERVED_PARTNER_SLUGS = new Set(["signup", "verify", "cancel"]);

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function initPartnerSignup(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_signups (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL UNIQUE,
      logo TEXT NOT NULL DEFAULT '',
      blurb TEXT NOT NULL DEFAULT 'Community outreach partner',
      website TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_partner_signups_email
      ON partner_signups(email);
  `);

  ensureColumn(db, "partner_signups", "account_type", "TEXT NOT NULL DEFAULT 'organization'");
  ensureColumn(db, "partner_signups", "email_domain", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "partner_signups", "email_verified_at", "TEXT");
  ensureColumn(db, "partner_signups", "canceled_at", "TEXT");
  ensureColumn(db, "partner_signups", "website", "TEXT NOT NULL DEFAULT ''");
  // Existing public signups stay listed; manual creates opt in via the checkbox.
  ensureColumn(db, "partner_signups", "show_on_leaderboard", "INTEGER NOT NULL DEFAULT 1");

  // Backfill domain from email; grandfather existing rows as verified so they stay listed.
  const rows = db
    .prepare(
      `SELECT id, email, email_domain, email_verified_at, created_at
       FROM partner_signups`,
    )
    .all() as Array<{
    id: string;
    email: string;
    email_domain: string;
    email_verified_at: string | null;
    created_at: string;
  }>;
  const patch = db.prepare(
    `UPDATE partner_signups
     SET email_domain = ?, email_verified_at = COALESCE(email_verified_at, ?)
     WHERE id = ?`,
  );
  for (const row of rows) {
    const at = row.email.lastIndexOf("@");
    const domain =
      row.email_domain ||
      (at >= 0 ? row.email.slice(at + 1).trim().toLowerCase() : "");
    const verifiedAt = row.email_verified_at || row.created_at;
    if (domain !== row.email_domain || !row.email_verified_at) {
      patch.run(domain, verifiedAt, row.id);
    }
  }

  // Repair ids that used hyphens (invalid for some Telegram clients / older sanitizer).
  // Canonical form is p_<hex> / qr_p_<hex>.
  const broken = db
    .prepare(
      `SELECT id, campaign_id FROM partner_signups
       WHERE id LIKE 'p-%' OR campaign_id LIKE 'qr-p-%'`,
    )
    .all() as Array<{ id: string; campaign_id: string }>;
  const update = db.prepare(
    `UPDATE partner_signups SET id = ?, campaign_id = ? WHERE id = ?`,
  );
  for (const row of broken) {
    const nextId = row.id.startsWith("p-") ? `p_${row.id.slice(2)}` : row.id;
    const nextCampaign = row.campaign_id.startsWith("qr-p-")
      ? `qr_p_${row.campaign_id.slice(5)}`
      : row.campaign_id;
    if (nextId === row.id && nextCampaign === row.campaign_id) continue;
    try {
      update.run(nextId, nextCampaign, row.id);
    } catch {
      // Skip collisions rather than failing startup.
    }
  }
}

function getDb(): Database.Database {
  if (!db) throw new Error("Partner signup DB not initialized");
  return db;
}

type PartnerRow = {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string;
  campaign_id: string;
  logo: string;
  blurb: string;
  website: string;
  created_at: string;
  account_type: string;
  email_domain: string;
  email_verified_at: string | null;
  canceled_at: string | null;
  show_on_leaderboard: number | null;
};

const PARTNER_SELECT = `SELECT id, slug, name, email, city, campaign_id, logo, blurb,
  website, created_at, account_type, email_domain, email_verified_at, canceled_at,
  show_on_leaderboard
  FROM partner_signups`;

function rowToPartner(row: PartnerRow): SignedUpPartner {
  const accountType: PartnerAccountType =
    row.account_type === "individual" ? "individual" : "organization";
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    city: row.city,
    campaignId: row.campaign_id,
    logo: row.logo,
    blurb: row.blurb,
    website: row.website || "",
    createdAt: row.created_at,
    accountType,
    emailDomain: row.email_domain || "",
    emailVerifiedAt: row.email_verified_at || null,
    canceledAt: row.canceled_at || null,
    showOnLeaderboard: row.show_on_leaderboard !== 0,
  };
}

export function listSignedUpPartners(): SignedUpPartner[] {
  if (!db) return [];
  const rows = getDb().prepare(`${PARTNER_SELECT} ORDER BY created_at ASC`).all() as PartnerRow[];
  return rows.map(rowToPartner);
}

export function getSignedUpPartnerBySlug(slug: string): SignedUpPartner | undefined {
  if (!db) return undefined;
  const cleaned = slug.trim().toLowerCase();
  const row = getDb()
    .prepare(`${PARTNER_SELECT} WHERE slug = ?`)
    .get(cleaned) as PartnerRow | undefined;
  return row ? rowToPartner(row) : undefined;
}

export function getSignedUpPartnerById(id: string): SignedUpPartner | undefined {
  if (!db) return undefined;
  const cleaned = id.trim().toLowerCase();
  const row = getDb()
    .prepare(`${PARTNER_SELECT} WHERE lower(id) = ?`)
    .get(cleaned) as PartnerRow | undefined;
  return row ? rowToPartner(row) : undefined;
}

export function getSignedUpPartnerByCampaignId(
  campaignId: string,
): SignedUpPartner | undefined {
  if (!db) return undefined;
  const row = getDb()
    .prepare(`${PARTNER_SELECT} WHERE campaign_id = ?`)
    .get(campaignId) as PartnerRow | undefined;
  return row ? rowToPartner(row) : undefined;
}

export function slugExists(slug: string): boolean {
  if (RESERVED_PARTNER_SLUGS.has(slug)) return true;
  if (!db) return false;
  const row = getDb()
    .prepare("SELECT 1 AS ok FROM partner_signups WHERE slug = ?")
    .get(slug) as { ok: number } | undefined;
  return Boolean(row);
}

export function insertSignedUpPartner(input: {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string;
  campaignId: string;
  logo?: string;
  blurb?: string;
  website?: string;
  accountType: PartnerAccountType;
  emailDomain: string;
  emailVerifiedAt?: string | null;
  showOnLeaderboard?: boolean;
}): SignedUpPartner {
  const createdAt = new Date().toISOString();
  const logo = input.logo ?? "";
  const blurb = input.blurb ?? "Community outreach partner";
  const website = input.website ?? "";
  const emailVerifiedAt = input.emailVerifiedAt ?? null;
  const showOnLeaderboard = input.showOnLeaderboard !== false;
  getDb()
    .prepare(
      `INSERT INTO partner_signups
        (id, slug, name, email, city, campaign_id, logo, blurb, website, created_at,
         account_type, email_domain, email_verified_at, show_on_leaderboard)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.slug,
      input.name,
      input.email,
      input.city,
      input.campaignId,
      logo,
      blurb,
      website,
      createdAt,
      input.accountType,
      input.emailDomain,
      emailVerifiedAt,
      showOnLeaderboard ? 1 : 0,
    );
  return {
    id: input.id,
    slug: input.slug,
    name: input.name,
    email: input.email,
    city: input.city,
    campaignId: input.campaignId,
    logo,
    blurb,
    website,
    createdAt,
    accountType: input.accountType,
    emailDomain: input.emailDomain,
    emailVerifiedAt,
    canceledAt: null,
    showOnLeaderboard,
  };
}

export function updateSignedUpPartner(
  slug: string,
  patch: {
    name: string;
    email: string;
    city: string;
    logo?: string;
    website?: string;
    emailDomain?: string;
    emailVerifiedAt?: string | null;
    showOnLeaderboard?: boolean;
  },
): SignedUpPartner | undefined {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return undefined;
  const logo = patch.logo !== undefined ? patch.logo : existing.logo;
  const website = patch.website !== undefined ? patch.website : existing.website;
  const emailDomain =
    patch.emailDomain !== undefined ? patch.emailDomain : existing.emailDomain;
  const emailVerifiedAt =
    patch.emailVerifiedAt !== undefined
      ? patch.emailVerifiedAt
      : existing.emailVerifiedAt;
  const showOnLeaderboard =
    patch.showOnLeaderboard !== undefined
      ? patch.showOnLeaderboard
      : existing.showOnLeaderboard;
  getDb()
    .prepare(
      `UPDATE partner_signups
       SET name = ?, email = ?, city = ?, logo = ?, website = ?,
           email_domain = ?, email_verified_at = ?, show_on_leaderboard = ?
       WHERE slug = ?`,
    )
    .run(
      patch.name,
      patch.email,
      patch.city,
      logo,
      website,
      emailDomain,
      emailVerifiedAt,
      showOnLeaderboard ? 1 : 0,
      existing.slug,
    );
  return {
    ...existing,
    name: patch.name,
    email: patch.email,
    city: patch.city,
    logo,
    website,
    emailDomain,
    emailVerifiedAt,
    showOnLeaderboard,
  };
}

export function deleteSignedUpPartner(slug: string): SignedUpPartner | undefined {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return undefined;
  getDb().prepare("DELETE FROM partner_signups WHERE slug = ?").run(existing.slug);
  return existing;
}

/** Soft-cancel: keep the row for operators, remove from public leaderboard/pages. */
export function cancelSignedUpPartner(
  slug: string,
  canceledAt = new Date().toISOString(),
): SignedUpPartner | undefined {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return undefined;
  if (existing.canceledAt) return existing;
  getDb()
    .prepare(`UPDATE partner_signups SET canceled_at = ? WHERE slug = ?`)
    .run(canceledAt, existing.slug);
  return { ...existing, canceledAt };
}

export function markPartnerEmailVerified(
  partnerId: string,
  verifiedAt = new Date().toISOString(),
): SignedUpPartner | undefined {
  const existing = getSignedUpPartnerById(partnerId);
  if (!existing) return undefined;
  if (existing.emailVerifiedAt) return existing;
  getDb()
    .prepare(`UPDATE partner_signups SET email_verified_at = ? WHERE id = ?`)
    .run(verifiedAt, existing.id);
  return { ...existing, emailVerifiedAt: verifiedAt };
}

/** Short hex token for partner / campaign ids (combined with a `p_` / `qr_p_` prefix). */
export function randomPartnerToken(bytes = 4): string {
  return randomBytes(bytes).toString("hex");
}

export function slugifyPartnerName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "partner";
}

export function allocateUniqueSlug(name: string): string {
  const base = slugifyPartnerName(name);
  let candidate = base;
  let n = 0;
  while (slugExists(candidate) || RESERVED_PARTNER_SLUGS.has(candidate)) {
    n += 1;
    const suffix = randomPartnerToken(2);
    candidate = `${base.slice(0, 32)}-${suffix}`.slice(0, 48);
    if (n > 20) {
      candidate = `partner-${randomPartnerToken(4)}`;
      break;
    }
  }
  return candidate;
}
