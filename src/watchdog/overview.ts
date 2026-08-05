import { getLibraryMeta, loadIncomeBands, loadPrograms } from "../library/load.js";
import {
  daysSinceSuccess,
  getScanState,
  listApprovedWindows,
  listLiveWindows,
  listWindows,
  STALE_AFTER_DAYS,
} from "../disaster/db.js";
import { todayYmd } from "../disaster/format.js";
import { WATCH_CHECKLIST } from "./checklist.js";
import { countOpenFindingsByProgram, latestScan, listFindings, listScans } from "./db.js";
import { llmAvailable } from "./llm.js";
import type { LibraryOverview } from "./types.js";

const AGING_RULE_DAYS = 90;

function ageDaysFromVersion(version: string): number | null {
  // Expect YYYY-MM-DD; tolerate other strings as unknown
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return null;
  const then = Date.parse(`${version}T12:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

export function buildLibraryOverview(): LibraryOverview {
  const meta = getLibraryMeta();
  const programs = loadPrograms();
  const bands = loadIncomeBands();
  const openByProgram = countOpenFindingsByProgram();
  const ageDays = ageDaysFromVersion(meta.version);

  return {
    version: meta.version,
    market: meta.market,
    programCount: programs.length,
    ageDays,
    agingRuleDays: AGING_RULE_DAYS,
    needsReview: ageDays == null || ageDays > AGING_RULE_DAYS,
    incomeBandsVersion: bands.version,
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      applyUrl: p.applyUrl,
      sourceCount: p.sources.length,
      deadlineCount: p.deadlines.length,
      hasNullDeadline: p.deadlines.some((d) => d.date == null),
      openFindings: openByProgram.get(p.id) ?? 0,
    })),
    watchChecklist: WATCH_CHECKLIST,
  };
}

export function buildDisasterStatus() {
  const today = todayYmd();
  const sources = (["fns", "fema", "cdss"] as const).map((source) => {
    const state = getScanState(source);
    const days = daysSinceSuccess(source);
    return {
      source,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastError: state?.lastError ?? null,
      daysSinceSuccess: days,
      staleAfterDays: STALE_AFTER_DAYS[source],
      stale: days == null || days >= STALE_AFTER_DAYS[source],
    };
  });
  const approved = listApprovedWindows(today);
  return {
    today,
    staleAfterDays: STALE_AFTER_DAYS,
    sources,
    // Held windows failed a mechanical check, so the card stayed hidden.
    heldCount: listWindows("pending", 200).length,
    liveCount: listLiveWindows(today).length,
    // Published and waiting for the application period to start.
    upcomingCount: approved.length - listLiveWindows(today).length,
    windows: listWindows("all", 25),
  };
}

export function buildDevStatus() {
  const overview = buildLibraryOverview();
  const scan = latestScan();
  const openFindings = listFindings({ status: "open", limit: 100 });
  const recentScans = listScans(10);
  return {
    overview,
    llmEnabled: llmAvailable(),
    latestScan: scan,
    recentScans,
    openFindings,
    findingCounts: {
      open: openFindings.length,
      critical: openFindings.filter((f) => f.severity === "critical").length,
      high: openFindings.filter((f) => f.severity === "high").length,
    },
    disaster: buildDisasterStatus(),
  };
}
