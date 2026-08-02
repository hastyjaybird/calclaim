import { readFileSync } from "node:fs";
import path from "node:path";
import { CORPUS_DIR } from "../config.js";

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

export function listPartners(): Partner[] {
  return loadPartnersFile().partners;
}

export function getPartnerBySlug(slug: string): Partner | undefined {
  const cleaned = slug.trim().toLowerCase();
  return listPartners().find((p) => p.slug === cleaned);
}

export function getPartnerByCampaignId(campaignId: string): Partner | undefined {
  return listPartners().find((p) => p.campaignId === campaignId);
}

export function partnerCampaignIds(): Set<string> {
  return new Set(listPartners().map((p) => p.campaignId));
}
