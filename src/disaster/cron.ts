import cron from "node-cron";
import type { Bot } from "grammy";
import { scanCdssWindows, type ExtractedWindow } from "./cdss.js";
import {
  daysSinceSuccess,
  expirePassedWindows,
  getScanState,
  recordScanResult,
  upsertWindow,
  STALE_AFTER_DAYS,
  type DisasterWindow,
  type DisasterWindowDraft,
} from "./db.js";
import {
  eventLabel,
  fetchCaliforniaIaDeclarations,
  recentlyActiveEvents,
  type FemaEvent,
} from "./fema.js";
import { scanFnsDsnap, type FnsDsnapOperation } from "./fns.js";
import { formatCounties, todayYmd } from "./format.js";
import {
  formatAutoPublishAlert,
  formatHeldWindowAlert,
  formatStalenessAlert,
  sendDeveloperAlert,
} from "./notify.js";
import { pickApplyChannel, validateOperation, type ValidationResult } from "./validate.js";

/**
 * Build the stored window from the authoritative FNS operation, filling in the
 * incident dates from FEMA and the apply channel from CDSS.
 */
function toDraft(
  operation: FnsDsnapOperation,
  validation: ValidationResult,
  cdssWindows: ExtractedWindow[],
): DisasterWindowDraft {
  const event = validation.femaEvent;
  const channel = pickApplyChannel(operation, cdssWindows);
  const cdssMatch = cdssWindows.find((w) => w.placeLabels?.length);
  const notes: string[] = [];
  if (operation.countyScopeAmbiguous) {
    notes.push(
      "FNS named several counties in one notice; scope taken from the published ZIP list.",
    );
  }
  if (validation.decision === "hold") {
    notes.push(`Held automatically: ${validation.failed.join(", ")}.`);
  }
  if (!channel.phone && !channel.url) {
    notes.push("No apply phone or URL published yet; card points to the county.");
  }

  const counties = operation.counties.length
    ? operation.counties
    : (event?.counties ?? []);
  const label = event
    ? `${eventLabel(event)}${counties.length ? ` – ${formatCounties(counties)}` : ""}`
    : `Disaster CalFresh – ${formatCounties(counties) || "California"}`;

  return {
    femaDisasterNumber: event?.disasterNumber ?? null,
    incidentType: event?.incidentType ?? null,
    label,
    counties,
    zips: operation.zips,
    placeLabels: cdssMatch?.placeLabels ?? null,
    incidentBegin: event?.incidentBegin ?? null,
    incidentEnd: event?.incidentEnd ?? null,
    applyPeriods: operation.applyPeriods,
    applyPhone: channel.phone,
    applyUrl: channel.url,
    sourceUrl: operation.sourceUrl,
    extractedBy: "fns",
    notes: notes.length ? notes.join(" ") : null,
  };
}

/** Whether this scan failed a different set of checks than the last one. */
function failedChecksChanged(
  previous: { validation: unknown },
  validation: ValidationResult,
): boolean {
  if (!Array.isArray(previous.validation)) return true;
  const before = (previous.validation as Array<{ id?: unknown; ok?: unknown }>)
    .filter((c) => c.ok === false)
    .map((c) => String(c.id))
    .sort();
  return before.join(",") !== [...validation.failed].sort().join(",");
}

export interface DisasterScanSummary {
  today: string;
  femaEvents: number;
  femaActive: number;
  fnsOperations: number;
  published: DisasterWindow[];
  held: Array<{ window: DisasterWindow; validation: ValidationResult }>;
  expired: number;
  errors: string[];
}

/**
 * One pass over all three sources, publishing on its own authority.
 *
 * FNS is the agency that approves D-SNAP and the only source that states the
 * application period, so it drives the decision. FEMA supplies the structured
 * declaration used to corroborate it, and CDSS supplies the apply channel and a
 * second opinion on the dates. A window publishes only when every mechanical
 * check passes; a hold means the extraction looks wrong, not that a person has
 * to approve it.
 */
export async function runDisasterScan(
  bot: Bot | null,
  tz: string,
  publicBaseUrl: string,
): Promise<DisasterScanSummary> {
  const today = todayYmd(tz);
  const errors: string[] = [];
  const expired = expirePassedWindows(today);

  let events: FemaEvent[] = [];
  let femaOk = false;
  try {
    events = await fetchCaliforniaIaDeclarations();
    femaOk = true;
    recordScanResult("fema", { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`FEMA: ${message}`);
    recordScanResult("fema", { ok: false, error: message });
  }

  // CDSS is advisory here: it fills in the phone number and cross-checks dates.
  const previousCdssHash = getScanState("cdss")?.contentHash ?? null;
  const cdss = await scanCdssWindows(previousCdssHash);
  if (!cdss.ok) {
    errors.push(`CDSS: ${cdss.error ?? "unknown error"}`);
    recordScanResult("cdss", { ok: false, error: cdss.error });
  } else {
    if (cdss.partialError) errors.push(`CDSS (partial): ${cdss.partialError}`);
    recordScanResult("cdss", {
      ok: true,
      error: cdss.partialError,
      contentHash: cdss.contentHash,
    });
  }

  const fns = await scanFnsDsnap(today);
  if (!fns.ok) {
    errors.push(`FNS: ${fns.error ?? "unknown error"}`);
    recordScanResult("fns", { ok: false, error: fns.error });
  } else {
    recordScanResult("fns", { ok: true, contentHash: fns.contentHash });
    if (fns.unparsed.length) {
      errors.push(
        `FNS: ${fns.unparsed.length} D-SNAP notice(s) mentioned dates that did not parse`,
      );
    }
  }

  const published: DisasterWindow[] = [];
  const held: Array<{ window: DisasterWindow; validation: ValidationResult }> = [];

  for (const operation of fns.operations) {
    const validation = validateOperation({
      operation,
      femaEvents: events,
      femaOk,
      cdssWindows: cdss.windows,
      todayYmd: today,
    });
    const draft = toDraft(operation, validation, cdss.windows);
    const publish = validation.decision === "publish";
    const result = upsertWindow(draft, {
      initialStatus: publish ? "active" : "pending",
      decision: publish ? "auto_published" : "auto_held",
      confidence: validation.confidence,
      validation: validation.checks,
      promoteToActive: publish,
    });

    if (result.published) {
      published.push(result.window);
      if (bot) {
        await sendDeveloperAlert(
          bot,
          formatAutoPublishAlert(result.window, validation, publicBaseUrl),
        );
      }
    } else if (!publish && result.window.status === "pending") {
      held.push({ window: result.window, validation });
      // A window can stay held for days. Report it when it first fails, or when
      // it starts failing something different – not once a day forever.
      const changed =
        result.previous == null ||
        result.previous.status !== "pending" ||
        failedChecksChanged(result.previous, validation);
      if (changed && bot) {
        await sendDeveloperAlert(
          bot,
          formatHeldWindowAlert(result.window, validation, publicBaseUrl),
        );
      }
    }
  }

  if (bot) {
    for (const source of ["fema", "cdss", "fns"] as const) {
      const state = getScanState(source);
      if (!state?.lastError) continue;
      const days = daysSinceSuccess(source);
      if (days == null || days >= STALE_AFTER_DAYS[source]) {
        await sendDeveloperAlert(bot, formatStalenessAlert(source, days));
      }
    }
  }

  const summary: DisasterScanSummary = {
    today,
    femaEvents: events.length,
    femaActive: recentlyActiveEvents(events, today).length,
    fnsOperations: fns.operations.length,
    published,
    held,
    expired,
    errors,
  };
  console.log(
    `[disaster] scan ${today}: ${summary.femaEvents} CA IA declarations ` +
      `(${summary.femaActive} recent), ${summary.fnsOperations} FNS operation(s), ` +
      `${published.length} auto-published, ${held.length} held, ${expired} expired` +
      (errors.length ? ` – errors: ${errors.join("; ")}` : ""),
  );
  return summary;
}

export function startDisasterScanCron(
  bot: Bot,
  tz: string,
  publicBaseUrl: string,
): void {
  // Daily: FNS caps application periods at 7 days, so weekly lag can miss a whole window.
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        await runDisasterScan(bot, tz, publicBaseUrl);
      } catch (err) {
        console.error("[disaster] scan failed:", err);
      }
    },
    { timezone: tz },
  );

  console.log(`Disaster CalFresh scan cron armed (daily 07:00 ${tz})`);
}
