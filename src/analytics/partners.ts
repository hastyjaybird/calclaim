import { readFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import {
  getSignedUpPartnerByCampaignId,
  getSignedUpPartnerById,
  getSignedUpPartnerBySlug,
  listSignedUpPartners,
  type SignedUpPartner,
} from "../partners/db.js";
import { getPartnerEventByCampaignId } from "../partners/events.js";
import type { PartnerAccountType } from "../partners/emailDomains.js";

export interface Partner {
  id: string;
  slug: string;
  name: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
  accountType: PartnerAccountType;
  emailDomain: string;
  /** True when the partner's signup email has been verified (library demos are always verified). */
  emailVerified: boolean;
  /** ISO timestamp when canceled; null/undefined while active. Library demos are never canceled. */
  canceledAt?: string | null;
}

interface LibraryPartnerJson {
  id: string;
  slug: string;
  name: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
  accountType?: PartnerAccountType;
  emailDomain?: string;
  emailVerified?: boolean;
}

interface PartnersFile {
  version: string;
  disclaimer: string;
  partners: LibraryPartnerJson[];
}

let cache: PartnersFile | null = null;

export function loadPartnersFile(): PartnersFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(path.join(LIBRARY_DIR, "partners.json"), "utf8"),
    ) as PartnersFile;
  }
  return cache;
}

function libraryPartners(): Partner[] {
  return loadPartnersFile().partners.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    city: p.city,
    campaignId: p.campaignId,
    logo: p.logo,
    blurb: p.blurb,
    accountType: p.accountType === "individual" ? "individual" : "organization",
    emailDomain: (p.emailDomain || "").toLowerCase(),
    // Demo library partners are treated as verified accounts for demos.
    emailVerified: p.emailVerified !== false,
  }));
}

function asPartner(p: SignedUpPartner): Partner {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    city: p.city,
    campaignId: p.campaignId,
    logo: p.logo,
    blurb: p.blurb,
    accountType: p.accountType,
    emailDomain: p.emailDomain,
    emailVerified: Boolean(p.emailVerifiedAt),
    canceledAt: p.canceledAt,
  };
}

/** Library demo partners plus verified, active live signups from SQLite. */
export function listPartners(): Partner[] {
  const fromLibrary = libraryPartners();
  const librarySlugs = new Set(fromLibrary.map((p) => p.slug));
  const fromSignup = listSignedUpPartners()
    .filter((p) => p.emailVerifiedAt && !p.canceledAt && !librarySlugs.has(p.slug))
    .map(asPartner);
  return [...fromLibrary, ...fromSignup];
}

/**
 * Public leaderboard partners: verified organizations and individuals who have
 * not canceled. Individuals use a public status page (no private /org dashboard).
 *
 * Pass `{ includeLibrary: false }` for live dashboards so staged library
 * demo partners (Oakland Library, etc.) do not appear with empty real stats.
 */
export function listLeaderboardPartners(opts?: {
  includeLibrary?: boolean;
}): Partner[] {
  const includeLibrary = opts?.includeLibrary !== false;
  const fromLibrary = includeLibrary ? libraryPartners() : [];
  const librarySlugs = new Set(fromLibrary.map((p) => p.slug));
  const fromSignup = listSignedUpPartners()
    .filter((p) => p.emailVerifiedAt && !p.canceledAt && !librarySlugs.has(p.slug))
    .map(asPartner);
  return [...fromLibrary, ...fromSignup].filter((p) => p.emailVerified && !p.canceledAt);
}

export function getPartnerBySlug(slug: string): Partner | undefined {
  const cleaned = slug.trim().toLowerCase();
  const fromLibrary = libraryPartners().find((p) => p.slug === cleaned);
  if (fromLibrary) return fromLibrary;
  const signed = getSignedUpPartnerBySlug(cleaned);
  // Status pages remain reachable before verification; leaderboard uses listPartners().
  // Canceled partners stay in SQLite for operators but are hidden from public pages.
  if (!signed || signed.canceledAt) return undefined;
  return asPartner(signed);
}

export function getPartnerByCampaignId(campaignId: string): Partner | undefined {
  const fromLibrary = libraryPartners().find((p) => p.campaignId === campaignId);
  if (fromLibrary) return fromLibrary;
  const signed =
    getSignedUpPartnerByCampaignId(campaignId) ??
    (campaignId.includes("-")
      ? getSignedUpPartnerByCampaignId(campaignId.replaceAll("-", "_"))
      : undefined);
  if (signed) return asPartner(signed);

  const event = getPartnerEventByCampaignId(campaignId);
  if (!event) return undefined;
  const fromEventLibrary = libraryPartners().find(
    (p) => p.id === event.partnerId || p.slug === event.partnerSlug,
  );
  if (fromEventLibrary) return fromEventLibrary;
  const eventPartner =
    getSignedUpPartnerById(event.partnerId) ??
    getSignedUpPartnerBySlug(event.partnerSlug);
  // Canceled partners still resolve for campaign attribution; public pages use getPartnerBySlug.
  return eventPartner ? asPartner(eventPartner) : undefined;
}

export function partnerCampaignIds(): Set<string> {
  return new Set(listPartners().map((p) => p.campaignId));
}
