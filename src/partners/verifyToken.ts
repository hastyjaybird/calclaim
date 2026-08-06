import { createHmac, timingSafeEqual } from "node:crypto";

/** Email verification link TTL (default 48 hours). */
const DEFAULT_TTL_SEC = 48 * 60 * 60;

export function issueEmailVerifyToken(
  secret: string,
  partnerId: string,
  email: string,
  ttlSec = DEFAULT_TTL_SEC,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const id = partnerId.toLowerCase();
  const mail = email.trim().toLowerCase();
  const payload = `${id}:${mail}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${id}.${exp}.${sig}`;
}

export function parseEmailVerifyToken(
  secret: string,
  token: string,
): { partnerId: string; exp: number } | null {
  const cleaned = String(token || "").trim();
  const parts = cleaned.split(".");
  if (parts.length !== 3) return null;
  const [partnerId, expStr, sig] = parts;
  if (!partnerId || !expStr || !sig) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return { partnerId: partnerId.toLowerCase(), exp };
}

/** Verify HMAC using the partner's current email (must match token payload). */
export function verifyEmailVerifyToken(
  secret: string,
  partnerId: string,
  email: string,
  token: string,
): boolean {
  const cleaned = String(token || "").trim();
  const parts = cleaned.split(".");
  if (parts.length !== 3) return false;
  const [tokenId, expStr, sig] = parts;
  if (!tokenId || !expStr || !sig) return false;
  if (tokenId.toLowerCase() !== partnerId.toLowerCase()) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const payload = `${partnerId.toLowerCase()}:${email.trim().toLowerCase()}:${exp}`;
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
