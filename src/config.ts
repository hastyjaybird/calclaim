import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Load .env into process.env if present (does not override existing env). */
export function loadDotEnv(): void {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export const ROOT = root;
export const LIBRARY_DIR = path.join(root, "library");
export const DATA_DIR = path.join(root, "data");
export const RESPONSES_PATH = path.join(DATA_DIR, "responses.jsonl");

export function loadConfig() {
  const mode = (process.env.BOT_MODE ?? "long_polling") as
    | "long_polling"
    | "webhook";
  const port = Number(process.env.PORT ?? "3000");
  const publicBaseUrl = (
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
  ).replace(/\/$/, "");
  const developerPassword = process.env.DEVELOPER_PASSWORD ?? "";
  const developerSessionSecret =
    process.env.DEVELOPER_SESSION_SECRET ??
    process.env.WEBHOOK_SECRET ??
    "calclaim-dev-session";
  // Local: no password page. Deploy (NODE_ENV=production): require login.
  // Override with DEVELOPER_AUTH=0|1 if needed.
  const authOverride = (process.env.DEVELOPER_AUTH ?? "").trim().toLowerCase();
  const developerAuthRequired =
    authOverride === "1" ||
    authOverride === "true" ||
    authOverride === "on"
      ? true
      : authOverride === "0" ||
          authOverride === "false" ||
          authOverride === "off"
        ? false
        : process.env.NODE_ENV === "production";
  return {
    token: env("TELEGRAM_BOT_TOKEN"),
    mode,
    webhookUrl: process.env.WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET ?? "calclaim-webhook",
    port,
    databasePath: process.env.DATABASE_PATH ?? path.join(DATA_DIR, "calclaim.sqlite"),
    tz: process.env.TZ ?? "America/Los_Angeles",
    /** Public origin for QR landings, apply redirects, and funder site */
    publicBaseUrl,
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "",
    /** Password for /dev (empty = developer login always fails when auth required) */
    developerPassword,
    developerSessionSecret,
    /** When false (local default), /dev skips password + CAPTCHA */
    developerAuthRequired,
    stripeSecretKey: (process.env.STRIPE_SECRET_KEY ?? "").trim(),
    stripePublishableKey: (process.env.STRIPE_PUBLISHABLE_KEY ?? "").trim(),
    stripeWebhookSecret: (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim(),
    /** Apple Pay domain association file contents from Stripe Dashboard. */
    stripeApplePayAssociation: (
      process.env.STRIPE_APPLE_PAY_ASSOCIATION ?? ""
    ).trim(),
  };
}

/** Mutable after getMe() so deep links work without env. */
let resolvedBotUsername = "";

export function setBotUsername(username: string): void {
  resolvedBotUsername = username.replace(/^@/, "");
}

export function getBotUsername(configUsername?: string): string {
  return resolvedBotUsername || (configUsername ?? "").replace(/^@/, "");
}

export function trackedApplyUrl(
  publicBaseUrl: string,
  programId: string,
  territoryId?: string | null,
): string {
  const base = `${publicBaseUrl}/r/${encodeURIComponent(programId)}`;
  if (!territoryId) return base;
  return `${base}?t=${encodeURIComponent(territoryId)}`;
}

export function campaignLandingUrl(publicBaseUrl: string, campaignId: string): string {
  return `${publicBaseUrl}/go/${encodeURIComponent(campaignId)}`;
}

export type AppConfig = ReturnType<typeof loadConfig>;
