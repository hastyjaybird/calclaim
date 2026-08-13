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
