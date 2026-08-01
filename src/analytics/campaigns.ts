import { readFileSync } from "node:fs";
import path from "node:path";
import { CORPUS_DIR } from "../config.js";
import type { AnalyticsSource } from "./db.js";

export interface Campaign {
  id: string;
  name: string;
  kind: "qr" | "link";
  lat: number | null;
  lng: number | null;
  label: string | null;
  zip: string | null;
}

interface CampaignsFile {
  version: string;
  disclaimer: string;
  campaigns: Campaign[];
}

let cache: CampaignsFile | null = null;

export function loadCampaignsFile(): CampaignsFile {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "campaigns.json"), "utf8"),
    ) as CampaignsFile;
  }
  return cache;
}

export function getCampaign(id: string): Campaign | undefined {
  return loadCampaignsFile().campaigns.find((c) => c.id === id);
}

export function campaignSource(campaign: Campaign | undefined): AnalyticsSource {
  if (!campaign) return "unknown";
  return campaign.kind === "qr" ? "qr" : "link";
}

/** Telegram /start payloads allow A-Z, a-z, 0-9, _ — max 64 */
export function sanitizeStartPayload(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().slice(0, 64);
  if (!/^[A-Za-z0-9_]+$/.test(cleaned)) return null;
  return cleaned;
}
