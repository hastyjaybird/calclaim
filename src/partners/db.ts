import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export interface SignedUpPartner {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
  createdAt: string;
}

let db: Database.Database | null = null;

/** Reserved path segments under /partners/ that are not partner slugs. */
export const RESERVED_PARTNER_SLUGS = new Set(["signup"]);

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
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_partner_signups_email
      ON partner_signups(email);
  `);
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

function rowToPartner(row: {
  id: string;
  slug: string;
  name: string;
  email: string;
  city: string;
  campaign_id: string;
  logo: string;
  blurb: string;
  created_at: string;
}): SignedUpPartner {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    city: row.city,
    campaignId: row.campaign_id,
    logo: row.logo,
    blurb: row.blurb,
    createdAt: row.created_at,
  };
}

export function listSignedUpPartners(): SignedUpPartner[] {
  if (!db) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, slug, name, email, city, campaign_id, logo, blurb, created_at
       FROM partner_signups
       ORDER BY created_at ASC`,
    )
    .all() as Array<{
    id: string;
    slug: string;
    name: string;
    email: string;
    city: string;
    campaign_id: string;
    logo: string;
    blurb: string;
    created_at: string;
  }>;
  return rows.map(rowToPartner);
}

export function getSignedUpPartnerBySlug(slug: string): SignedUpPartner | undefined {
  if (!db) return undefined;
  const cleaned = slug.trim().toLowerCase();
  const row = getDb()
    .prepare(
      `SELECT id, slug, name, email, city, campaign_id, logo, blurb, created_at
       FROM partner_signups WHERE slug = ?`,
    )
    .get(cleaned) as
    | {
        id: string;
        slug: string;
        name: string;
        email: string;
        city: string;
        campaign_id: string;
        logo: string;
        blurb: string;
        created_at: string;
      }
    | undefined;
  return row ? rowToPartner(row) : undefined;
}

export function getSignedUpPartnerByCampaignId(
  campaignId: string,
): SignedUpPartner | undefined {
  if (!db) return undefined;
  const row = getDb()
    .prepare(
      `SELECT id, slug, name, email, city, campaign_id, logo, blurb, created_at
       FROM partner_signups WHERE campaign_id = ?`,
    )
    .get(campaignId) as
    | {
        id: string;
        slug: string;
        name: string;
        email: string;
        city: string;
        campaign_id: string;
        logo: string;
        blurb: string;
        created_at: string;
      }
    | undefined;
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
}): SignedUpPartner {
  const createdAt = new Date().toISOString();
  const logo = input.logo ?? "";
  const blurb = input.blurb ?? "Community outreach partner";
  getDb()
    .prepare(
      `INSERT INTO partner_signups
        (id, slug, name, email, city, campaign_id, logo, blurb, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      createdAt,
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
    createdAt,
  };
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
