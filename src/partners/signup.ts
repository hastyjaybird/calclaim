import { campaignLandingUrl, type AppConfig } from "../config.js";
import { renderShareQrPng } from "../bot/share.js";
import { getPartnerBySlug } from "../analytics/partners.js";
import { renderPartnerBoothBannerPdf } from "./banner.js";
import {
  allocateUniqueSlug,
  getSignedUpPartnerBySlug,
  insertSignedUpPartner,
  randomPartnerToken,
  updateSignedUpPartner,
  type SignedUpPartner,
} from "./db.js";
import { sendPartnerWelcomeEmail, type SendPartnerEmailResult } from "./email.js";
import { savePartnerLogoUpload } from "./logoUpload.js";

export interface PartnerSignupInput {
  name?: unknown;
  email?: unknown;
  city?: unknown;
  partnerId?: unknown;
}

export interface PartnerSignupResult {
  partner: SignedUpPartner;
  statusUrl: string;
  qrUrl: string;
  bannerUrl: string;
  email: SendPartnerEmailResult;
}

function trimField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  // Practical check — not a full RFC parser
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

export function parsePartnerSignup(input: PartnerSignupInput): {
  name: string;
  email: string;
  city: string;
} | { error: string } {
  const name = trimField(input.name, 120);
  const email = trimField(input.email, 200).toLowerCase();
  const city = trimField(input.city, 80);
  if (!name) return { error: "name_required" };
  if (!email) return { error: "email_required" };
  if (!isValidEmail(email)) return { error: "email_invalid" };
  return { name, email, city };
}

export async function registerPartnerSignup(
  config: AppConfig,
  fields: {
    name: string;
    email: string;
    city: string;
    logo?: { buffer: Buffer; mime: string; filename: string };
  },
): Promise<PartnerSignupResult> {
  const token = randomPartnerToken(4);
  // Underscores only — must match Telegram /start alphabet and corpus campaign style.
  const id = `p_${token}`;
  const slug = allocateUniqueSlug(fields.name);
  // Ensure we didn't collide with a corpus partner slug
  let finalSlug = slug;
  if (getPartnerBySlug(finalSlug)) {
    finalSlug = allocateUniqueSlug(`${fields.name}-${token}`);
  }
  const campaignId = `qr_p_${token}`;

  let logoPath = "";
  if (fields.logo) {
    logoPath = savePartnerLogoUpload(id, fields.logo);
  }

  const partner = insertSignedUpPartner({
    id,
    slug: finalSlug,
    name: fields.name,
    email: fields.email,
    city: fields.city || "California",
    campaignId,
    logo: logoPath,
    blurb: "Community outreach partner",
  });

  const statusUrl = `${config.publicBaseUrl}/partners/${encodeURIComponent(partner.slug)}`;
  const qrUrl = `${config.publicBaseUrl}/api/qr/partner/${encodeURIComponent(partner.slug)}`;
  const bannerUrl = `${config.publicBaseUrl}/api/partners/${encodeURIComponent(partner.slug)}/banner`;
  const qrTarget = campaignLandingUrl(config.publicBaseUrl, partner.campaignId);

  const [qrPng, bannerPdf] = await Promise.all([
    renderShareQrPng(qrTarget),
    renderPartnerBoothBannerPdf({
      partnerName: partner.name,
      partnerId: partner.id,
      qrTargetUrl: qrTarget,
      partnerLogoPath: partner.logo || null,
    }),
  ]);

  const email = await sendPartnerWelcomeEmail({
    partner,
    statusUrl,
    qrUrl,
    bannerUrl,
    qrPng,
    bannerPdf,
  });

  return { partner, statusUrl, qrUrl, bannerUrl, email };
}

export function parsePartnerProfileUpdate(input: PartnerSignupInput): {
  name: string;
  email: string;
  city: string;
  partnerId: string;
} | { error: string } {
  const parsed = parsePartnerSignup(input);
  if ("error" in parsed) return parsed;
  const partnerId = trimField(input.partnerId, 40).toLowerCase();
  if (!partnerId) return { error: "partner_id_required" };
  return { ...parsed, partnerId };
}

export async function updatePartnerProfile(
  slug: string,
  fields: {
    name: string;
    email: string;
    city: string;
    partnerId: string;
    logo?: { buffer: Buffer; mime: string; filename: string };
  },
): Promise<
  | { partner: SignedUpPartner; bannerUrl: string }
  | { error: string }
> {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return { error: "not_found" };
  if (existing.id.toLowerCase() !== fields.partnerId.toLowerCase()) {
    return { error: "partner_id_mismatch" };
  }

  let logoPath: string | undefined;
  if (fields.logo) {
    logoPath = savePartnerLogoUpload(existing.id, fields.logo);
  }

  const partner = updateSignedUpPartner(existing.slug, {
    name: fields.name,
    email: fields.email,
    city: fields.city || "California",
    logo: logoPath,
  });
  if (!partner) return { error: "not_found" };

  return {
    partner,
    bannerUrl: `/api/partners/${encodeURIComponent(partner.slug)}/banner`,
  };
}
