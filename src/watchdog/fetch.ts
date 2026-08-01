import type { LinkCheckResult, PageFetchResult } from "./types.js";

const UA =
  "CalClaimCorpusWatcher/1.0 (+https://github.com/local/calclaim; developer corpus freshness checks; not a bot for users)";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 24_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLink(url: string): Promise<LinkCheckResult> {
  const started = Date.now();
  try {
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method: "HEAD" });
      // Some agency sites reject HEAD
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        res = await fetchWithTimeout(url, { method: "GET" });
      }
    } catch {
      res = await fetchWithTimeout(url, { method: "GET" });
    }

    const finalUrl = res.url || url;
    const redirected = normalizeUrl(finalUrl) !== normalizeUrl(url);
    const ok = res.status >= 200 && res.status < 400;
    return {
      url,
      ok,
      status: res.status,
      finalUrl,
      redirected,
      error: ok ? null : `HTTP ${res.status}`,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      finalUrl: null,
      redirected: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

export async function fetchPageText(url: string): Promise<PageFetchResult> {
  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    const finalUrl = res.url || url;
    if (!res.ok) {
      return {
        url,
        ok: false,
        status: res.status,
        finalUrl,
        text: "",
        error: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    const text = stripHtml(html).slice(0, MAX_TEXT_CHARS);
    return {
      url,
      ok: true,
      status: res.status,
      finalUrl,
      text,
      error: null,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      finalUrl: null,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Compare URLs ignoring trailing slash / common tracking noise. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Drop common tracking params
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    u.pathname = path;
    return u.toString().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
