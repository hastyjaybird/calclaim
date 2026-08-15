import { createHmac, timingSafeEqual } from "node:crypto";

/** Short-lived post-signup edit grant (default 2 hours). */
const DEFAULT_TTL_SEC = 2 * 60 * 60;

export function issuePartnerEditToken(
  secret: string,
  partnerId: string,
  slug: string,
  ttlSec = DEFAULT_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${partnerId.toLowerCase()}:${slug.toLowerCase()}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${exp}.${sig}`;
}

function verifySignedToken(
  secret: string,
  payload: string,
  token: string,
): boolean {
  const cleaned = String(token || "").trim();
  const dot = cleaned.indexOf(".");
  if (dot <= 0) return false;
  const expStr = cleaned.slice(0, dot);
  const sig = cleaned.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  if (!sig) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyPartnerEditToken(
  secret: string,
  partnerId: string,
  slug: string,
  token: string,
): boolean {
  const cleaned = String(token || "").trim();
  const dot = cleaned.indexOf(".");
  if (dot <= 0) return false;
  const expStr = cleaned.slice(0, dot);
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  const payload = `${partnerId.toLowerCase()}:${slug.toLowerCase()}:${exp}`;
  return verifySignedToken(secret, payload, cleaned);
}

/** Longer-lived grant for generating event QRs on the partner status page (30 days). */
const OWNER_TTL_SEC = 30 * 24 * 60 * 60;

export function issuePartnerOwnerToken(
  secret: string,
  partnerId: string,
  slug: string,
  ttlSec = OWNER_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `owner:${partnerId.toLowerCase()}:${slug.toLowerCase()}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `own.${exp}.${sig}`;
}

export function verifyPartnerOwnerToken(
  secret: string,
  partnerId: string,
  slug: string,
  token: string,
): boolean {
  const cleaned = String(token || "").trim();
  if (!cleaned.startsWith("own.")) return false;
  const rest = cleaned.slice(4);
  const dot = rest.indexOf(".");
  if (dot <= 0) return false;
  const expStr = rest.slice(0, dot);
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  const payload = `owner:${partnerId.toLowerCase()}:${slug.toLowerCase()}:${exp}`;
  return verifySignedToken(secret, payload, rest);
}

/** Magic-link sign-in for organization (or individual) private pages (1 hour). */
const LOGIN_TTL_SEC = 60 * 60;

/**
 * Permanent cancel grant for individual partners (no expiry). Bound to partner
 * id + slug so rotating the secret invalidates outstanding email links.
 */
export function issuePartnerCancelToken(
  secret: string,
  partnerId: string,
  slug: string,
): string {
  const payload = `cancel:${partnerId.toLowerCase()}:${slug.toLowerCase()}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `cancel.${partnerId.toLowerCase()}.${sig}`;
}

export function parsePartnerCancelToken(
  token: string,
): { partnerId: string; sig: string } | null {
  const cleaned = String(token || "").trim();
  if (!cleaned.startsWith("cancel.")) return null;
  const parts = cleaned.slice("cancel.".length).split(".");
  if (parts.length !== 2) return null;
  const [partnerId, sig] = parts;
  if (!partnerId || !sig) return null;
  return { partnerId: partnerId.toLowerCase(), sig };
}

export function verifyPartnerCancelToken(
  secret: string,
  partnerId: string,
  slug: string,
  token: string,
): boolean {
  const parsed = parsePartnerCancelToken(token);
  if (!parsed) return false;
  if (parsed.partnerId !== partnerId.toLowerCase()) return false;
  const expected = issuePartnerCancelToken(secret, partnerId, slug);
  try {
    const a = Buffer.from(token.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function encodeLoginEmail(email: string): string {
  return Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
}

function decodeLoginEmail(encoded: string): string | null {
  try {
    const email = Buffer.from(encoded, "base64url").toString("utf8").trim().toLowerCase();
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

export function issuePartnerLoginToken(
  secret: string,
  partnerId: string,
  slug: string,
  email: string,
  ttlSec = LOGIN_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const mail = email.trim().toLowerCase();
  const mailEnc = encodeLoginEmail(mail);
  const payload = `login:${partnerId.toLowerCase()}:${slug.toLowerCase()}:${mail}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `login.${partnerId.toLowerCase()}.${mailEnc}.${exp}.${sig}`;
}

export function parsePartnerLoginToken(
  secret: string,
  token: string,
): { partnerId: string; email: string; exp: number } | null {
  const cleaned = String(token || "").trim();
  if (!cleaned.startsWith("login.")) return null;
  const parts = cleaned.slice("login.".length).split(".");
  if (parts.length !== 4) return null;
  const [partnerId, mailEnc, expStr, sig] = parts;
  if (!partnerId || !mailEnc || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const email = decodeLoginEmail(mailEnc);
  if (!email) return null;
  return { partnerId: partnerId.toLowerCase(), email, exp };
}

export function verifyPartnerLoginToken(
  secret: string,
  partnerId: string,
  slug: string,
  email: string,
  token: string,
): boolean {
  const cleaned = String(token || "").trim();
  if (!cleaned.startsWith("login.")) return false;
  const parts = cleaned.slice("login.".length).split(".");
  if (parts.length !== 4) return false;
  const [tokenId, mailEnc, expStr, sig] = parts;
  if (!tokenId || !mailEnc || !expStr || !sig) return false;
  if (tokenId.toLowerCase() !== partnerId.toLowerCase()) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const mail = email.trim().toLowerCase();
  if (decodeLoginEmail(mailEnc) !== mail) return false;
  const payload = `login:${partnerId.toLowerCase()}:${slug.toLowerCase()}:${mail}:${exp}`;
  const rest = `${expStr}.${sig}`;
  return verifySignedToken(secret, payload, rest);
}
