import { loadIncomeBands, loadPrograms } from "../corpus/load.js";
import type { Program } from "../corpus/types.js";
import {
  createScan,
  finishScan,
  getScan,
  hasRunningScan,
  insertFindings,
  updateScanProgress,
} from "./db.js";
import { checkLink, fetchPageText } from "./fetch.js";
import {
  findingsForIncomeBandsPage,
  findingsFromLinkCheck,
  findingsFromPageHeuristics,
} from "./heuristics.js";
import { analyzeProgramWithLlm, llmAvailable } from "./llm.js";
import type { DraftFinding, ScanRun } from "./types.js";

/** Prefer CARE/FERA page already in corpus for income-band checks. */
const INCOME_BAND_URL =
  "https://www.pge.com/en/account/billing-and-assistance/financial-assistance/california-alternate-rates-for-energy-program.html";

let activePromise: Promise<ScanRun> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkProgram(program: Program, useLlm: boolean): Promise<DraftFinding[]> {
  const findings: DraftFinding[] = [];
  const urls = [program.applyUrl, ...program.sources.filter((u) => u !== program.applyUrl)];
  const pageTexts: Array<{ url: string; text: string }> = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    const kind = i === 0 ? "applyUrl" : "source";
    const link = await checkLink(url);
    findings.push(...findingsFromLinkCheck(program, kind, link));

    if (link.ok) {
      const page = await fetchPageText(link.finalUrl ?? url);
      if (page.ok && page.text) {
        pageTexts.push({ url: page.finalUrl ?? url, text: page.text });
        findings.push(...findingsFromPageHeuristics(program, page));
      } else if (kind === "applyUrl") {
        findings.push({
          programId: program.id,
          category: "link_health",
          severity: "medium",
          title: `Could not read apply page for ${program.name}`,
          detail: page.error ?? "Empty body",
          evidenceUrl: url,
          suggestedAction: "Open the URL manually; some agency sites block automated fetches.",
          corpusField: "applyUrl",
          source: "heuristic",
        });
      }
    }

    await sleep(350);
  }

  if (useLlm && pageTexts.length) {
    findings.push(...(await analyzeProgramWithLlm(program, pageTexts.slice(0, 2))));
  }

  return dedupeFindings(findings);
}

function dedupeFindings(items: DraftFinding[]): DraftFinding[] {
  const seen = new Set<string>();
  const out: DraftFinding[] = [];
  for (const f of items) {
    const key = `${f.programId ?? ""}|${f.category}|${f.title}|${f.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * Start a corpus freshness scan. Rejects if one is already running.
 * Returns the scan row immediately; await `done` for completion.
 */
export function startCorpusScan(): { scan: ScanRun; done: Promise<ScanRun> } {
  if (hasRunningScan() || activePromise) {
    throw new Error("A corpus scan is already running");
  }

  const programs = loadPrograms();
  const useLlm = llmAvailable();
  const scan = createScan(programs.length + 1, useLlm);

  activePromise = (async () => {
    let findingsTotal = 0;
    let doneCount = 0;
    try {
      for (const program of programs) {
        const drafts = await checkProgram(program, useLlm);
        if (drafts.length) {
          insertFindings(scan.id, drafts);
          findingsTotal += drafts.length;
        }
        doneCount += 1;
        updateScanProgress(scan.id, doneCount, findingsTotal);
      }

      const bands = loadIncomeBands();
      const bandLink = await checkLink(INCOME_BAND_URL);
      const bandsPage = await fetchPageText(INCOME_BAND_URL);
      const bandFindings = findingsForIncomeBandsPage(bandsPage, bands.version);
      if (!bandLink.ok) {
        bandFindings.unshift({
          programId: null,
          category: "income_bands",
          severity: "high",
          title: "CARE/FERA guidelines URL unreachable",
          detail: bandLink.error ?? "Failed",
          evidenceUrl: INCOME_BAND_URL,
          suggestedAction:
            "Find the current published CARE/FERA income table and update income-bands.json.",
          corpusField: "income-bands.json",
          source: "link_check",
        });
      }
      if (bandFindings.length) {
        insertFindings(scan.id, dedupeFindings(bandFindings));
        findingsTotal += bandFindings.length;
      }
      doneCount += 1;
      updateScanProgress(scan.id, doneCount, findingsTotal);

      const summary = useLlm
        ? `Checked ${programs.length} programs + income bands (link/heuristic/LLM). ${findingsTotal} finding(s).`
        : `Checked ${programs.length} programs + income bands (link + heuristic). Add OPENROUTER_API_KEY or OPENAI_API_KEY for LLM review. ${findingsTotal} finding(s).`;

      finishScan(scan.id, "completed", summary, null, findingsTotal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishScan(scan.id, "failed", null, message, findingsTotal);
    } finally {
      activePromise = null;
    }
    return getScan(scan.id)!;
  })();

  return { scan, done: activePromise };
}
