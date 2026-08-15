import { campaignLandingUrl, type AppConfig } from "../config.js";
import { renderShareQrPng } from "../bot/share.js";
import { getPartnerBySlug } from "../analytics/partners.js";
import { renderPartnerBoothBannerPdf } from "./banner.js";
import {
  allocateUniqueSlug,
  cancelSignedUpPartner,
  deleteSignedUpPartner,
  getSignedUpPartnerById,
  getSignedUpPartnerBySlug,
  insertSignedUpPartner,
  randomPartnerToken,
  updateSignedUpPartner,
  type SignedUpPartner,
} from "./db.js";
import { deletePartnerEventsForPartner } from "./events.js";
import {
  parseAccountType,
  validateSignupEmail,
  normalizeOrgEmailDomain,
  type PartnerAccountType,
} from "./emailDomains.js";
import { partnerHasPrivateDashboard } from "./accountKind.js";
import {
  issuePartnerCancelToken,
  issuePartnerEditToken,
  verifyPartnerCancelToken,
  verifyPartnerEditToken,
} from "./editToken.js";
import {
  sendPartnerVerificationEmail,
  sendPartnerWelcomeEmail,
  type SendPartnerEmailResult,
} from "./email.js";
import { deletePartnerLogoFiles, savePartnerLogoUpload } from "./logoUpload.js";
import { issueEmailVerifyToken } from "./verifyToken.js";

export interface PartnerSignupInput {
  name?: unknown;
  email?: unknown;
  city?: unknown;
  partnerId?: unknown;
  accountType?: unknown;
}

export interface PartnerSignupPendingResult {
  partner: SignedUpPartner;
  pendingVerification: true;
  verifyHintEmail: string;
  emailDomain: string;
  email: SendPartnerEmailResult;
  /** Present when SMTP is unset so local demos can open the link from the API response. */
  verifyUrl?: string;
}

export interface PartnerKitResult {
  partner: SignedUpPartner;
  statusUrl: string;
  qrUrl: string;
  bannerUrl: string;
  editToken: string;
  cancelUrl?: string;
  email: SendPartnerEmailResult;
}

function trimField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Normalize an optional partner website URL for storage / leaderboard links.
 * Empty input clears the field. Bare domains get https://. Only http(s) allowed.
 */
export function normalizePartnerWebsite(
  value: unknown,
): { website: string } | { error: "website_invalid" } {
  const raw = trimField(value, 500);
  if (!raw) return { website: "" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "website_invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "website_invalid" };
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { error: "website_invalid" };
  }
  return { website: parsed.toString().slice(0, 500) };
}

export function parsePartnerSignup(input: PartnerSignupInput): {
  name: string;
  email: string;
  city: string;
  accountType: PartnerAccountType;
  emailDomain: string;
} | { error: string } {
  const accountType = parseAccountType(input.accountType ?? "organization");
  if (typeof accountType === "object" && "error" in accountType) {
    return accountType;
  }
  const name = trimField(input.name, 120);
  const city = trimField(input.city, 80);
  if (!name) {
    return {
      error:
        accountType === "individual" ? "name_required_individual" : "name_required",
    };
  }
  const emailCheck = validateSignupEmail(
    accountType,
    trimField(input.email, 200),
  );
  if ("error" in emailCheck) return emailCheck;
  return {
    name,
    email: emailCheck.email,
    city,
    accountType,
    emailDomain: emailCheck.domain,
  };
}

export async function registerPartnerSignup(
  config: AppConfig,
  fields: {
    name: string;
    email: string;
    city: string;
    accountType: PartnerAccountType;
    emailDomain: string;
    logo?: { buffer: Buffer; mime: string; filename: string };
  },
): Promise<PartnerSignupPendingResult> {
  const token = randomPartnerToken(4);
  // Underscores only – must match Telegram /start alphabet and library campaign style.
  const id = `p_${token}`;
  const slug = allocateUniqueSlug(fields.name);
  // Ensure we didn't collide with a library partner slug
  let finalSlug = slug;
  if (getPartnerBySlug(finalSlug)) {
    finalSlug = allocateUniqueSlug(`${fields.name}-${token}`);
  }
  const campaignId = `qr_p_${token}`;

  let logoPath = "";
  if (fields.logo) {
    logoPath = savePartnerLogoUpload(id, fields.logo);
  }

  const blurb =
    fields.accountType === "individual"
      ? "Individual outreach partner"
      : "Community outreach partner";

  const partner = insertSignedUpPartner({
    id,
    slug: finalSlug,
    name: fields.name,
    email: fields.email,
    city: fields.city || "California",
    campaignId,
    logo: logoPath,
    blurb,
    accountType: fields.accountType,
    emailDomain: fields.emailDomain,
    emailVerifiedAt: null,
    showOnLeaderboard: true,
  });

  const verifyToken = issueEmailVerifyToken(
    config.developerSessionSecret,
    partner.id,
    partner.email,
  );
  const verifyUrl = `${config.publicBaseUrl}/partners/verify?token=${encodeURIComponent(verifyToken)}`;

  const email = await sendPartnerVerificationEmail({ partner, verifyUrl });

  return {
    partner,
    pendingVerification: true,
    verifyHintEmail: partner.email,
    emailDomain: partner.emailDomain,
    email,
    verifyUrl: email.mode === "outbox" ? verifyUrl : undefined,
  };
}

/**
 * Developer-created organization partner. Skips email verification, sets the
 * work domain explicitly, and defaults to hidden from the public leaderboard
 * unless `showOnLeaderboard` is true.
 */
export function registerManualPartner(fields: {
  name: string;
  emailDomain: string;
  email?: string;
  city?: string;
  website?: string;
  showOnLeaderboard?: boolean;
  logo?: { buffer: Buffer; mime: string; filename: string };
}): { partner: SignedUpPartner } | { error: string } {
  const name = trimField(fields.name, 120);
  if (!name) return { error: "name_required" };

  const domainCheck = normalizeOrgEmailDomain(fields.emailDomain);
  if ("error" in domainCheck) return domainCheck;
  const emailDomain = domainCheck.domain;

  let email = trimField(fields.email, 200).toLowerCase();
  if (email) {
    const emailCheck = validateSignupEmail("organization", email);
    if ("error" in emailCheck) return emailCheck;
    if (emailCheck.domain !== emailDomain) {
      return { error: "email_domain_mismatch" };
    }
    email = emailCheck.email;
  } else {
    email = `contact@${emailDomain}`;
  }

  let website = "";
  if (fields.website !== undefined) {
    const web = normalizePartnerWebsite(fields.website);
    if ("error" in web) return web;
    website = web.website;
  }

  const token = randomPartnerToken(4);
  const id = `p_${token}`;
  let finalSlug = allocateUniqueSlug(name);
  if (getPartnerBySlug(finalSlug)) {
    finalSlug = allocateUniqueSlug(`${name}-${token}`);
  }
  const campaignId = `qr_p_${token}`;

  let logoPath = "";
  if (fields.logo) {
    logoPath = savePartnerLogoUpload(id, fields.logo);
  }

  const partner = insertSignedUpPartner({
    id,
    slug: finalSlug,
    name,
    email,
    city: trimField(fields.city, 80) || "California",
    campaignId,
    logo: logoPath,
    blurb: "Community outreach partner",
    website,
    accountType: "organization",
    emailDomain,
    // Operator-created: ready for domain login without a verification email.
    emailVerifiedAt: new Date().toISOString(),
    showOnLeaderboard: Boolean(fields.showOnLeaderboard),
  });

  return { partner };
}

/** Build QR kit + welcome email after the signup email is verified. */
export async function deliverPartnerKit(
  config: AppConfig,
  partner: SignedUpPartner,
): Promise<PartnerKitResult> {
  const statusUrl = `${config.publicBaseUrl}/partners/${encodeURIComponent(partner.slug)}`;
  const qrUrl = `${config.publicBaseUrl}/api/qr/partner/${encodeURIComponent(partner.slug)}`;
  const bannerUrl = `${config.publicBaseUrl}/api/partners/${encodeURIComponent(partner.slug)}/banner`;
  const qrTarget = campaignLandingUrl(config.publicBaseUrl, partner.campaignId);

  const [qrPng, bannerPdf] = await Promise.all([
    renderShareQrPng(qrTarget),
    renderPartnerBoothBannerPdf({
      partnerName: partner.name,
      qrTargetUrl: qrTarget,
      partnerLogoPath: partner.logo || null,
    }),
  ]);

  let cancelUrl: string | undefined;
  if (!partnerHasPrivateDashboard(partner.accountType)) {
    const cancelToken = issuePartnerCancelToken(
      config.developerSessionSecret,
      partner.id,
      partner.slug,
    );
    cancelUrl = `${config.publicBaseUrl}/partners/cancel?token=${encodeURIComponent(cancelToken)}`;
  }

  const email = await sendPartnerWelcomeEmail({
    partner,
    statusUrl,
    qrUrl,
    bannerUrl,
    cancelUrl,
    qrPng,
    bannerPdf,
  });

  const editToken = partnerHasPrivateDashboard(partner.accountType)
    ? issuePartnerEditToken(
        config.developerSessionSecret,
        partner.id,
        partner.slug,
      )
    : "";

  return { partner, statusUrl, qrUrl, bannerUrl, editToken, cancelUrl, email };
}

export function parsePartnerProfileUpdate(
  input: PartnerSignupInput,
  defaults?: { accountType?: PartnerAccountType },
): {
  name: string;
  email: string;
  city: string;
  partnerId: string;
  accountType: PartnerAccountType;
  emailDomain: string;
} | { error: string } {
  const parsed = parsePartnerSignup({
    ...input,
    accountType: input.accountType ?? defaults?.accountType ?? "organization",
  });
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
    website?: string;
    partnerId?: string;
    editToken?: string;
    asDeveloper?: boolean;
    asOwner?: boolean;
    logo?: { buffer: Buffer; mime: string; filename: string };
    editTokenSecret?: string;
    accountType?: PartnerAccountType;
    emailDomain?: string;
    showOnLeaderboard?: boolean;
    /** When set, re-issue verification for a changed email. */
    publicBaseUrl?: string;
  },
): Promise<
  | {
      partner: SignedUpPartner;
      bannerUrl: string;
      pendingVerification?: boolean;
      verifyUrl?: string;
      email?: SendPartnerEmailResult;
    }
  | { error: string }
> {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return { error: "not_found" };
  if (existing.canceledAt) return { error: "canceled" };

  if (!fields.asDeveloper && !fields.asOwner) {
    const partnerId = trimField(fields.partnerId, 40).toLowerCase();
    const editToken = trimField(fields.editToken, 200);
    if (!partnerId) return { error: "partner_id_required" };
    if (existing.id.toLowerCase() !== partnerId) {
      return { error: "partner_id_mismatch" };
    }
    if (
      !fields.editTokenSecret ||
      !verifyPartnerEditToken(
        fields.editTokenSecret,
        partnerId,
        existing.slug,
        editToken,
      )
    ) {
      return { error: "edit_expired" };
    }
  }

  let logoPath: string | undefined;
  if (fields.logo) {
    logoPath = savePartnerLogoUpload(existing.id, fields.logo);
  }

  const nextEmail = fields.email;
  const emailChanged = nextEmail.toLowerCase() !== existing.email.toLowerCase();
  const accountType = fields.accountType ?? existing.accountType;
  const emailCheck = validateSignupEmail(accountType, nextEmail);
  if ("error" in emailCheck) return emailCheck;

  let emailDomain = emailCheck.domain;
  if (fields.asDeveloper && fields.emailDomain !== undefined) {
    const domainCheck = normalizeOrgEmailDomain(fields.emailDomain);
    if ("error" in domainCheck) return domainCheck;
    if (accountType === "organization" && emailCheck.domain !== domainCheck.domain) {
      return { error: "email_domain_mismatch" };
    }
    emailDomain = domainCheck.domain;
  }

  let website = existing.website;
  if (fields.website !== undefined) {
    const web = normalizePartnerWebsite(fields.website);
    if ("error" in web) return web;
    website = web.website;
  }

  const showOnLeaderboard =
    fields.asDeveloper && fields.showOnLeaderboard !== undefined
      ? fields.showOnLeaderboard
      : undefined;

  // Name/email/city/logo/website only – id, slug, and campaignId stay fixed.
  const partner = updateSignedUpPartner(existing.slug, {
    name: fields.name,
    email: emailCheck.email,
    city: fields.city || "California",
    logo: logoPath,
    website,
    emailDomain,
    emailVerifiedAt: emailChanged ? null : existing.emailVerifiedAt,
    showOnLeaderboard,
  });
  if (!partner) return { error: "not_found" };

  const result: {
    partner: SignedUpPartner;
    bannerUrl: string;
    pendingVerification?: boolean;
    verifyUrl?: string;
    email?: SendPartnerEmailResult;
  } = {
    partner,
    bannerUrl: `/api/partners/${encodeURIComponent(partner.slug)}/banner`,
  };

  if (emailChanged && fields.editTokenSecret && fields.publicBaseUrl) {
    const verifyToken = issueEmailVerifyToken(
      fields.editTokenSecret,
      partner.id,
      partner.email,
    );
    const verifyUrl = `${fields.publicBaseUrl}/partners/verify?token=${encodeURIComponent(verifyToken)}`;
    const email = await sendPartnerVerificationEmail({ partner, verifyUrl });
    result.pendingVerification = true;
    result.email = email;
    if (email.mode === "outbox") result.verifyUrl = verifyUrl;
  }

  return result;
}

export function deletePartnerAccount(
  slug: string,
): { ok: true; canceledAt: string } | { error: "not_found" | "already_canceled" } {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return { error: "not_found" };
  if (existing.canceledAt) {
    return { error: "already_canceled" };
  }
  // Soft-cancel: keep the row for the developer partners panel with signup + cancel dates.
  const canceled = cancelSignedUpPartner(existing.slug);
  if (!canceled?.canceledAt) return { error: "not_found" };
  return { ok: true, canceledAt: canceled.canceledAt };
}

/**
 * Individual partners cancel via a tokenized URL in their welcome email
 * (no private sign-in page). Removes them from the public leaderboard only.
 */
export function cancelPartnerAccountByToken(
  secret: string,
  token: string,
):
  | { ok: true; partner: SignedUpPartner; alreadyCanceled: boolean }
  | { error: "invalid_token" | "not_found" | "not_individual" } {
  const cleaned = String(token || "").trim();
  if (!cleaned.startsWith("cancel.")) return { error: "invalid_token" };
  const partnerId = cleaned.split(".")[1]?.toLowerCase() || "";
  if (!partnerId) return { error: "invalid_token" };
  const existing = getSignedUpPartnerById(partnerId);
  if (!existing) return { error: "not_found" };
  if (partnerHasPrivateDashboard(existing.accountType)) {
    return { error: "not_individual" };
  }
  if (
    !verifyPartnerCancelToken(secret, existing.id, existing.slug, cleaned)
  ) {
    return { error: "invalid_token" };
  }
  if (existing.canceledAt) {
    return { ok: true, partner: existing, alreadyCanceled: true };
  }
  const canceled = cancelSignedUpPartner(existing.slug);
  if (!canceled) return { error: "not_found" };
  return { ok: true, partner: canceled, alreadyCanceled: false };
}

/** Hard remove (operator tooling). Prefer soft-cancel for partner-facing flows. */
export function purgePartnerAccount(
  slug: string,
): { ok: true } | { error: "not_found" } {
  const existing = getSignedUpPartnerBySlug(slug);
  if (!existing) return { error: "not_found" };
  deletePartnerEventsForPartner(existing.slug, existing.id);
  deletePartnerLogoFiles(existing.id, existing.logo);
  deleteSignedUpPartner(existing.slug);
  return { ok: true };
}
