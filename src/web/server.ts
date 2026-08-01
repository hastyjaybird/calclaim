import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  campaignSource,
  getCampaign,
  sanitizeStartPayload,
} from "../analytics/campaigns.js";
import { recordEvent } from "../analytics/db.js";
import { clientIp, coarseFromIp, fromCampaignPin } from "../analytics/geo.js";
import { buildImpactStats } from "../analytics/stats.js";
import type { AppConfig } from "../config.js";
import { getBotUsername, ROOT } from "../config.js";
import { getProgram } from "../corpus/load.js";
import {
  listFeedbackTodos,
  setFeedbackTodoStatus,
  type FeedbackTodoStatus,
} from "../feedback/todos.js";
import { getScan, listFindings, setFindingStatus } from "../watchdog/db.js";
import { buildDevStatus } from "../watchdog/overview.js";
import { startCorpusScan } from "../watchdog/runner.js";
import type { FindingStatus } from "../watchdog/types.js";
import {
  createCaptchaChallenge,
  createSession,
  DEVELOPER_ACCESS_POLICY,
  destroySession,
  isDeveloperAuthed,
  readJsonBody,
  sessionClearCookieHeaders,
  sessionSetCookieHeaders,
  verifyCaptcha,
  verifyDeveloperPassword,
} from "./devAuth.js";

const PUBLIC_DIR = path.join(ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Login assets are public; everything else under /dev requires a session. */
const DEV_PUBLIC_FILES = new Set([
  "/dev/login.html",
  "/dev/login.css",
  "/dev/login.js",
]);

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  const headers: Record<string, string | string[]> = {
    "Content-Type": contentType,
    "Cache-Control": contentType.includes("json") ? "no-store" : "public, max-age=60",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

function redirect(
  res: http.ServerResponse,
  location: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end();
}

function isSecureRequest(req: http.IncomingMessage, config: AppConfig): boolean {
  if (config.publicBaseUrl.startsWith("https://")) return true;
  const proto = req.headers["x-forwarded-proto"];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return value === "https";
}

function developerNoIndexHeaders(): Record<string, string> {
  return {
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "no-store",
  };
}

function serveStatic(
  res: http.ServerResponse,
  urlPath: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  let rel = urlPath;
  if (rel === "/" || rel === "/impact" || rel === "/impact/") rel = "/impact/index.html";
  if (rel === "/dev" || rel === "/dev/") rel = "/dev/index.html";
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8", extraHeaders);
    return;
  }
  const ext = path.extname(filePath);
  send(
    res,
    200,
    fs.readFileSync(filePath),
    MIME[ext] ?? "application/octet-stream",
    extraHeaders,
  );
}

async function handleDevAuthApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  config: AppConfig,
): Promise<boolean> {
  const secure = isSecureRequest(req, config);
  const noIndex = developerNoIndexHeaders();

  if (pathname === "/api/dev/captcha" && req.method === "GET") {
    const challenge = createCaptchaChallenge();
    send(
      res,
      200,
      JSON.stringify({
        id: challenge.id,
        question: challenge.question,
        svg: challenge.svg,
        policy: DEVELOPER_ACCESS_POLICY,
      }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/login" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req)) as {
        password?: string;
        captchaId?: string;
        captchaAnswer?: string;
        humanAttestation?: boolean;
      };

      if (body.humanAttestation !== true) {
        send(
          res,
          403,
          JSON.stringify({
            error:
              "Human attestation required. Non-human systems may not log in.",
          }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }

      if (!verifyCaptcha(body.captchaId ?? "", body.captchaAnswer ?? "")) {
        send(
          res,
          401,
          JSON.stringify({ error: "CAPTCHA incorrect or expired. Try again." }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }

      if (!verifyDeveloperPassword(body.password ?? "", config.developerPassword)) {
        send(
          res,
          401,
          JSON.stringify({ error: "Invalid password." }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }

      const session = createSession(config.developerSessionSecret);
      send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8", {
        ...noIndex,
        "Set-Cookie": sessionSetCookieHeaders(
          session.token,
          session.sig,
          session.maxAgeSec,
          secure,
        ),
      });
    } catch {
      send(
        res,
        400,
        JSON.stringify({ error: "Bad request." }),
        "application/json; charset=utf-8",
        noIndex,
      );
    }
    return true;
  }

  if (pathname === "/api/dev/logout" && (req.method === "POST" || req.method === "GET")) {
    destroySession(req);
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8", {
      ...noIndex,
      "Set-Cookie": sessionClearCookieHeaders(secure),
    });
    return true;
  }

  if (pathname === "/api/dev/session" && req.method === "GET") {
    const ok = isDeveloperAuthed(req, config.developerSessionSecret);
    send(
      res,
      200,
      JSON.stringify({ authenticated: ok, policy: DEVELOPER_ACCESS_POLICY }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  return false;
}

function requireDeveloperAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AppConfig,
  pathname: string,
): boolean {
  if (isDeveloperAuthed(req, config.developerSessionSecret)) return true;

  const noIndex = developerNoIndexHeaders();
  if (pathname.startsWith("/api/")) {
    send(
      res,
      401,
      JSON.stringify({
        error: "Authentication required.",
        policy: DEVELOPER_ACCESS_POLICY,
      }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return false;
  }

  const next = encodeURIComponent(pathname || "/dev");
  redirect(res, `/dev/login.html?next=${next}`, noIndex);
  return false;
}

async function handleDevApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  const noIndex = developerNoIndexHeaders();

  if (pathname === "/api/dev/status" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(buildDevStatus()),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/scan" && req.method === "POST") {
    try {
      const { scan } = startCorpusScan();
      send(res, 202, JSON.stringify({ scan }), "application/json; charset=utf-8", noIndex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 409, JSON.stringify({ error: message }), "application/json; charset=utf-8", noIndex);
    }
    return true;
  }

  const scanMatch = pathname.match(/^\/api\/dev\/scan\/(\d+)$/);
  if (scanMatch && req.method === "GET") {
    const scan = getScan(Number(scanMatch[1]));
    if (!scan) {
      send(res, 404, JSON.stringify({ error: "Scan not found" }), "application/json; charset=utf-8", noIndex);
      return true;
    }
    const findings = listFindings({ scanId: scan.id });
    send(
      res,
      200,
      JSON.stringify({ scan, findings }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/findings" && req.method === "GET") {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const statusParam = url.searchParams.get("status") ?? "open";
    const status =
      statusParam === "all" ||
      statusParam === "open" ||
      statusParam === "acknowledged" ||
      statusParam === "dismissed" ||
      statusParam === "fixed"
        ? statusParam
        : "open";
    send(
      res,
      200,
      JSON.stringify({ findings: listFindings({ status, limit: 200 }) }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  const findingMatch = pathname.match(/^\/api\/dev\/findings\/(\d+)$/);
  if (findingMatch && req.method === "PATCH") {
    try {
      const body = (await readJsonBody(req)) as { status?: string };
      const allowed: FindingStatus[] = ["open", "acknowledged", "dismissed", "fixed"];
      if (!body.status || !allowed.includes(body.status as FindingStatus)) {
        send(
          res,
          400,
          JSON.stringify({ error: "status must be open|acknowledged|dismissed|fixed" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      const finding = setFindingStatus(Number(findingMatch[1]), body.status as FindingStatus);
      if (!finding) {
        send(
          res,
          404,
          JSON.stringify({ error: "Finding not found" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      send(res, 200, JSON.stringify({ finding }), "application/json; charset=utf-8", noIndex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, JSON.stringify({ error: message }), "application/json; charset=utf-8", noIndex);
    }
    return true;
  }

  if (pathname === "/api/dev/feedback-todos" && req.method === "GET") {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const statusParam = url.searchParams.get("status") ?? "open";
    const status =
      statusParam === "all" || statusParam === "open" || statusParam === "done"
        ? statusParam
        : "open";
    send(
      res,
      200,
      JSON.stringify({ todos: listFeedbackTodos({ status, limit: 200 }) }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  const feedbackMatch = pathname.match(/^\/api\/dev\/feedback-todos\/(\d+)$/);
  if (feedbackMatch && req.method === "PATCH") {
    try {
      const body = (await readJsonBody(req)) as { status?: string };
      const allowed: FeedbackTodoStatus[] = ["open", "done"];
      if (!body.status || !allowed.includes(body.status as FeedbackTodoStatus)) {
        send(
          res,
          400,
          JSON.stringify({ error: "status must be open|done" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      const todo = setFeedbackTodoStatus(
        Number(feedbackMatch[1]),
        body.status as FeedbackTodoStatus,
      );
      if (!todo) {
        send(
          res,
          404,
          JSON.stringify({ error: "Feedback todo not found" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      send(res, 200, JSON.stringify({ todo }), "application/json; charset=utf-8", noIndex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, JSON.stringify({ error: message }), "application/json; charset=utf-8", noIndex);
    }
    return true;
  }

  return false;
}

async function handleGo(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  campaignIdRaw: string,
  config: AppConfig,
): Promise<void> {
  const campaignId = sanitizeStartPayload(decodeURIComponent(campaignIdRaw)) ?? "link_share";
  const campaign = getCampaign(campaignId);
  const source = campaignSource(campaign);
  const pin = fromCampaignPin({
    lat: campaign?.lat ?? null,
    lng: campaign?.lng ?? null,
    label: campaign?.label ?? campaign?.name ?? campaignId,
  });

  let geo = pin;
  if (geo.lat == null) {
    const ip = clientIp(
      { get: (n) => {
        const v = req.headers[n];
        return Array.isArray(v) ? v[0] : v;
      } },
      req.socket.remoteAddress,
    );
    const fromIp = await coarseFromIp(ip);
    if (fromIp.lat != null) geo = fromIp;
  }

  recordEvent({
    eventType: "awareness",
    source,
    campaignId,
    lat: geo.lat,
    lng: geo.lng,
    label: geo.label,
  });

  const username = getBotUsername(config.botUsername);
  if (!username) {
    send(
      res,
      503,
      "Bot username not ready yet. Set TELEGRAM_BOT_USERNAME or wait for startup.",
      "text/plain; charset=utf-8",
    );
    return;
  }
  redirect(res, `https://t.me/${username}?start=${encodeURIComponent(campaignId)}`);
}

async function handleApplyRedirect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  programIdRaw: string,
): Promise<void> {
  const programId = decodeURIComponent(programIdRaw).replace(/[^a-z0-9_]/gi, "");
  const program = getProgram(programId);
  if (!program) {
    send(res, 404, "Unknown program", "text/plain; charset=utf-8");
    return;
  }

  const ip = clientIp(
    { get: (n) => {
      const v = req.headers[n];
      return Array.isArray(v) ? v[0] : v;
    } },
    req.socket.remoteAddress,
  );
  const geo = await coarseFromIp(ip);

  recordEvent({
    eventType: "program_open",
    source: "bot",
    programId: program.id,
    lat: geo.lat,
    lng: geo.lng,
    label: geo.label,
  });

  redirect(res, program.applyUrl);
}

export type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

export function createWebHandler(config: AppConfig, telegramWebhook?: RequestHandler): RequestHandler {
  return async (req, res) => {
    try {
      const host = req.headers.host ?? `localhost:${config.port}`;
      const url = new URL(req.url ?? "/", `http://${host}`);
      const pathname = url.pathname;

      if (pathname === "/health") {
        send(res, 200, "ok", "text/plain; charset=utf-8");
        return;
      }

      if (pathname === "/robots.txt") {
        serveStatic(res, "/robots.txt");
        return;
      }

      if (pathname === "/api/stats") {
        send(res, 200, JSON.stringify(buildImpactStats()), "application/json; charset=utf-8");
        return;
      }

      if (pathname.startsWith("/api/dev")) {
        const authHandled = await handleDevAuthApi(req, res, pathname, config);
        if (authHandled) return;
        if (!requireDeveloperAuth(req, res, config, pathname)) return;
        const handled = await handleDevApi(req, res, pathname);
        if (handled) return;
        send(
          res,
          404,
          JSON.stringify({ error: "Not found" }),
          "application/json; charset=utf-8",
          developerNoIndexHeaders(),
        );
        return;
      }

      if (pathname.startsWith("/go/")) {
        const id = pathname.slice("/go/".length).split("/")[0] ?? "";
        await handleGo(req, res, id, config);
        return;
      }

      if (pathname.startsWith("/r/")) {
        const id = pathname.slice("/r/".length).split("/")[0] ?? "";
        await handleApplyRedirect(req, res, id);
        return;
      }

      if (pathname === "/dev" || pathname.startsWith("/dev/")) {
        const rel =
          pathname === "/dev" || pathname === "/dev/" ? "/dev/index.html" : pathname;
        if (DEV_PUBLIC_FILES.has(rel)) {
          serveStatic(res, rel, developerNoIndexHeaders());
          return;
        }
        if (!requireDeveloperAuth(req, res, config, pathname)) return;
        serveStatic(res, rel, developerNoIndexHeaders());
        return;
      }

      if (
        pathname === "/" ||
        pathname === "/impact" ||
        pathname.startsWith("/impact/")
      ) {
        serveStatic(res, pathname === "/" ? "/impact" : pathname);
        return;
      }

      if (telegramWebhook && config.mode === "webhook") {
        await telegramWebhook(req, res);
        return;
      }

      send(res, 404, "Not found", "text/plain; charset=utf-8");
    } catch (err) {
      console.error("Web handler error:", err);
      if (!res.headersSent) {
        send(res, 500, "Server error", "text/plain; charset=utf-8");
      }
    }
  };
}

export function startWebServer(
  config: AppConfig,
  telegramWebhook?: RequestHandler,
): http.Server {
  const handler = createWebHandler(config, telegramWebhook);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(config.port, () => {
    console.log(`CalClaim web listening on :${config.port}`);
    console.log(`  Impact dashboard: ${config.publicBaseUrl}/impact`);
    console.log(`  Developer (password + CAPTCHA): ${config.publicBaseUrl}/dev`);
    console.log(`  Sample QR landing: ${config.publicBaseUrl}/go/qr_oakland_library`);
    if (!config.developerPassword) {
      console.warn("  DEVELOPER_PASSWORD is unset — developer login will fail until set.");
    }
  });
  return server;
}
