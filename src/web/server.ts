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
import { getPartnerBySlug } from "../analytics/partners.js";
import {
  buildImpactStats,
  buildPartnerLeaderboard,
  impactStatsMode,
  buildPartnerStats,
} from "../analytics/stats.js";
import type { AppConfig } from "../config.js";
import { campaignLandingUrl, getBotUsername, ROOT } from "../config.js";
import { getProgram } from "../library/load.js";
import {
  buildProgramMatrix,
  updateProgramRequirements,
  type AvailabilityContext,
  type RequirementsPatch,
} from "../library/requirements.js";
import { renderShareQrPng } from "../bot/share.js";
import {
  getReportPdf,
  mailtoWithReportLink,
  reportDownloadUrl,
} from "../nextsteps/reportLinks.js";
import {
  listFeedbackTodos,
  setFeedbackTodoStatus,
  type FeedbackTodoStatus,
} from "../feedback/todos.js";
import {
  getWindow as getDisasterWindow,
  listWindows,
  setWindowStatus,
  updateWindowPeriods,
  type DisasterWindowStatus,
} from "../disaster/db.js";
import { lastApplyDay, offerableDisasterWindows } from "../disaster/liveWindow.js";
import { getScan, listFindings, setFindingStatus } from "../watchdog/db.js";
import { buildDevStatus, buildDisasterStatus } from "../watchdog/overview.js";
import { startLibraryScan } from "../watchdog/runner.js";
import type { FindingStatus } from "../watchdog/types.js";
import { appendContactMessage } from "../contact/messages.js";
import { renderPartnerBoothBannerPdf } from "../partners/banner.js";
import { listSignedUpPartners, RESERVED_PARTNER_SLUGS } from "../partners/db.js";
import { readPartnerSignupMultipart } from "../partners/logoUpload.js";
import {
  parsePartnerProfileUpdate,
  parsePartnerSignup,
  registerPartnerSignup,
  updatePartnerProfile,
} from "../partners/signup.js";
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
  ".pdf": "application/pdf",
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
  const isJson = contentType.includes("json");
  const isScriptOrCss =
    contentType.includes("javascript") || contentType.includes("css");
  const headers: Record<string, string | string[]> = {
    "Content-Type": contentType,
    // JS/CSS: short TTL + revalidate so i18n/copy updates aren't stuck behind CDN/browser cache.
    "Cache-Control": isJson
      ? "no-store"
      : isScriptOrCss
        ? "public, max-age=60, must-revalidate"
        : "public, max-age=60",
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

/** Public pages may be served under /es/... or /zh/... ; developer pages are English-only. */
function stripPublicLangPrefix(urlPath: string): { lang: "es" | "zh" | null; path: string } {
  const m = urlPath.match(/^\/(es|zh)(?=\/|$)/);
  if (!m) return { lang: null, path: urlPath };
  const rest = urlPath.slice(m[0].length) || "/";
  return { lang: m[1] as "es" | "zh", path: rest };
}

function serveStatic(
  res: http.ServerResponse,
  urlPath: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  let rel = urlPath;
  if (rel === "/" || rel === "/impact" || rel === "/impact/") rel = "/impact/index.html";
  if (rel === "/dev" || rel === "/dev/") rel = "/dev/index.html";
  // Partner deck template: /partners and /partners/:slug → partners/index.html
  // Signup form lives at /partners/signup
  if (rel === "/partners/signup" || rel === "/partners/signup/") {
    rel = "/partners/signup/index.html";
  } else if (rel === "/partners" || rel === "/partners/") {
    rel = "/partners/index.html";
  } else if (/^\/partners\/[A-Za-z0-9_-]+\/?$/.test(rel)) {
    rel = "/partners/index.html";
  }
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

/**
 * Live disaster windows for the requirements matrix. Passed in rather than
 * imported by the library module so the library layer stays free of DB access.
 */
function availabilityContext(): AvailabilityContext {
  return {
    disasterWindows: offerableDisasterWindows().map((w) => ({
      label: w.label,
      counties: w.counties,
      lastApplyDay: lastApplyDay(w),
    })),
  };
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

  // Always live collected events — never the public-site demo dataset.
  if (pathname === "/api/dev/stats" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(buildImpactStats({ source: "live" })),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/partners" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify({
        partners: listSignedUpPartners().map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          email: p.email,
          city: p.city,
          logo: p.logo || "",
          campaignId: p.campaignId,
          createdAt: p.createdAt,
          statusUrl: `/partners/${encodeURIComponent(p.slug)}`,
          bannerUrl: `/api/partners/${encodeURIComponent(p.slug)}/banner`,
        })),
      }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/scan" && req.method === "POST") {
    try {
      const { scan } = startLibraryScan();
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

  if (pathname === "/api/dev/program-matrix" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(buildProgramMatrix(availabilityContext())),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  const matrixMatch = pathname.match(/^\/api\/dev\/program-matrix\/([a-z0-9_]+)$/);
  if (matrixMatch && req.method === "PATCH") {
    try {
      const patch = (await readJsonBody(req, 32_768)) as RequirementsPatch;
      const ctx = availabilityContext();
      const row = updateProgramRequirements(matrixMatch[1], patch, ctx);
      // The whole matrix comes back so the client can refresh derived columns
      // (rank, tier counts, reverse unlocks) that an edit here can change elsewhere.
      const matrix = buildProgramMatrix(ctx);
      send(
        res,
        200,
        JSON.stringify({ row, rows: matrix.rows, summary: matrix.summary }),
        "application/json; charset=utf-8",
        noIndex,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, JSON.stringify({ error: message }), "application/json; charset=utf-8", noIndex);
    }
    return true;
  }

  if (pathname === "/api/dev/disaster-windows" && req.method === "GET") {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const statusParam = url.searchParams.get("status") ?? "all";
    const status: DisasterWindowStatus | "all" =
      statusParam === "pending" ||
      statusParam === "active" ||
      statusParam === "expired" ||
      statusParam === "dismissed"
        ? statusParam
        : "all";
    send(
      res,
      200,
      JSON.stringify({
        windows: listWindows(status, 200),
        disaster: buildDisasterStatus(),
      }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  const windowMatch = pathname.match(/^\/api\/dev\/disaster-windows\/(\d+)$/);
  if (windowMatch && req.method === "PATCH") {
    try {
      const body = (await readJsonBody(req)) as {
        status?: string;
        applyPeriods?: Array<{ start?: unknown; end?: unknown }>;
      };
      const id = Number(windowMatch[1]);
      let window = getDisasterWindow(id);
      if (!window) {
        send(
          res,
          404,
          JSON.stringify({ error: "Disaster window not found" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }

      if (body.applyPeriods !== undefined) {
        if (!Array.isArray(body.applyPeriods)) {
          send(
            res,
            400,
            JSON.stringify({ error: "applyPeriods must be an array" }),
            "application/json; charset=utf-8",
            noIndex,
          );
          return true;
        }
        const periods = body.applyPeriods.map((p) => ({
          start: String(p.start ?? ""),
          end: String(p.end ?? ""),
        }));
        const valid = periods.every(
          (p) =>
            /^\d{4}-\d{2}-\d{2}$/.test(p.start) &&
            /^\d{4}-\d{2}-\d{2}$/.test(p.end) &&
            p.end >= p.start,
        );
        if (!valid) {
          send(
            res,
            400,
            JSON.stringify({
              error: "Each applyPeriod needs YYYY-MM-DD start and end, end >= start",
            }),
            "application/json; charset=utf-8",
            noIndex,
          );
          return true;
        }
        window = updateWindowPeriods(id, periods) ?? window;
      }

      if (body.status !== undefined) {
        const allowed: DisasterWindowStatus[] = [
          "pending",
          "active",
          "expired",
          "dismissed",
        ];
        if (!allowed.includes(body.status as DisasterWindowStatus)) {
          send(
            res,
            400,
            JSON.stringify({ error: "status must be pending|active|expired|dismissed" }),
            "application/json; charset=utf-8",
            noIndex,
          );
          return true;
        }
        // Activating with no dates would publish a card nobody can act on.
        if (
          body.status === "active" &&
          (window?.applyPeriods.length ?? 0) === 0
        ) {
          send(
            res,
            400,
            JSON.stringify({
              error: "Cannot activate a window with no application period dates",
            }),
            "application/json; charset=utf-8",
            noIndex,
          );
          return true;
        }
        // Record that a person overrode the automated decision, so the audit
        // view does not read as though the scan published this.
        window =
          setWindowStatus(id, body.status as DisasterWindowStatus, "manual") ??
          window;
      }

      send(res, 200, JSON.stringify({ window }), "application/json; charset=utf-8", noIndex);
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
  const requestedId =
    sanitizeStartPayload(decodeURIComponent(campaignIdRaw)) ?? "link_share";
  const campaign = getCampaign(requestedId);
  // Prefer the partner's canonical campaign id (e.g. qr_p_…) when an older
  // hyphenated QR (qr-p-…) still resolves to that partner.
  const campaignId = campaign?.id ?? requestedId;
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
  // #region agent log
  console.log(
    `[agent-debug] B server.ts:handleGo redirect campaign=${campaignId} bot=${username}`,
  );
  // #endregion
  redirect(res, `https://t.me/${username}?start=${encodeURIComponent(campaignId)}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Phone → computer handoff page.
 * Auto-opens Mail with a download link (phones can't attach PDFs to mailto:).
 * Telegram URL buttons only allow http(s), so this page is the mailto bridge.
 */
function handleReportSharePage(
  res: http.ServerResponse,
  token: string,
  config: AppConfig,
): void {
  const pdf = getReportPdf(token);
  if (!pdf) {
    send(
      res,
      404,
      "This report link expired. In Telegram, tap Email report to my computer again.",
      "text/plain; charset=utf-8",
    );
    return;
  }
  const pdfUrl = reportDownloadUrl(config.publicBaseUrl, token);
  const mailHref = mailtoWithReportLink(pdfUrl);
  const safeMail = escapeHtml(mailHref);
  const safePdf = escapeHtml(pdfUrl);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=${safeMail}" />
  <title>Email your CalClaim report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; color: #122; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
    p { color: #333; margin: 0 0 1rem; }
    a.btn { display: block; text-align: center; text-decoration: none; padding: 0.85rem 1rem; border-radius: 0.5rem; font-weight: 600; margin: 0.5rem 0; }
    a.primary { background: #0b5c2e; color: #fff; }
    a.secondary { background: #e8f0eb; color: #0b5c2e; }
    .note { font-size: 0.9rem; color: #555; }
  </style>
  <script>
    window.location.href = ${JSON.stringify(mailHref)};
  </script>
</head>
<body>
  <h1>Opening your email app…</h1>
  <p>Send the email to yourself, then open the download link on your laptop.</p>
  <a class="btn primary" href="${safeMail}">Open email app with link</a>
  <a class="btn secondary" href="${safePdf}">Download PDF on this phone</a>
  <p class="note">Link works for 7 days. If Mail didn’t open, tap the green button.</p>
</body>
</html>`;
  send(res, 200, html, "text/html; charset=utf-8", {
    "Cache-Control": "no-store",
  });
}

function handleReportDownload(
  res: http.ServerResponse,
  token: string,
): void {
  const pdf = getReportPdf(token);
  if (!pdf) {
    send(
      res,
      404,
      "This report link expired. In Telegram, tap Email report to my computer again.",
      "text/plain; charset=utf-8",
    );
    return;
  }
  send(res, 200, pdf, "application/pdf", {
    "Content-Disposition": 'attachment; filename="calclaim-todo-list.pdf"',
    "Cache-Control": "no-store",
  });
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

      if (pathname === "/llms.txt" || pathname === "/.well-known/llms.txt") {
        serveStatic(res, "/llms.txt");
        return;
      }

      if (pathname === "/api/stats") {
        send(res, 200, JSON.stringify(buildImpactStats()), "application/json; charset=utf-8");
        return;
      }

      if (pathname === "/api/partners") {
        send(
          res,
          200,
          JSON.stringify({
            generatedAt: new Date().toISOString(),
            statsSource: impactStatsMode(),
            partners: buildPartnerLeaderboard(),
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (pathname === "/api/partners/signup" && req.method === "POST") {
        try {
          const contentType = String(req.headers["content-type"] || "");
          let name = "";
          let email = "";
          let city = "";
          let logo: { buffer: Buffer; mime: string; filename: string } | undefined;

          if (contentType.includes("multipart/form-data")) {
            const multi = await readPartnerSignupMultipart(req);
            name = multi.name;
            email = multi.email;
            city = multi.city;
            logo = multi.logo;
          } else {
            const body = (await readJsonBody(req, 16_384)) as {
              name?: unknown;
              email?: unknown;
              city?: unknown;
            };
            name = typeof body.name === "string" ? body.name : "";
            email = typeof body.email === "string" ? body.email : "";
            city = typeof body.city === "string" ? body.city : "";
          }

          const parsed = parsePartnerSignup({ name, email, city });
          if ("error" in parsed) {
            send(
              res,
              400,
              JSON.stringify({ error: parsed.error }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const result = await registerPartnerSignup(config, {
            ...parsed,
            logo,
          });
          send(
            res,
            200,
            JSON.stringify({
              ok: true,
              partnerId: result.partner.id,
              slug: result.partner.slug,
              name: result.partner.name,
              email: result.partner.email,
              city: result.partner.city,
              logo: result.partner.logo || "",
              statusUrl: result.statusUrl,
              qrUrl: result.qrUrl,
              bannerUrl: result.bannerUrl,
              editToken: result.editToken,
              emailMode: result.email.mode,
            }),
            "application/json; charset=utf-8",
          );
        } catch (err) {
          const code = err instanceof Error ? err.message : "";
          if (
            code === "logo_type" ||
            code === "logo_too_large" ||
            code === "body_too_large" ||
            code === "multipart_boundary"
          ) {
            send(
              res,
              400,
              JSON.stringify({ error: code }),
              "application/json; charset=utf-8",
            );
            return;
          }
          console.error("Partner signup failed:", err);
          send(
            res,
            500,
            JSON.stringify({ error: "signup_failed" }),
            "application/json; charset=utf-8",
          );
        }
        return;
      }

      if (pathname.startsWith("/api/partners/")) {
        const rest = pathname.slice("/api/partners/".length);
        const parts = rest.split("/").filter(Boolean);
        const slug = decodeURIComponent(parts[0] ?? "");
        if (parts[1] === "banner") {
          if (req.method !== "GET") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          const partner = getPartnerBySlug(slug);
          if (!partner) {
            send(res, 404, "Partner not found", "text/plain; charset=utf-8");
            return;
          }
          const target = campaignLandingUrl(config.publicBaseUrl, partner.campaignId);
          const pdf = await renderPartnerBoothBannerPdf({
            partnerName: partner.name,
            partnerId: partner.id,
            qrTargetUrl: target,
            partnerLogoPath: partner.logo || null,
          });
          const safeName = partner.slug.replace(/[^a-z0-9_-]+/gi, "-");
          send(res, 200, pdf, "application/pdf", {
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": `attachment; filename="calclaim-booth-banner-${safeName}.pdf"`,
          });
          return;
        }
        if (parts[1] === "profile") {
          if (req.method !== "PATCH" && req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const asDeveloper = isDeveloperAuthed(
              req,
              config.developerSessionSecret,
            );
            const contentType = String(req.headers["content-type"] || "");
            let name = "";
            let email = "";
            let city = "";
            let partnerId = "";
            let editToken = "";
            let logo: { buffer: Buffer; mime: string; filename: string } | undefined;

            if (contentType.includes("multipart/form-data")) {
              const multi = await readPartnerSignupMultipart(req);
              name = multi.name;
              email = multi.email;
              city = multi.city;
              partnerId = multi.partnerId;
              editToken = multi.editToken;
              logo = multi.logo;
            } else {
              const body = (await readJsonBody(req, 16_384)) as {
                name?: unknown;
                email?: unknown;
                city?: unknown;
                partnerId?: unknown;
                editToken?: unknown;
              };
              name = typeof body.name === "string" ? body.name : "";
              email = typeof body.email === "string" ? body.email : "";
              city = typeof body.city === "string" ? body.city : "";
              partnerId =
                typeof body.partnerId === "string" ? body.partnerId : "";
              editToken =
                typeof body.editToken === "string" ? body.editToken : "";
            }

            const parsed = asDeveloper
              ? parsePartnerSignup({ name, email, city })
              : parsePartnerProfileUpdate({
                  name,
                  email,
                  city,
                  partnerId,
                });
            if ("error" in parsed) {
              send(
                res,
                400,
                JSON.stringify({ error: parsed.error }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const result = await updatePartnerProfile(slug, {
              name: parsed.name,
              email: parsed.email,
              city: parsed.city,
              partnerId: asDeveloper ? undefined : partnerId,
              editToken,
              asDeveloper,
              editTokenSecret: config.developerSessionSecret,
              logo,
            });
            if ("error" in result) {
              const status =
                result.error === "not_found"
                  ? 404
                  : result.error === "partner_id_mismatch" ||
                      result.error === "edit_expired"
                    ? 403
                    : 400;
              send(
                res,
                status,
                JSON.stringify({ error: result.error }),
                "application/json; charset=utf-8",
              );
              return;
            }
            send(
              res,
              200,
              JSON.stringify({
                ok: true,
                partnerId: result.partner.id,
                slug: result.partner.slug,
                name: result.partner.name,
                city: result.partner.city,
                email: result.partner.email,
                logo: result.partner.logo || "",
                bannerUrl: result.bannerUrl,
                qrUrl: `/api/qr/partner/${encodeURIComponent(result.partner.slug)}`,
              }),
              "application/json; charset=utf-8",
            );
          } catch (err) {
            const code = err instanceof Error ? err.message : "";
            if (
              code === "logo_type" ||
              code === "logo_too_large" ||
              code === "body_too_large" ||
              code === "multipart_boundary"
            ) {
              send(
                res,
                400,
                JSON.stringify({ error: code }),
                "application/json; charset=utf-8",
              );
              return;
            }
            console.error("Partner profile update failed:", err);
            send(
              res,
              500,
              JSON.stringify({ error: "update_failed" }),
              "application/json; charset=utf-8",
            );
          }
          return;
        }
        if (parts.length !== 1 || req.method !== "GET") {
          send(
            res,
            req.method === "GET" ? 404 : 405,
            req.method === "GET" ? "Not found" : "Method not allowed",
            "text/plain; charset=utf-8",
          );
          return;
        }
        const stats = buildPartnerStats(slug);
        if (!stats) {
          send(
            res,
            404,
            JSON.stringify({ error: "Partner not found" }),
            "application/json; charset=utf-8",
          );
          return;
        }
        send(res, 200, JSON.stringify(stats), "application/json; charset=utf-8");
        return;
      }

      if (pathname === "/api/contact" && req.method === "POST") {
        try {
          const body = (await readJsonBody(req, 16_384)) as {
            email?: unknown;
            comments?: unknown;
          };
          const saved = appendContactMessage(body);
          if (!saved) {
            send(
              res,
              400,
              JSON.stringify({ error: "empty" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
        } catch {
          send(
            res,
            400,
            JSON.stringify({ error: "bad_request" }),
            "application/json; charset=utf-8",
          );
        }
        return;
      }

      if (pathname === "/api/qr/try") {
        const target = campaignLandingUrl(config.publicBaseUrl, "qr_website");
        const png = await renderShareQrPng(target);
        send(res, 200, png, "image/png", {
          "Cache-Control": "public, max-age=3600",
        });
        return;
      }

      if (pathname.startsWith("/api/qr/partner/")) {
        const slug = decodeURIComponent(
          pathname.slice("/api/qr/partner/".length).split("/")[0] ?? "",
        );
        const partner = getPartnerBySlug(slug);
        if (!partner) {
          send(res, 404, "Partner not found", "text/plain; charset=utf-8");
          return;
        }
        const target = campaignLandingUrl(config.publicBaseUrl, partner.campaignId);
        const png = await renderShareQrPng(target);
        send(res, 200, png, "image/png", {
          "Cache-Control": "public, max-age=3600",
        });
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

      // Temporary to-do PDF links for "email to my computer"
      if (pathname.startsWith("/report/")) {
        const parts = pathname.slice("/report/".length).split("/").filter(Boolean);
        const token = (parts[0] ?? "").replace(/[^a-f0-9]/gi, "");
        if (!token || token.length < 16) {
          send(res, 404, "Not found", "text/plain; charset=utf-8");
          return;
        }
        if (parts[1] === "share") {
          handleReportSharePage(res, token, config);
          return;
        }
        if (!parts[1]) {
          handleReportDownload(res, token);
          return;
        }
        send(res, 404, "Not found", "text/plain; charset=utf-8");
        return;
      }

      // Localized public URLs: /es/impact, /zh/privacy, etc.
      // Developer login + /dev stay English-only (no alt-language pages).
      const localized = stripPublicLangPrefix(pathname);
      if (localized.lang) {
        if (localized.path === "/dev" || localized.path.startsWith("/dev/")) {
          redirect(res, localized.path === "/dev/" ? "/dev" : localized.path);
          return;
        }
        const publicPath =
          localized.path === "/" ? "/impact" : localized.path;
        if (publicPath === "/about" || publicPath.startsWith("/about/")) {
          redirect(res, `/${localized.lang}/impact#about`);
          return;
        }
        if (publicPath === "/privacy" || publicPath.startsWith("/privacy/")) {
          redirect(res, `/${localized.lang}/impact#privacy`);
          return;
        }
        if (publicPath === "/contact" || publicPath.startsWith("/contact/")) {
          redirect(res, `/${localized.lang}/impact#contact`);
          return;
        }
        if (publicPath === "/impact" || publicPath.startsWith("/impact/")) {
          serveStatic(res, publicPath);
          return;
        }
        if (publicPath === "/partners" || publicPath.startsWith("/partners/")) {
          if (publicPath === "/partners" || publicPath === "/partners/") {
            redirect(res, `/${localized.lang}/impact#partners`);
            return;
          }
          if (/\.(css|js|map|svg|png|ico)$/i.test(publicPath)) {
            serveStatic(res, publicPath);
            return;
          }
          if (
            publicPath === "/partners/signup" ||
            publicPath === "/partners/signup/"
          ) {
            serveStatic(res, "/partners/signup");
            return;
          }
          const slug = publicPath
            .slice("/partners/".length)
            .replace(/\/$/, "")
            .split("/")[0] ?? "";
          if (RESERVED_PARTNER_SLUGS.has(slug) || !getPartnerBySlug(slug)) {
            send(res, 404, "Not found", "text/plain; charset=utf-8");
            return;
          }
          serveStatic(res, `/partners/${slug}`);
          return;
        }
        send(res, 404, "Not found", "text/plain; charset=utf-8");
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

      if (pathname === "/about" || pathname.startsWith("/about/")) {
        redirect(res, "/impact#about");
        return;
      }
      if (pathname === "/privacy" || pathname.startsWith("/privacy/")) {
        redirect(res, "/impact#privacy");
        return;
      }
      if (pathname === "/contact" || pathname.startsWith("/contact/")) {
        redirect(res, "/impact#contact");
        return;
      }

      if (pathname === "/partners" || pathname === "/partners/") {
        redirect(res, "/impact#partners");
        return;
      }
      if (pathname.startsWith("/partners/")) {
        // Static assets: /partners/styles.css, /partners/app.js, /partners/signup/*
        if (/\.(css|js|map|svg|png|ico)$/i.test(pathname)) {
          serveStatic(res, pathname);
          return;
        }
        if (pathname === "/partners/signup" || pathname === "/partners/signup/") {
          serveStatic(res, "/partners/signup");
          return;
        }
        const slug = pathname.slice("/partners/".length).replace(/\/$/, "").split("/")[0] ?? "";
        if (RESERVED_PARTNER_SLUGS.has(slug) || !getPartnerBySlug(slug)) {
          send(res, 404, "Not found", "text/plain; charset=utf-8");
          return;
        }
        serveStatic(res, `/partners/${slug}`);
        return;
      }

      if (
        pathname === "/" ||
        pathname === "/impact" ||
        pathname.startsWith("/impact/") ||
        pathname.startsWith("/brand/") ||
        pathname.startsWith("/i18n/")
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
    console.log(`  Partner leaderboard: ${config.publicBaseUrl}/impact#partners`);
    console.log(`  Partner signup: ${config.publicBaseUrl}/partners/signup`);
    console.log(`  Developer (password + CAPTCHA): ${config.publicBaseUrl}/dev`);
    console.log(`  Sample QR landing: ${config.publicBaseUrl}/go/qr_oakland_library`);
    if (!config.developerPassword) {
      console.warn("  DEVELOPER_PASSWORD is unset — developer login will fail until set.");
    }
  });
  return server;
}
