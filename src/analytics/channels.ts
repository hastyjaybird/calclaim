import { getPartnerByCampaignId } from "./partners.js";
import { isPeerShareCampaignId } from "./peerShare.js";

export type ReachChannel = "organizations" | "friends" | "website" | "other";

const WEBSITE_CAMPAIGNS = new Set(["link_website", "qr_website"]);

/**
 * How someone found CalClaim.
 * - organizations: verified org partner QR / event QR
 * - friends: Help → Share (per-person link/QR) and individual partner QRs
 * - website: impact-page CTA / try QR
 */
export function reachChannelForCampaign(
  campaignId: string | null | undefined,
): ReachChannel {
  if (!campaignId) return "other";
  if (WEBSITE_CAMPAIGNS.has(campaignId)) return "website";
  if (isPeerShareCampaignId(campaignId)) return "friends";

  const partner = getPartnerByCampaignId(campaignId);
  if (!partner) return "other";
  if (partner.slug === "website") return "website";
  if (partner.accountType === "individual") return "friends";
  return "organizations";
}
