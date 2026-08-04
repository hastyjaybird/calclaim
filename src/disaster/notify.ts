import type { Bot } from "grammy";
import type { DisasterScanSource, DisasterWindow } from "./db.js";
import { formatApplyPeriods, formatCounties, formatIncidentRange } from "./format.js";
import type { Confidence, ValidationResult } from "./validate.js";

/** Chat that receives new-window and staleness alerts. Unset = alerts logged only. */
export function developerChatId(): number | null {
  const raw = process.env.DEVELOPER_TELEGRAM_CHAT_ID?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function windowFacts(window: DisasterWindow): string[] {
  const lines: string[] = [window.label];
  const counties = formatCounties(window.counties);
  if (counties) lines.push(`Counties: ${counties}`);
  if (window.zips?.length) lines.push(`ZIPs: ${window.zips.length} listed`);
  if (window.applyPeriods.length) {
    lines.push(`Apply: ${formatApplyPeriods(window.applyPeriods)}`);
  }
  const incident = formatIncidentRange(window.incidentBegin, window.incidentEnd);
  if (incident) lines.push(`Incident: ${incident}`);
  if (window.applyPhone) lines.push(`Phone: ${window.applyPhone}`);
  if (window.applyUrl) lines.push(`URL: ${window.applyUrl}`);
  if (window.notes) lines.push(`Notes: ${window.notes}`);
  if (window.sourceUrl) lines.push(`Source: ${window.sourceUrl}`);
  return lines;
}

/**
 * Sent after the card is already live. This is a receipt, not a request: the
 * checks passed and the window published without waiting on anyone.
 */
export function formatAutoPublishAlert(
  window: DisasterWindow,
  validation: ValidationResult,
  publicBaseUrl: string,
): string {
  return [
    "Disaster CalFresh is now LIVE in the bot — published automatically.",
    "",
    ...windowFacts(window),
    "",
    `Corroboration: ${describeConfidence(validation.confidence)}`,
    ...validation.checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`),
    "",
    `Audit or turn it off: ${publicBaseUrl}/dev`,
  ].join("\n");
}

/**
 * Sent when the checks did not pass, so nothing was published. Something about
 * the source data or its extraction looks wrong.
 */
export function formatHeldWindowAlert(
  window: DisasterWindow,
  validation: ValidationResult,
  publicBaseUrl: string,
): string {
  return [
    "Disaster CalFresh window found but NOT published — the data failed a sanity check.",
    "",
    ...windowFacts(window),
    "",
    `Failed: ${validation.failed.join(", ")}`,
    ...validation.checks
      .filter((c) => !c.ok)
      .map((c) => `  ✗ ${c.id}: ${c.detail}`),
    "",
    "The card stays hidden until the sources agree, or you publish it by hand.",
    `Review: ${publicBaseUrl}/dev`,
  ].join("\n");
}

function describeConfidence(confidence: Confidence): string {
  switch (confidence) {
    case "corroborated":
      return "FNS and CDSS agree on the dates, FEMA declaration matched";
    case "fns_only":
      return "FEMA declaration matched; CDSS has not published dates yet";
    case "fns_unverified":
      return "FNS only — FEMA was unreachable, declaration taken from the FNS notice";
  }
}

export function formatStalenessAlert(
  source: DisasterScanSource,
  days: number | null,
): string {
  const who =
    source === "fema"
      ? "FEMA declarations"
      : source === "fns"
        ? "FNS D-SNAP approvals"
        : "CDSS Disaster CalFresh";
  const age = days == null ? "never succeeded" : `last succeeded ${days} days ago`;
  const stakes =
    source === "fns"
      ? "This is the source that decides whether the card goes live, so while it is broken no window can publish."
      : "While this is broken, an open D-CalFresh window would look identical to no disaster at all.";
  return [`Disaster scan warning: ${who} ${age}.`, "", stakes].join("\n");
}

export async function sendDeveloperAlert(
  bot: Bot,
  text: string,
): Promise<void> {
  const chatId = developerChatId();
  if (chatId == null) {
    console.warn(`[disaster] alert (no DEVELOPER_TELEGRAM_CHAT_ID set):\n${text}`);
    return;
  }
  try {
    await bot.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
  } catch (err) {
    console.error("[disaster] developer alert failed:", err);
  }
}
