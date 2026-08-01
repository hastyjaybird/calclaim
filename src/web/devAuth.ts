import crypto from "node:crypto";
import type http from "node:http";

const SESSION_COOKIE = "calclaim_dev_session";
const CAPTCHA_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Access policy shown on login and in PRIVACY.md */
export const DEVELOPER_ACCESS_POLICY =
  "The Developer area is for authorized human operators only. Robots, crawlers, scrapers, automated scripts, AI agents, bots, and any other non-human systems are prohibited from logging in to or accessing this page.";

type CaptchaRecord = { answer: string; expiresAt: number };
type SessionRecord = { expiresAt: number };

const captchas = new Map<string, CaptchaRecord>();
const sessions = new Map<string, SessionRecord>();

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function pruneMaps(): void {
  const now = Date.now();
  for (const [k, v] of captchas) {
    if (v.expiresAt <= now) captchas.delete(k);
  }
  for (const [k, v] of sessions) {
    if (v.expiresAt <= now) sessions.delete(k);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function isDeveloperAuthed(
  req: http.IncomingMessage,
  sessionSecret: string,
): boolean {
  pruneMaps();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const record = sessions.get(token);
  if (!record || record.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  const expected = hmac(sessionSecret, `session:${token}`);
  const sig = cookies[`${SESSION_COOKIE}_sig`];
  if (!sig || !timingSafeEqualStr(sig, expected)) return false;
  // Sliding expiry
  record.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

export function createCaptchaChallenge(): {
  id: string;
  question: string;
  svg: string;
} {
  pruneMaps();
  const a = 2 + crypto.randomInt(8);
  const b = 1 + crypto.randomInt(9);
  const answer = String(a + b);
  const id = randomToken(18);
  captchas.set(id, { answer, expiresAt: Date.now() + CAPTCHA_TTL_MS });

  const question = `What is ${a} + ${b}?`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64" role="img" aria-label="${question}">
  <rect width="220" height="64" rx="10" fill="#e2ece8"/>
  <path d="M0 18 Q55 8 110 22 T220 14" stroke="rgba(13,122,95,0.25)" fill="none" stroke-width="2"/>
  <path d="M0 46 Q70 58 140 40 T220 50" stroke="rgba(16,36,31,0.12)" fill="none" stroke-width="2"/>
  <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
    font-family="Georgia, serif" font-size="26" font-weight="700" fill="#084d3d"
    letter-spacing="2">${a} + ${b} = ?</text>
</svg>`;

  return { id, question, svg };
}

export function verifyCaptcha(id: string, answer: string): boolean {
  pruneMaps();
  const record = captchas.get(id);
  captchas.delete(id);
  if (!record || record.expiresAt <= Date.now()) return false;
  const normalized = String(answer ?? "").trim().replace(/\s+/g, "");
  return timingSafeEqualStr(normalized, record.answer);
}

export function createSession(
  sessionSecret: string,
): { token: string; sig: string; maxAgeSec: number } {
  pruneMaps();
  const token = randomToken(32);
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  const sig = hmac(sessionSecret, `session:${token}`);
  return { token, sig, maxAgeSec: Math.floor(SESSION_TTL_MS / 1000) };
}

export function destroySession(req: http.IncomingMessage): void {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

export function sessionSetCookieHeaders(
  token: string,
  sig: string,
  maxAgeSec: number,
  secure: boolean,
): string[] {
  const base = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
  const flags = secure ? `${base}; Secure` : base;
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${flags}`,
    `${SESSION_COOKIE}_sig=${encodeURIComponent(sig)}; ${flags}`,
  ];
}

export function sessionClearCookieHeaders(secure: boolean): string[] {
  const base = "Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  const flags = secure ? `${base}; Secure` : base;
  return [
    `${SESSION_COOKIE}=; ${flags}`,
    `${SESSION_COOKIE}_sig=; ${flags}`,
  ];
}

export function verifyDeveloperPassword(
  provided: string,
  expected: string,
): boolean {
  if (!expected) return false;
  return timingSafeEqualStr(String(provided ?? ""), expected);
}

export async function readJsonBody(
  req: http.IncomingMessage,
  limit = 8_192,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

export { SESSION_COOKIE };
