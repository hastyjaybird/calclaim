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
  toPublicImpactStats,
  buildPartnerLeaderboard,
  impactStatsMode,
  buildPartnerStats,
  buildPartnerEventLeaderboard,
  buildPartnerEventStats,
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
import { resolveApplyUrlForTerritory } from "../library/utilityTerritory.js";
import { simulateTreeReview } from "../dev/treeReview.js";
import {
  buildTreeChart,
  saveProgramBranchOrder,
  type ChartBranch,
} from "../dev/treeChart.js";
import { buildUtilityTree } from "../dev/utilityTree.js";
import { renderShareQrPng } from "../bot/share.js";
import {
  getReportPdf,
  mailtoWithReportLink,
  reportDownloadUrl,
} from "../nextsteps/reportLinks.js";
import {
  ingestPartnerLandingFeedback,
  insertTreeFeedbackTodo,
  listFeedbackTodos,
  setFeedbackTodoStatus,
  setFeedbackTodoTicketed,
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
import {
  getSignedUpPartnerById,
  getSignedUpPartnerBySlug,
  listSignedUpPartners,
  RESERVED_PARTNER_SLUGS,
} from "../partners/db.js";
import { buildPartnerWebsiteExportZip } from "../partners/export.js";
import {
  createPartnerEvent,
  getPartnerEventBySlug,
} from "../partners/events.js";
import {
  issuePartnerOwnerToken,
  verifyPartnerEditToken,
  verifyPartnerOwnerToken,
} from "../partners/editToken.js";
import {
  confirmPartnerLogin,
  requestPartnerLogin,
} from "../partners/login.js";
import { readPartnerSignupMultipart } from "../partners/logoUpload.js";
import {
  cancelPartnerAccountByToken,
  deletePartnerAccount,
  parsePartnerProfileUpdate,
  parsePartnerSignup,
  registerPartnerSignup,
  updatePartnerProfile,
} from "../partners/signup.js";
import { partnerHasPrivateDashboard } from "../partners/accountKind.js";
import { verifyPartnerEmail } from "../partners/verify.js";
import {
  clearLoginFailures,
  consumeCaptchaQuota,
  createCaptchaChallenge,
  createSession,
  DEVELOPER_ACCESS_POLICY,
  destroySession,
  isDeveloperAuthed,
  loginLockStatus,
  readJsonBody,
  recordLoginFailure,
  sessionClearCookieHeaders,
  sessionSetCookieHeaders,
  verifyCaptcha,
  verifyDeveloperPassword,
} from "./devAuth.js";
import { handleDonateRequest } from "../donate/http.js";

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

function requestIp(req: http.IncomingMessage): string {
  return (
    clientIp(
      {
        get: (n) => {
          const v = req.headers[n];
          return Array.isArray(v) ? v[0] : v;
        },
      },
      req.socket.remoteAddress,
    ) ?? "unknown"
  );
}

function sendRateLimited(
  res: http.ServerResponse,
  retryAfterSec: number,
  extraHeaders?: Record<string, string | string[]>,
): void {
  send(
    res,
    429,
    JSON.stringify({
      error: "Too many attempts. Try again in a few minutes.",
    }),
    "application/json; charset=utf-8",
    {
      ...extraHeaders,
      "Retry-After": String(retryAfterSec),
    },
  );
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

function readPartnerOwnerToken(
  req: http.IncomingMessage,
  body?: { ownerToken?: unknown },
): string {
  const header = req.headers["x-partner-owner"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim();
  if (typeof body?.ownerToken === "string") return body.ownerToken.trim();
  return "";
}

function partnerOwnerAuthorized(
  secret: string,
  partnerId: string,
  slug: string,
  token: string,
): boolean {
  if (!token) return false;
  return (
    verifyPartnerOwnerToken(secret, partnerId, slug, token) ||
    verifyPartnerEditToken(secret, partnerId, slug, token)
  );
}

/** Public pages may be served under /es|zh|vi|tl/... ; developer pages are English-only. */
type PublicLang = "es" | "zh" | "vi" | "tl";

function stripPublicLangPrefix(urlPath: string): { lang: PublicLang | null; path: string } {
  const m = urlPath.match(/^\/(es|zh|vi|tl)(?=\/|$)/);
  if (!m) return { lang: null, path: urlPath };
  const rest = urlPath.slice(m[0].length) || "/";
  return { lang: m[1] as PublicLang, path: rest };
}

function serveStatic(
  res: http.ServerResponse,
  urlPath: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  let rel = urlPath;
  if (rel === "/" || rel === "/impact" || rel === "/impact/") rel = "/impact/index.html";
  if (rel === "/dev" || rel === "/dev/") rel = "/dev/index.html";
  if (rel === "/dev/tree" || rel === "/dev/tree/") rel = "/dev/tree/index.html";
  if (rel === "/dev/tree/chart" || rel === "/dev/tree/chart/") {
    rel = "/dev/tree/chart/index.html";
  }
  if (rel === "/dev/tree/flowchart" || rel === "/dev/tree/flowchart/") {
    redirect(res, "/dev", extraHeaders);
    return;
  }
  if (rel === "/dev/tree/utilities" || rel === "/dev/tree/utilities/") {
    rel = "/dev/tree/utilities/index.html";
  }
  // Partner deck: /partners/:slug (public) and /partners/:slug/org (private)
  // Signup / verify / cancel forms live under /partners/
  if (rel === "/partners/signup" || rel === "/partners/signup/") {
    rel = "/partners/signup/index.html";
  } else if (rel === "/partners/verify" || rel === "/partners/verify/") {
    rel = "/partners/verify/index.html";
  } else if (rel === "/partners/cancel" || rel === "/partners/cancel/") {
    rel = "/partners/cancel/index.html";
  } else if (rel === "/partners" || rel === "/partners/") {
    rel = "/partners/index.html";
  } else if (
    /^\/partners\/[A-Za-z0-9_-]+(\/org)?(\/events\/[A-Za-z0-9_-]+)?\/?$/.test(
      rel,
    )
  ) {
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
    const quota = consumeCaptchaQuota(requestIp(req));
    if (!quota.ok) {
      sendRateLimited(res, quota.retryAfterSec, noIndex);
      return true;
    }
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
    const ip = requestIp(req);
    const lock = loginLockStatus(ip);
    if (lock.locked) {
      sendRateLimited(res, lock.retryAfterSec, noIndex);
      return true;
    }
    try {
      const body = (await readJsonBody(req)) as {
        password?: string;
        captchaId?: string;
        captchaAnswer?: string;
        humanAttestation?: boolean;
      };

      if (body.humanAttestation !== true) {
        const fail = recordLoginFailure(ip);
        if (fail.locked) {
          sendRateLimited(res, fail.retryAfterSec, noIndex);
          return true;
        }
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
        const fail = recordLoginFailure(ip);
        if (fail.locked) {
          sendRateLimited(res, fail.retryAfterSec, noIndex);
          return true;
        }
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
        const fail = recordLoginFailure(ip);
        if (fail.locked) {
          sendRateLimited(res, fail.retryAfterSec, noIndex);
          return true;
        }
        send(
          res,
          401,
          JSON.stringify({ error: "Invalid password." }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }

      clearLoginFailures(ip);
      const session = createSession(config.developerSessionSecret);
      send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8", {
        ...noIndex,
        "Set-Cookie": sessionSetCookieHeaders(
          session.token,
          session.sig,
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

  if (pathname === "/api/dev/logout" && req.method === "POST") {
    destroySession(req);
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8", {
      ...noIndex,
      "Set-Cookie": sessionClearCookieHeaders(secure),
    });
    return true;
  }

  if (pathname === "/api/dev/session" && req.method === "GET") {
    const ok =
      !config.developerAuthRequired ||
      isDeveloperAuthed(req, config.developerSessionSecret);
    send(
      res,
      200,
      JSON.stringify({ authenticated: ok }),
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
  if (!config.developerAuthRequired) return true;
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

  // Always live collected events – never the public-site demo dataset.
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
          canceledAt: p.canceledAt,
          accountType: p.accountType,
          emailDomain: p.emailDomain,
          emailVerified: Boolean(p.emailVerifiedAt),
          emailVerifiedAt: p.emailVerifiedAt,
          status: p.canceledAt
            ? "canceled"
            : p.emailVerifiedAt
              ? "active"
              : "pending",
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

  if (pathname === "/api/dev/tree" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(await simulateTreeReview([])),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/tree" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req, 32_768)) as { actions?: unknown };
      const actions = Array.isArray(body.actions)
        ? body.actions.map((a) => String(a))
        : [];
      send(
        res,
        200,
        JSON.stringify(await simulateTreeReview(actions)),
        "application/json; charset=utf-8",
        noIndex,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(
        res,
        400,
        JSON.stringify({ error: message }),
        "application/json; charset=utf-8",
        noIndex,
      );
    }
    return true;
  }

  if (pathname === "/api/dev/tree/chart" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(buildTreeChart()),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/tree/utilities" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify(buildUtilityTree()),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/tree/chart/order" && req.method === "PUT") {
    try {
      const body = (await readJsonBody(req, 32_768)) as {
        branch?: unknown;
        order?: unknown;
      };
      const branch = body.branch === "no" ? "no" : body.branch === "yes" ? "yes" : null;
      if (!branch) throw new Error('branch must be "yes" or "no"');
      if (!Array.isArray(body.order)) throw new Error("order must be an array of program ids");
      const chart = saveProgramBranchOrder(
        branch as ChartBranch,
        body.order.map((id) => String(id)),
      );
      send(res, 200, JSON.stringify(chart), "application/json; charset=utf-8", noIndex);
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
      statusParam === "all" ||
      statusParam === "open" ||
      statusParam === "done" ||
      statusParam === "disqualified"
        ? statusParam
        : "open";
    const sourceParam = url.searchParams.get("source");
    const ticketedParam = url.searchParams.get("ticketed");
    const ticketed =
      ticketedParam === "1" || ticketedParam === "true"
        ? true
        : ticketedParam === "0" || ticketedParam === "false"
          ? false
          : "all";
    const limitRaw = Number(url.searchParams.get("limit") || "200");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), 500)
        : 200;
    const todos = listFeedbackTodos({ status, limit, ticketed }).filter(
      (t) => (sourceParam ? t.source === sourceParam : true),
    );
    send(
      res,
      200,
      JSON.stringify({ todos }),
      "application/json; charset=utf-8",
      noIndex,
    );
    return true;
  }

  if (pathname === "/api/dev/feedback-todos" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req, 16_384)) as {
        text?: unknown;
        actions?: unknown;
        step?: unknown;
        screenTitle?: unknown;
        whyThisScreen?: unknown;
        source?: unknown;
      };
      if (body.source != null && body.source !== "tree") {
        send(
          res,
          400,
          JSON.stringify({ error: "Only source=tree is accepted from this endpoint" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        send(
          res,
          400,
          JSON.stringify({ error: "text is required" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      if (text.length > 4000) {
        send(
          res,
          400,
          JSON.stringify({ error: "text must be 4000 characters or fewer" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      const actions = Array.isArray(body.actions)
        ? body.actions.map((a) => String(a)).slice(0, 200)
        : [];
      const todo = insertTreeFeedbackTodo({
        text,
        actions,
        step: typeof body.step === "string" ? body.step : "tree_review",
        screenTitle:
          typeof body.screenTitle === "string" ? body.screenTitle : "Message tree",
        whyThisScreen:
          typeof body.whyThisScreen === "string" ? body.whyThisScreen : undefined,
      });
      send(res, 201, JSON.stringify({ todo }), "application/json; charset=utf-8", noIndex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 400, JSON.stringify({ error: message }), "application/json; charset=utf-8", noIndex);
    }
    return true;
  }

  const feedbackMatch = pathname.match(/^\/api\/dev\/feedback-todos\/(\d+)$/);
  if (feedbackMatch && req.method === "PATCH") {
    try {
      const body = (await readJsonBody(req)) as {
        status?: string;
        ticketed?: unknown;
      };
      const allowed: FeedbackTodoStatus[] = ["open", "done", "disqualified"];
      const hasStatus =
        typeof body.status === "string" &&
        allowed.includes(body.status as FeedbackTodoStatus);
      const promote = body.ticketed === true;
      if (!hasStatus && !promote) {
        send(
          res,
          400,
          JSON.stringify({
            error: "status must be open|done|disqualified, or set ticketed: true",
          }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      const id = Number(feedbackMatch[1]);
      let todo = promote ? setFeedbackTodoTicketed(id) : null;
      if (promote && !todo) {
        send(
          res,
          404,
          JSON.stringify({ error: "Feedback todo not found" }),
          "application/json; charset=utf-8",
          noIndex,
        );
        return true;
      }
      if (hasStatus) {
        todo = setFeedbackTodoStatus(id, body.status as FeedbackTodoStatus);
      }
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
    `[agent-debug] B server.ts:handleGo bridge campaign=${campaignId} bot=${username}`,
  );
  // #endregion
  // Serve a bridge page instead of a bare t.me 302. Desktop browsers often land
  // on Telegram's "START BOT" interstitial where the button silently fails;
  // tg:// + web.telegram.org?tgaddr bypass that screen.
  send(
    res,
    200,
    telegramOpenBridgeHtml(username, campaignId),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
}

/** HTML handoff: try Telegram app, then Telegram Web with start payload. */
function telegramOpenBridgeHtml(botUsername: string, campaignId: string): string {
  const start = encodeURIComponent(campaignId);
  const tMe = `https://t.me/${botUsername}?start=${start}`;
  const tgApp = `tg://resolve?domain=${botUsername}&start=${start}`;
  const tgAddr = encodeURIComponent(tgApp);
  const webK = `https://web.telegram.org/k/#?tgaddr=${tgAddr}`;
  const webA = `https://web.telegram.org/a/#?tgaddr=${tgAddr}`;
  const safeTMe = escapeHtml(tMe);
  const safeTgApp = escapeHtml(tgApp);
  const safeWebK = escapeHtml(webK);
  const safeBot = escapeHtml(botUsername);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Open CalClaim</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;700&family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #10241f;
      --ink-soft: #3a5550;
      --leaf: #0d7a5f;
      --leaf-deep: #084d3d;
      --paper: #eef4f1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      font-family: Figtree, system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(900px 480px at 10% -10%, rgba(13, 122, 95, 0.18), transparent 55%),
        linear-gradient(180deg, #e2ece8 0%, var(--paper) 50%, #e7f0f3 100%);
    }
    main {
      width: min(26rem, 100%);
      text-align: center;
    }
    h1 {
      margin: 0 0 0.4rem;
      font-family: Fraunces, Georgia, serif;
      font-size: clamp(1.8rem, 5vw, 2.3rem);
      font-weight: 600;
    }
    p { margin: 0 0 1.25rem; color: var(--ink-soft); line-height: 1.45; }
    .actions { display: grid; gap: 0.65rem; }
    a.cta {
      display: block;
      padding: 0.85rem 1.1rem;
      border-radius: 0.65rem;
      background: linear-gradient(135deg, var(--leaf-deep), var(--leaf));
      color: #f7f3ea;
      font-weight: 700;
      text-decoration: none;
    }
    a.cta.secondary {
      background: transparent;
      color: var(--leaf-deep);
      border: 1px solid rgba(8, 77, 61, 0.28);
    }
    .hint { margin-top: 1rem; font-size: 0.9rem; }
    .hint a { color: var(--leaf-deep); }
  </style>
</head>
<body>
  <main>
    <h1>CalClaim</h1>
    <p id="status">Opening Telegram…</p>
    <div class="actions">
      <a class="cta" id="open-app" href="${safeTgApp}">Open Telegram app</a>
      <a class="cta secondary" id="open-web" href="${safeWebK}">Continue in browser</a>
    </div>
    <p class="hint">Stuck? <a href="${safeTMe}">@${safeBot} on t.me</a></p>
  </main>
  <script>
    (function () {
      var tgApp = ${JSON.stringify(tgApp)};
      var webK = ${JSON.stringify(webK)};
      var webA = ${JSON.stringify(webA)};
      var tMe = ${JSON.stringify(tMe)};
      var status = document.getElementById("status");
      var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
      var left = false;
      function markLeft() { left = true; }
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) markLeft();
      });
      window.addEventListener("pagehide", markLeft);
      window.addEventListener("blur", markLeft);

      function go(url) {
        try { window.location.href = url; } catch (e) {}
      }

      if (mobile) {
        go(tgApp);
        setTimeout(function () {
          if (!left) {
            if (status) status.textContent = "If Telegram did not open, tap a button below.";
            go(tMe);
          }
        }, 1400);
      } else {
        // Desktop: skip t.me START BOT interstitial (often unresponsive).
        go(webK);
        setTimeout(function () {
          if (!left) {
            if (status) status.textContent = "If Telegram Web did not open, tap Continue in browser.";
            go(webA);
          }
        }, 1600);
      }
    })();
  </script>
</body>
</html>`;
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
      "This Application Guide link expired. In Telegram, tap Email Application Guide to my computer again.",
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
  <title>Email your CalClaim Application Guide</title>
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
  <a class="btn secondary" href="${safePdf}">Click to download Application Guide</a>
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
      "This Application Guide link expired. In Telegram, tap Email Application Guide to my computer again.",
      "text/plain; charset=utf-8",
    );
    return;
  }
  send(res, 200, pdf, "application/pdf", {
    "Content-Disposition": 'attachment; filename="calclaim-application-guide.pdf"',
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

  const url = new URL(req.url ?? "/", "http://localhost");
  const territory = url.searchParams.get("t");
  const applyUrl = resolveApplyUrlForTerritory(program, territory);

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

  redirect(res, applyUrl);
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

      if (await handleDonateRequest(req, res, config, pathname)) {
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
        send(
          res,
          200,
          JSON.stringify(toPublicImpactStats(buildImpactStats())),
          "application/json; charset=utf-8",
        );
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
          let accountType = "";
          let logo: { buffer: Buffer; mime: string; filename: string } | undefined;

          if (contentType.includes("multipart/form-data")) {
            const multi = await readPartnerSignupMultipart(req);
            name = multi.name;
            email = multi.email;
            city = multi.city;
            accountType = multi.accountType;
            logo = multi.logo;
          } else {
            const body = (await readJsonBody(req, 16_384)) as {
              name?: unknown;
              email?: unknown;
              city?: unknown;
              accountType?: unknown;
            };
            name = typeof body.name === "string" ? body.name : "";
            email = typeof body.email === "string" ? body.email : "";
            city = typeof body.city === "string" ? body.city : "";
            accountType =
              typeof body.accountType === "string" ? body.accountType : "";
          }

          const parsed = parsePartnerSignup({ name, email, city, accountType });
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
              pendingVerification: true,
              partnerId: result.partner.id,
              slug: result.partner.slug,
              name: result.partner.name,
              email: result.partner.email,
              city: result.partner.city,
              logo: result.partner.logo || "",
              accountType: result.partner.accountType,
              emailDomain: result.emailDomain,
              emailMode: result.email.mode,
              verifyUrl: result.verifyUrl || null,
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

      if (pathname === "/api/partners/verify-email" && req.method === "POST") {
        try {
          const body = (await readJsonBody(req, 4_096)) as { token?: unknown };
          const token = typeof body.token === "string" ? body.token.trim() : "";
          if (!token) {
            send(
              res,
              400,
              JSON.stringify({ error: "verify_invalid" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const result = await verifyPartnerEmail(config, token);
          if (!result.ok) {
            send(
              res,
              400,
              JSON.stringify({ error: result.error }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const { kit } = result;
          const hasPrivate = partnerHasPrivateDashboard(kit.partner.accountType);
          send(
            res,
            200,
            JSON.stringify({
              ok: true,
              alreadyVerified: result.alreadyVerified,
              partnerId: kit.partner.id,
              slug: kit.partner.slug,
              name: kit.partner.name,
              email: kit.partner.email,
              city: kit.partner.city,
              logo: kit.partner.logo || "",
              accountType: kit.partner.accountType,
              emailDomain: kit.partner.emailDomain,
              emailVerified: true,
              hasPrivateDashboard: hasPrivate,
              statusUrl: kit.statusUrl,
              qrUrl: kit.qrUrl,
              bannerUrl: kit.bannerUrl,
              cancelUrl: kit.cancelUrl || "",
              editToken: hasPrivate ? kit.editToken : "",
              emailMode: kit.email.mode,
            }),
            "application/json; charset=utf-8",
          );
        } catch (err) {
          console.error("Partner email verify failed:", err);
          send(
            res,
            500,
            JSON.stringify({ error: "verify_failed" }),
            "application/json; charset=utf-8",
          );
        }
        return;
      }

      if (pathname === "/api/partners/cancel" && req.method === "POST") {
        try {
          const body = (await readJsonBody(req, 4_096)) as { token?: unknown };
          const token = typeof body.token === "string" ? body.token.trim() : "";
          if (!token) {
            send(
              res,
              400,
              JSON.stringify({ error: "invalid_token" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const result = cancelPartnerAccountByToken(
            config.developerSessionSecret,
            token,
          );
          if ("error" in result) {
            const status =
              result.error === "not_found"
                ? 404
                : result.error === "not_individual"
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
              alreadyCanceled: result.alreadyCanceled,
              name: result.partner.name,
              slug: result.partner.slug,
              createdAt: result.partner.createdAt,
              canceledAt: result.partner.canceledAt,
            }),
            "application/json; charset=utf-8",
          );
        } catch (err) {
          console.error("Partner cancel failed:", err);
          send(
            res,
            500,
            JSON.stringify({ error: "cancel_failed" }),
            "application/json; charset=utf-8",
          );
        }
        return;
      }

      if (pathname === "/api/partners/login" && req.method === "POST") {
        try {
          const body = (await readJsonBody(req, 4096)) as {
            partnerId?: unknown;
          };
          const partnerId =
            typeof body.partnerId === "string" ? body.partnerId.trim() : "";
          const signed = partnerId
            ? getSignedUpPartnerById(partnerId)
            : undefined;
          if (!signed || signed.canceledAt) {
            send(
              res,
              403,
              JSON.stringify({ error: "unauthorized" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          if (!partnerHasPrivateDashboard(signed.accountType)) {
            send(
              res,
              403,
              JSON.stringify({ error: "no_private_dashboard" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const ownerToken = issuePartnerOwnerToken(
            config.developerSessionSecret,
            signed.id,
            signed.slug,
          );
          send(
            res,
            200,
            JSON.stringify({
              ok: true,
              ownerToken,
              partnerId: signed.id,
              slug: signed.slug,
              emailVerified: Boolean(signed.emailVerifiedAt),
            }),
            "application/json; charset=utf-8",
          );
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

      if (pathname.startsWith("/api/partners/")) {
        const rest = pathname.slice("/api/partners/".length);
        const parts = rest.split("/").filter(Boolean);
        const slug = decodeURIComponent(parts[0] ?? "");
        if (parts[1] === "request-login") {
          if (req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const body = (await readJsonBody(req, 4096)) as { email?: unknown };
            const email = typeof body.email === "string" ? body.email : "";
            const result = await requestPartnerLogin(config, slug, email);
            if (!result.ok) {
              const status =
                result.error === "not_found"
                  ? 404
                  : result.error === "rate_limited"
                    ? 429
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
                mode: result.mode,
                ...(result.loginUrl ? { loginUrl: result.loginUrl } : {}),
              }),
              "application/json; charset=utf-8",
            );
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
        if (parts[1] === "confirm-login") {
          if (req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const body = (await readJsonBody(req, 4096)) as { token?: unknown };
            const token =
              typeof body.token === "string" ? body.token.trim() : "";
            const result = confirmPartnerLogin(config, slug, token);
            if (!result.ok) {
              send(
                res,
                result.error === "not_found" ? 404 : 403,
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
                ownerToken: result.ownerToken,
                partnerId: result.partnerId,
                slug: result.slug,
                email: result.email,
                editable: result.editable,
              }),
              "application/json; charset=utf-8",
            );
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
        if (parts[1] === "login") {
          if (req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const partner = getPartnerBySlug(slug);
            if (!partner) {
              send(
                res,
                404,
                JSON.stringify({ error: "not_found" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const signed = getSignedUpPartnerBySlug(slug);
            const body = (await readJsonBody(req, 4096)) as {
              partnerId?: unknown;
              editToken?: unknown;
              ownerToken?: unknown;
            };
            const partnerId =
              typeof body.partnerId === "string" ? body.partnerId.trim() : "";
            const editToken =
              typeof body.editToken === "string" ? body.editToken.trim() : "";
            const existingOwner = readPartnerOwnerToken(req, body);
            const idOk =
              partnerId &&
              partnerId.toLowerCase() === partner.id.toLowerCase() &&
              Boolean(signed);
            const tokenOk = partnerOwnerAuthorized(
              config.developerSessionSecret,
              partner.id,
              partner.slug,
              editToken || existingOwner,
            );
            if (!idOk && !tokenOk) {
              send(
                res,
                403,
                JSON.stringify({
                  error: partnerId ? "partner_id_mismatch" : "unauthorized",
                }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const ownerToken = issuePartnerOwnerToken(
              config.developerSessionSecret,
              partner.id,
              partner.slug,
            );
            send(
              res,
              200,
              JSON.stringify({
                ok: true,
                ownerToken,
                partnerId: partner.id,
                slug: partner.slug,
                emailVerified: partner.emailVerified,
                editable: Boolean(signed),
              }),
              "application/json; charset=utf-8",
            );
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
        if (parts[1] === "events") {
          const eventSlug = decodeURIComponent(parts[2] ?? "");
          const signed = getSignedUpPartnerBySlug(slug);
          if (!signed) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          if (parts[2] && parts[3] === "banner") {
            if (req.method !== "GET") {
              send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
              return;
            }
            const event = getPartnerEventBySlug(signed.slug, eventSlug);
            if (!event) {
              send(res, 404, "Event not found", "text/plain; charset=utf-8");
              return;
            }
            const partner = getPartnerBySlug(signed.slug);
            const target = campaignLandingUrl(
              config.publicBaseUrl,
              event.campaignId,
            );
            const pdf = await renderPartnerBoothBannerPdf({
              partnerName: partner?.name ?? signed.name,
              qrTargetUrl: target,
              partnerLogoPath: partner?.logo || signed.logo || null,
              eventName: event.name,
            });
            const safeName = event.slug.replace(/[^a-z0-9_-]+/gi, "-");
            send(res, 200, pdf, "application/pdf", {
              "Cache-Control": "private, max-age=300",
              "Content-Disposition": `attachment; filename="calclaim-event-banner-${safeName}.pdf"`,
            });
            return;
          }
          if (!parts[2]) {
            if (req.method === "GET") {
              const token = readPartnerOwnerToken(req);
              if (
                !partnerOwnerAuthorized(
                  config.developerSessionSecret,
                  signed.id,
                  signed.slug,
                  token,
                )
              ) {
                send(
                  res,
                  401,
                  JSON.stringify({ error: "unauthorized" }),
                  "application/json; charset=utf-8",
                );
                return;
              }
              const board = buildPartnerEventLeaderboard(signed.slug);
              send(
                res,
                200,
                JSON.stringify({
                  ok: true,
                  events: board ?? [],
                }),
                "application/json; charset=utf-8",
              );
              return;
            }
            if (req.method === "POST") {
              try {
                const body = (await readJsonBody(req, 8192)) as {
                  name?: unknown;
                  ownerToken?: unknown;
                };
                const token = readPartnerOwnerToken(req, body);
                if (
                  !partnerOwnerAuthorized(
                    config.developerSessionSecret,
                    signed.id,
                    signed.slug,
                    token,
                  )
                ) {
                  send(
                    res,
                    401,
                    JSON.stringify({ error: "unauthorized" }),
                    "application/json; charset=utf-8",
                  );
                  return;
                }
                if (!signed.emailVerifiedAt) {
                  send(
                    res,
                    403,
                    JSON.stringify({ error: "unverified" }),
                    "application/json; charset=utf-8",
                  );
                  return;
                }
                const name = typeof body.name === "string" ? body.name : "";
                const created = createPartnerEvent({
                  partnerId: signed.id,
                  partnerSlug: signed.slug,
                  name,
                });
                if ("error" in created) {
                  send(
                    res,
                    400,
                    JSON.stringify({ error: created.error }),
                    "application/json; charset=utf-8",
                  );
                  return;
                }
                const board = buildPartnerEventLeaderboard(signed.slug);
                send(
                  res,
                  200,
                  JSON.stringify({
                    ok: true,
                    event: created,
                    events: board ?? [],
                    qrUrl: `/api/qr/partner/${encodeURIComponent(signed.slug)}/event/${encodeURIComponent(created.slug)}`,
                    bannerUrl: `/api/partners/${encodeURIComponent(signed.slug)}/events/${encodeURIComponent(created.slug)}/banner`,
                  }),
                  "application/json; charset=utf-8",
                );
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
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          if (req.method !== "GET") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          const token = readPartnerOwnerToken(req);
          if (
            !partnerOwnerAuthorized(
              config.developerSessionSecret,
              signed.id,
              signed.slug,
              token,
            )
          ) {
            send(
              res,
              401,
              JSON.stringify({ error: "unauthorized" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const stats = buildPartnerEventStats(signed.slug, eventSlug);
          if (!stats) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          send(res, 200, JSON.stringify(stats), "application/json; charset=utf-8");
          return;
        }
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
        if (parts[1] === "account") {
          if (req.method !== "GET") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          const signed = getSignedUpPartnerBySlug(slug);
          if (!signed) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const token = readPartnerOwnerToken(req);
          if (
            !partnerOwnerAuthorized(
              config.developerSessionSecret,
              signed.id,
              signed.slug,
              token,
            )
          ) {
            send(
              res,
              401,
              JSON.stringify({ error: "unauthorized" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          send(
            res,
            200,
            JSON.stringify({
              ok: true,
              partnerId: signed.id,
              slug: signed.slug,
              name: signed.name,
              email: signed.email,
              city: signed.city,
              logo: signed.logo || "",
              accountType: signed.accountType,
              emailDomain: signed.emailDomain,
              emailVerified: Boolean(signed.emailVerifiedAt),
            }),
            "application/json; charset=utf-8",
          );
          return;
        }
        if (parts[1] === "export") {
          if (req.method !== "GET") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          const signed = getSignedUpPartnerBySlug(slug);
          if (!signed) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const token = readPartnerOwnerToken(req);
          if (
            !partnerOwnerAuthorized(
              config.developerSessionSecret,
              signed.id,
              signed.slug,
              token,
            )
          ) {
            send(
              res,
              401,
              JSON.stringify({ error: "unauthorized" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const zip = buildPartnerWebsiteExportZip(signed.slug);
          if (!zip) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          const safeName = signed.slug.replace(/[^a-z0-9_-]+/gi, "-");
          send(res, 200, zip, "application/zip", {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="calclaim-${safeName}-website-data.zip"`,
          });
          return;
        }
        if (parts[1] === "feedback") {
          if (req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const partner = getPartnerBySlug(slug);
            if (!partner) {
              send(
                res,
                404,
                JSON.stringify({ error: "Partner not found" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const body = (await readJsonBody(req, 16_384)) as {
              text?: unknown;
              ownerToken?: unknown;
            };
            const ownerAuthToken = readPartnerOwnerToken(req, body);
            if (
              !partnerOwnerAuthorized(
                config.developerSessionSecret,
                partner.id,
                partner.slug,
                ownerAuthToken,
              )
            ) {
              send(
                res,
                401,
                JSON.stringify({ error: "unauthorized" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const text = typeof body.text === "string" ? body.text.trim() : "";
            if (!text) {
              send(
                res,
                400,
                JSON.stringify({ error: "empty" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            if (text.length > 4000) {
              send(
                res,
                400,
                JSON.stringify({ error: "too_long" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const result = await ingestPartnerLandingFeedback({
              partnerSlug: partner.slug,
              campaignId: partner.campaignId,
              text,
            });
            send(
              res,
              200,
              JSON.stringify({
                ok: true,
                pointsCreated: result.tickets.length,
                ticketsCreated: result.tickets.length,
                feedbackMessages: result.feedbackMessages,
                feedbackTickets: result.feedbackTickets,
              }),
              "application/json; charset=utf-8",
            );
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
        if (parts[1] === "profile") {
          if (req.method !== "PATCH" && req.method !== "POST") {
            send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
            return;
          }
          try {
            const asDeveloper =
              !config.developerAuthRequired ||
              isDeveloperAuthed(req, config.developerSessionSecret);
            const existingPartner = getSignedUpPartnerBySlug(slug);
            const contentType = String(req.headers["content-type"] || "");
            let name = "";
            let email = "";
            let city = "";
            let partnerId = "";
            let editToken = "";
            let ownerToken = "";
            let logo: { buffer: Buffer; mime: string; filename: string } | undefined;

            if (contentType.includes("multipart/form-data")) {
              const multi = await readPartnerSignupMultipart(req);
              name = multi.name;
              email = multi.email;
              city = multi.city;
              partnerId = multi.partnerId;
              editToken = multi.editToken;
              ownerToken = multi.ownerToken;
              logo = multi.logo;
            } else {
              const body = (await readJsonBody(req, 16_384)) as {
                name?: unknown;
                email?: unknown;
                city?: unknown;
                partnerId?: unknown;
                editToken?: unknown;
                ownerToken?: unknown;
              };
              name = typeof body.name === "string" ? body.name : "";
              email = typeof body.email === "string" ? body.email : "";
              city = typeof body.city === "string" ? body.city : "";
              partnerId =
                typeof body.partnerId === "string" ? body.partnerId : "";
              editToken =
                typeof body.editToken === "string" ? body.editToken : "";
              ownerToken =
                typeof body.ownerToken === "string" ? body.ownerToken : "";
            }

            const ownerAuthToken = readPartnerOwnerToken(req, { ownerToken });
            const asOwner = Boolean(
              existingPartner &&
                partnerOwnerAuthorized(
                  config.developerSessionSecret,
                  existingPartner.id,
                  existingPartner.slug,
                  ownerAuthToken,
                ),
            );

            const accountType = existingPartner?.accountType ?? "organization";
            const parsed =
              asDeveloper || asOwner
                ? parsePartnerSignup({ name, email, city, accountType })
                : parsePartnerProfileUpdate(
                    { name, email, city, partnerId, accountType },
                    { accountType },
                  );
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
              partnerId: asDeveloper || asOwner ? undefined : partnerId,
              editToken,
              asDeveloper,
              asOwner,
              editTokenSecret: config.developerSessionSecret,
              logo,
              accountType,
              publicBaseUrl: config.publicBaseUrl,
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
                accountType: result.partner.accountType,
                emailDomain: result.partner.emailDomain,
                emailVerified: Boolean(result.partner.emailVerifiedAt),
                pendingVerification: Boolean(result.pendingVerification),
                verifyUrl: result.verifyUrl || null,
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
        if (parts.length === 1 && req.method === "DELETE") {
          const signed = getSignedUpPartnerBySlug(slug);
          if (!signed) {
            send(
              res,
              404,
              JSON.stringify({ error: "not_found" }),
              "application/json; charset=utf-8",
            );
            return;
          }
          try {
            const body = (await readJsonBody(req, 4096)) as {
              ownerToken?: unknown;
              confirm?: unknown;
            };
            const token = readPartnerOwnerToken(req, body);
            if (
              !partnerOwnerAuthorized(
                config.developerSessionSecret,
                signed.id,
                signed.slug,
                token,
              )
            ) {
              send(
                res,
                401,
                JSON.stringify({ error: "unauthorized" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const confirm =
              typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
            if (confirm !== "delete") {
              send(
                res,
                400,
                JSON.stringify({ error: "confirm_required" }),
                "application/json; charset=utf-8",
              );
              return;
            }
            const result = deletePartnerAccount(signed.slug);
            if ("error" in result) {
              const status =
                result.error === "already_canceled" ? 409 : 404;
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
                canceled: true,
                deleted: true,
                slug: signed.slug,
                canceledAt: result.canceledAt,
              }),
              "application/json; charset=utf-8",
            );
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
        const qrParts = pathname
          .slice("/api/qr/partner/".length)
          .split("/")
          .filter(Boolean)
          .map((p) => decodeURIComponent(p));
        const slug = qrParts[0] ?? "";
        const partner = getPartnerBySlug(slug);
        if (!partner) {
          send(res, 404, "Partner not found", "text/plain; charset=utf-8");
          return;
        }
        let campaignId = partner.campaignId;
        if (qrParts[1] === "event" && qrParts[2]) {
          const event = getPartnerEventBySlug(partner.slug, qrParts[2]);
          if (!event) {
            send(res, 404, "Event not found", "text/plain; charset=utf-8");
            return;
          }
          campaignId = event.campaignId;
        } else if (qrParts[1]) {
          send(res, 404, "Not found", "text/plain; charset=utf-8");
          return;
        }
        const target = campaignLandingUrl(config.publicBaseUrl, campaignId);
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

      // Localized public URLs: /es/impact, /zh/privacy, /vi/…, /tl/…, etc.
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
          if (
            publicPath === "/partners/verify" ||
            publicPath === "/partners/verify/"
          ) {
            serveStatic(res, "/partners/verify");
            return;
          }
          if (
            publicPath === "/partners/cancel" ||
            publicPath === "/partners/cancel/"
          ) {
            serveStatic(res, "/partners/cancel");
            return;
          }
          const legacyEvent = publicPath.match(
            /^\/partners\/([A-Za-z0-9_-]+)\/events\/([A-Za-z0-9_-]+)\/?$/,
          );
          if (legacyEvent) {
            redirect(
              res,
              `/${localized.lang}/partners/${legacyEvent[1]}/org/events/${legacyEvent[2]}`,
            );
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
        // When auth is off (DEVELOPER_AUTH=0), skip the login page.
        if (
          !config.developerAuthRequired &&
          (rel === "/dev/login.html" || pathname === "/dev/login.html")
        ) {
          const nextRaw = url.searchParams.get("next") || "/dev";
          const next =
            nextRaw.startsWith("/dev") && !nextRaw.startsWith("//")
              ? nextRaw
              : "/dev";
          redirect(res, next, developerNoIndexHeaders());
          return;
        }
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
        if (pathname === "/partners/verify" || pathname === "/partners/verify/") {
          serveStatic(res, "/partners/verify");
          return;
        }
        if (pathname === "/partners/cancel" || pathname === "/partners/cancel/") {
          serveStatic(res, "/partners/cancel");
          return;
        }
        // Legacy event URLs lived on the public page; private org owns them now.
        const legacyEvent = pathname.match(
          /^\/partners\/([A-Za-z0-9_-]+)\/events\/([A-Za-z0-9_-]+)\/?$/,
        );
        if (legacyEvent) {
          redirect(
            res,
            `/partners/${legacyEvent[1]}/org/events/${legacyEvent[2]}`,
          );
          return;
        }
        const slug =
          pathname.slice("/partners/".length).replace(/\/$/, "").split("/")[0] ??
          "";
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
        pathname.startsWith("/i18n/") ||
        pathname.startsWith("/donate/")
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
  if (!config.developerAuthRequired && config.publicBaseUrl.startsWith("https://")) {
    throw new Error(
      "DEVELOPER_AUTH=0 is blocked when PUBLIC_BASE_URL is https. Remove it from production .env.",
    );
  }
  const handler = createWebHandler(config, telegramWebhook);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(config.port, () => {
    console.log(`CalClaim web listening on :${config.port}`);
    console.log(`  Impact dashboard: ${config.publicBaseUrl}/impact`);
    console.log(`  Partner leaderboard: ${config.publicBaseUrl}/impact#partners`);
    console.log(`  Partner signup: ${config.publicBaseUrl}/partners/signup`);
    console.log(
      config.developerAuthRequired
        ? `  Developer (password + CAPTCHA): ${config.publicBaseUrl}/dev`
        : `  Developer (auth off): ${config.publicBaseUrl}/dev`,
    );
    console.log(`  Sample QR landing: ${config.publicBaseUrl}/go/qr_oakland_library`);
    if (config.developerAuthRequired && !config.developerPassword) {
      console.warn("  DEVELOPER_PASSWORD is unset – developer login will fail until set.");
    }
  });
  return server;
}
