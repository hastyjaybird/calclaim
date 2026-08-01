import { getCorpusMeta, loadIncomeBands, loadPrograms } from "../corpus/load.js";
import { WATCH_CHECKLIST } from "./checklist.js";
import { countOpenFindingsByProgram, latestScan, listFindings, listScans } from "./db.js";
import { llmAvailable } from "./llm.js";
import type { CorpusOverview } from "./types.js";

const AGING_RULE_DAYS = 90;

function ageDaysFromVersion(version: string): number | null {
  // Expect YYYY-MM-DD; tolerate other strings as unknown
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return null;
  const then = Date.parse(`${version}T12:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

export function buildCorpusOverview(): CorpusOverview {
  const meta = getCorpusMeta();
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

export function buildDevStatus() {
  const overview = buildCorpusOverview();
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
  };
}
