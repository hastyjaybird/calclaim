import type { PartnerAccountType } from "./emailDomains.js";

/**
 * Individuals (typically Gmail) get a public stats page + leaderboard credit,
 * but no private /org dashboard or magic-link sign-in. Organizations keep the
 * full signed-in backend.
 */
export function partnerHasPrivateDashboard(accountType: PartnerAccountType): boolean {
  return accountType === "organization";
}

export function partnerListedOnLeaderboard(accountType: PartnerAccountType): boolean {
  return accountType === "organization" || accountType === "individual";
}
