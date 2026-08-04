import crypto from "node:crypto";

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 500;

interface StoredReport {
  pdf: Buffer;
  expiresAt: number;
}

const store = new Map<string, StoredReport>();

function prune(): void {
  const now = Date.now();
  for (const [token, row] of store) {
    if (row.expiresAt <= now) store.delete(token);
  }
  // Soft cap for long-running demos
  if (store.size <= MAX_ENTRIES) return;
  const oldest = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const drop = store.size - MAX_ENTRIES;
  for (let i = 0; i < drop; i++) {
    const key = oldest[i]?.[0];
    if (key) store.delete(key);
  }
}

/** Store PDF and return an opaque token for /report/:token routes. */
export function storeReportPdf(pdf: Buffer): string {
  prune();
  const token = crypto.randomBytes(16).toString("hex");
  store.set(token, { pdf, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function getReportPdf(token: string): Buffer | null {
  const row = store.get(token);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    store.delete(token);
    return null;
  }
  return row.pdf;
}

export function reportDownloadUrl(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/report/${token}`;
}

export function reportSharePageUrl(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/report/${token}/share`;
}

export function mailtoWithReportLink(pdfUrl: string): string {
  const subject = "Your CalClaim To Do List";
  const body = `Open this link on your computer to download your CalClaim report:

${pdfUrl}

(Estimates only — not affiliated with any agency.)`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
