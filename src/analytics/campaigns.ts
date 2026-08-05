import { readFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import { getSignedUpPartnerByCampaignId } from "../partners/db.js";
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
      readFileSync(path.join(LIBRARY_DIR, "campaigns.json"), "utf8"),
    ) as CampaignsFile;
  }
  return cache;
}

function lookupSignedCampaign(id: string): Campaign | undefined {
  const signed =
    getSignedUpPartnerByCampaignId(id) ??
    // Older signup QRs used hyphens (qr-p-…); DB now stores underscores (qr_p_…).
    (id.includes("-")
      ? getSignedUpPartnerByCampaignId(id.replaceAll("-", "_"))
      : undefined);
  if (!signed) return undefined;
  return {
    id: signed.campaignId,
    name: signed.name,
    kind: "qr",
    lat: null,
    lng: null,
    label: signed.city || signed.name,
    zip: null,
  };
}

export function getCampaign(id: string): Campaign | undefined {
  const fromFile = loadCampaignsFile().campaigns.find((c) => c.id === id);
  if (fromFile) return fromFile;
  return lookupSignedCampaign(id);
}

export function campaignSource(campaign: Campaign | undefined): AnalyticsSource {
  if (!campaign) return "unknown";
  return campaign.kind === "qr" ? "qr" : "link";
}

/** Telegram /start payloads allow A-Z, a-z, 0-9, _, - — max 64 */
export function sanitizeStartPayload(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().slice(0, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) return null;
  return cleaned;
}
