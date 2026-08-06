import type { AppConfig } from "../config.js";
import {
  getSignedUpPartnerById,
  markPartnerEmailVerified,
  type SignedUpPartner,
} from "./db.js";
import { issuePartnerEditToken } from "./editToken.js";
import { deliverPartnerKit, type PartnerKitResult } from "./signup.js";
import {
  parseEmailVerifyToken,
  verifyEmailVerifyToken,
} from "./verifyToken.js";

export type VerifyPartnerEmailResult =
  | { ok: true; alreadyVerified: boolean; kit: PartnerKitResult }
  | { ok: false; error: string };

function kitUrlsWithoutResend(
  config: AppConfig,
  partner: SignedUpPartner,
): PartnerKitResult {
  const statusUrl = `${config.publicBaseUrl}/partners/${encodeURIComponent(partner.slug)}`;
  const qrUrl = `${config.publicBaseUrl}/api/qr/partner/${encodeURIComponent(partner.slug)}`;
  const bannerUrl = `${config.publicBaseUrl}/api/partners/${encodeURIComponent(partner.slug)}/banner`;
  const editToken = issuePartnerEditToken(
    config.developerSessionSecret,
    partner.id,
    partner.slug,
  );
  return {
    partner,
    statusUrl,
    qrUrl,
    bannerUrl,
    editToken,
    email: {
      ok: true,
      mode: "outbox",
      detail: "Already verified – kit not re-sent",
    },
  };
}

export async function verifyPartnerEmail(
  config: AppConfig,
  token: string,
): Promise<VerifyPartnerEmailResult> {
  const parsed = parseEmailVerifyToken(config.developerSessionSecret, token);
  if (!parsed) return { ok: false, error: "verify_invalid" };

  const partner = getSignedUpPartnerById(parsed.partnerId);
  if (!partner) return { ok: false, error: "verify_invalid" };

  if (
    !verifyEmailVerifyToken(
      config.developerSessionSecret,
      partner.id,
      partner.email,
      token,
    )
  ) {
    return { ok: false, error: "verify_invalid" };
  }

  if (partner.emailVerifiedAt) {
    return {
      ok: true,
      alreadyVerified: true,
      kit: kitUrlsWithoutResend(config, partner),
    };
  }

  const verified = markPartnerEmailVerified(partner.id);
  if (!verified) return { ok: false, error: "verify_failed" };

  const kit = await deliverPartnerKit(config, verified);
  return { ok: true, alreadyVerified: false, kit };
}

export function partnerVerificationPublicFields(partner: SignedUpPartner): {
  emailVerified: boolean;
  emailDomain: string;
  accountType: SignedUpPartner["accountType"];
} {
  return {
    emailVerified: Boolean(partner.emailVerifiedAt),
    emailDomain: partner.emailDomain,
    accountType: partner.accountType,
  };
}
