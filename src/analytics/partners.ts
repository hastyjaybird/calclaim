import { readFileSync } from "node:fs";
import path from "node:path";
import { CORPUS_DIR } from "../config.js";
import {
  getSignedUpPartnerByCampaignId,
  getSignedUpPartnerBySlug,
  listSignedUpPartners,
} from "../partners/db.js";

export interface Partner {
  id: string;
  slug: string;
  name: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
}

interface PartnersFile {
  version: string;
  disclaimer: string;
  partners: Partner[];
}

let cache: PartnersFile | null = null;

export function loadPartnersFile(): PartnersFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "partners.json"), "utf8"),
    ) as PartnersFile;
  }
  return cache;
}

function corpusPartners(): Partner[] {
  return loadPartnersFile().partners;
}

function asPartner(p: {
  id: string;
  slug: string;
  name: string;
  city: string;
  campaignId: string;
  logo: string;
  blurb: string;
}): Partner {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    city: p.city,
    campaignId: p.campaignId,
    logo: p.logo,
    blurb: p.blurb,
  };
}

/** Corpus demo partners plus live signups from SQLite. */
export function listPartners(): Partner[] {
  const fromCorpus = corpusPartners();
  const corpusSlugs = new Set(fromCorpus.map((p) => p.slug));
  const fromSignup = listSignedUpPartners()
    .filter((p) => !corpusSlugs.has(p.slug))
    .map(asPartner);
  return [...fromCorpus, ...fromSignup];
}

export function getPartnerBySlug(slug: string): Partner | undefined {
  const cleaned = slug.trim().toLowerCase();
  const fromCorpus = corpusPartners().find((p) => p.slug === cleaned);
  if (fromCorpus) return fromCorpus;
  const signed = getSignedUpPartnerBySlug(cleaned);
  return signed ? asPartner(signed) : undefined;
}

export function getPartnerByCampaignId(campaignId: string): Partner | undefined {
  const fromCorpus = corpusPartners().find((p) => p.campaignId === campaignId);
  if (fromCorpus) return fromCorpus;
  const signed =
    getSignedUpPartnerByCampaignId(campaignId) ??
    (campaignId.includes("-")
      ? getSignedUpPartnerByCampaignId(campaignId.replaceAll("-", "_"))
      : undefined);
  return signed ? asPartner(signed) : undefined;
}

export function partnerCampaignIds(): Set<string> {
  return new Set(listPartners().map((p) => p.campaignId));
}
