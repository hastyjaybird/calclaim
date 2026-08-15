/** Consumer / free mailbox providers – not valid organization work domains. */
const FREE_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "yahoo.com",
  "yandex.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
  "fastmail.com",
  "zoho.com",
  "hey.com",
]);

export type PartnerAccountType = "organization" | "individual";

export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Organizations must use a work domain; individuals may use any valid email. */
export function validateSignupEmail(
  accountType: PartnerAccountType,
  email: string,
): { email: string; domain: string } | { error: string } {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return { error: "email_required" };
  if (!isValidEmailFormat(cleaned)) return { error: "email_invalid" };
  const domain = emailDomain(cleaned);
  if (!domain) return { error: "email_invalid" };
  if (accountType === "organization" && isFreeEmailDomain(domain)) {
    return { error: "email_org_domain_required" };
  }
  return { email: cleaned, domain };
}

/**
 * Normalize an organization email domain (e.g. "Acme.ORG", "@acme.org" → "acme.org").
 * Rejects free mailbox providers – same rule as organization signup emails.
 */
export function normalizeOrgEmailDomain(
  value: unknown,
): { domain: string } | { error: string } {
  if (typeof value !== "string") return { error: "email_domain_required" };
  let domain = value.trim().toLowerCase();
  if (!domain) return { error: "email_domain_required" };
  if (domain.startsWith("@")) domain = domain.slice(1);
  if (domain.includes("@")) {
    // Allow pasting a full email; keep only the domain part.
    domain = emailDomain(domain) || domain;
  }
  domain = domain.replace(/\.+$/, "").replace(/^\.+/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { error: "email_domain_invalid" };
  }
  if (isFreeEmailDomain(domain)) {
    return { error: "email_org_domain_required" };
  }
  return { domain };
}

export function parseAccountType(value: unknown): PartnerAccountType | { error: string } {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "organization" || raw === "org") return "organization";
  if (raw === "individual" || raw === "person") return "individual";
  if (!raw) return { error: "account_type_required" };
  return { error: "account_type_invalid" };
}
