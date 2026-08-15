import { getPartnerBySlug, type Partner } from "../analytics/partners.js";
import type { AppConfig } from "../config.js";
import { partnerHasPrivateDashboard } from "./accountKind.js";
import { getSignedUpPartnerBySlug } from "./db.js";
import {
  emailDomain,
  isValidEmailFormat,
} from "./emailDomains.js";
import { sendPartnerLoginEmail } from "./email.js";
import {
  issuePartnerLoginToken,
  issuePartnerOwnerToken,
  parsePartnerLoginToken,
  verifyPartnerLoginToken,
} from "./editToken.js";

/** Simple per-email rate limit for magic-link requests. */
const recentLoginRequests = new Map<string, number>();
const LOGIN_REQUEST_COOLDOWN_MS = 45_000;

export type PartnerLoginRequestResult =
  | {
      ok: true;
      mode: "smtp" | "outbox";
      /** Present in outbox/demo mode so local testing can open the link. */
      loginUrl?: string;
    }
  | { ok: false; error: string };

export type PartnerLoginConfirmResult =
  | {
      ok: true;
      ownerToken: string;
      partnerId: string;
      slug: string;
      email: string;
      editable: boolean;
    }
  | { ok: false; error: string };

function orgPrivateUrl(baseUrl: string, slug: string, loginToken?: string): string {
  const root = baseUrl.replace(/\/$/, "");
  const path = `${root}/partners/${encodeURIComponent(slug)}/org`;
  if (!loginToken) return path;
  return `${path}?login=${encodeURIComponent(loginToken)}`;
}

/**
 * Anyone with an email on the organization's verified domain may request a
 * magic link. Individuals must use the exact signup email.
 */
export function emailAllowedForPartner(
  partner: Partner,
  email: string,
): boolean {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned || !isValidEmailFormat(cleaned)) return false;
  if (partner.accountType === "individual") {
    const signed = getSignedUpPartnerBySlug(partner.slug);
    if (!signed?.email) return false;
    return cleaned === signed.email.trim().toLowerCase();
  }
  const domain = (partner.emailDomain || "").trim().toLowerCase();
  if (!domain) return false;
  return emailDomain(cleaned) === domain;
}

export async function requestPartnerLogin(
  config: AppConfig,
  slug: string,
  emailRaw: string,
): Promise<PartnerLoginRequestResult> {
  const partner = getPartnerBySlug(slug);
  if (!partner) return { ok: false, error: "not_found" };
  if (!partner.emailVerified) return { ok: false, error: "unverified" };
  if (!partnerHasPrivateDashboard(partner.accountType)) {
    return { ok: false, error: "no_private_dashboard" };
  }

  const email = emailRaw.trim().toLowerCase();
  if (!email || !isValidEmailFormat(email)) {
    return { ok: false, error: "email_invalid" };
  }
  if (!emailAllowedForPartner(partner, email)) {
    return {
      ok: false,
      error:
        partner.accountType === "individual"
          ? "email_mismatch"
          : "email_domain_mismatch",
    };
  }

  const rateKey = `${partner.slug}:${email}`;
  const last = recentLoginRequests.get(rateKey) ?? 0;
  if (Date.now() - last < LOGIN_REQUEST_COOLDOWN_MS) {
    return { ok: false, error: "rate_limited" };
  }
  recentLoginRequests.set(rateKey, Date.now());

  const token = issuePartnerLoginToken(
    config.developerSessionSecret,
    partner.id,
    partner.slug,
    email,
  );
  const loginUrl = orgPrivateUrl(config.publicBaseUrl, partner.slug, token);
  const sent = await sendPartnerLoginEmail({
    partnerName: partner.name,
    partnerSlug: partner.slug,
    emailDomain: partner.emailDomain,
    accountType: partner.accountType,
    to: email,
    loginUrl,
  });

  return {
    ok: true,
    mode: sent.mode,
    ...(sent.mode === "outbox" ? { loginUrl } : {}),
  };
}

export function confirmPartnerLogin(
  config: AppConfig,
  slug: string,
  token: string,
): PartnerLoginConfirmResult {
  const partner = getPartnerBySlug(slug);
  if (!partner) return { ok: false, error: "not_found" };
  if (!partnerHasPrivateDashboard(partner.accountType)) {
    return { ok: false, error: "no_private_dashboard" };
  }

  const parsed = parsePartnerLoginToken(config.developerSessionSecret, token);
  if (!parsed) return { ok: false, error: "invalid_token" };
  if (parsed.partnerId !== partner.id.toLowerCase()) {
    return { ok: false, error: "invalid_token" };
  }
  if (
    !verifyPartnerLoginToken(
      config.developerSessionSecret,
      partner.id,
      partner.slug,
      parsed.email,
      token,
    )
  ) {
    return { ok: false, error: "invalid_token" };
  }
  if (!emailAllowedForPartner(partner, parsed.email)) {
    return { ok: false, error: "email_domain_mismatch" };
  }

  const ownerToken = issuePartnerOwnerToken(
    config.developerSessionSecret,
    partner.id,
    partner.slug,
  );
  return {
    ok: true,
    ownerToken,
    partnerId: partner.id,
    slug: partner.slug,
    email: parsed.email,
    editable: Boolean(getSignedUpPartnerBySlug(partner.slug)),
  };
}
