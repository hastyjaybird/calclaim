import type { Program } from "../library/types.js";
import { normalizeUrl } from "./fetch.js";
import type { DraftFinding, LinkCheckResult, PageFetchResult } from "./types.js";

function matchAny(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

const FUNDING_PATTERNS = [
  /funds?\s+(have\s+)?(been\s+)?(exhausted|depleted|fully\s+allocated)/i,
  /no\s+longer\s+(accepting|taking)\s+applications/i,
  /applications?\s+(are\s+)?(currently\s+)?closed/i,
  /program\s+(is\s+)?(temporarily\s+)?(suspended|paused|closed)/i,
  /waitlist\s+(only|is\s+full)/i,
  /funding\s+(has\s+)?(run\s+out|ended)/i,
];

const DEADLINE_PATTERNS = [
  /deadline[:\s]+[A-Za-z]+\s+\d{1,2},?\s+\d{4}/i,
  /apply\s+by\s+[A-Za-z]+\s+\d{1,2}/i,
  /open(ing)?\s+(from|on|until)\s+[A-Za-z]+\s+\d{1,2}/i,
  /filing\s+(season|deadline)/i,
  /seasonal\s+(application\s+)?window/i,
];

const ELIGIBILITY_PATTERNS = [
  /income\s+(limit|guideline|eligibility)\s+(has\s+)?(changed|updated|increased|decreased)/i,
  /new\s+eligibility\s+(rules?|requirements?)/i,
  /must\s+(now\s+)?(be|have|earn)/i,
  /no\s+longer\s+eligible/i,
  /federal\s+poverty\s+level/i,
];

const PROCESS_PATTERNS = [
  /new\s+(online\s+)?application\s+(process|portal|system)/i,
  /applications?\s+(must|should)\s+now\s+be\s+submitted/i,
  /required\s+documents?\s+(have\s+)?changed/i,
  /interview\s+(is\s+)?(now\s+)?required/i,
];

const AMOUNT_PATTERNS = [
  /up\s+to\s+\$[\d,]+/i,
  /maximum\s+(benefit|assistance|payment)\s+(of\s+)?\$[\d,]+/i,
  /\d{1,2}\s*%\s+(discount|off)/i,
  /benefit\s+amount\s+(has\s+)?(changed|increased|decreased)/i,
];

export function findingsFromLinkCheck(
  program: Program,
  kind: "applyUrl" | "source",
  check: LinkCheckResult,
): DraftFinding[] {
  const out: DraftFinding[] = [];
  const label = kind === "applyUrl" ? "Apply URL" : "Source URL";

  if (!check.ok) {
    const blocked = check.status === 401 || check.status === 403 || check.status === 429;
    out.push({
      programId: program.id,
      category: kind === "applyUrl" ? "apply_url" : "link_health",
      severity: blocked ? "medium" : kind === "applyUrl" ? "critical" : "high",
      title: blocked
        ? `${label} blocked automated check for ${program.name}`
        : `${label} unreachable for ${program.name}`,
      detail: blocked
        ? `${check.url} returned HTTP ${check.status}. Many agency sites block bots – open the URL in a browser before changing the library (${check.ms}ms).`
        : `${check.url} failed: ${check.error ?? "unknown error"} (${check.ms}ms)`,
      evidenceUrl: check.url,
      suggestedAction: blocked
        ? `Manually verify the page still works. Only update the library if the browser also fails or the program moved.`
        : kind === "applyUrl"
          ? `Update programs.json → ${program.id}.applyUrl to the current official application page.`
          : `Update or remove this entry in programs.json → ${program.id}.sources.`,
      libraryField: kind === "applyUrl" ? "applyUrl" : "sources",
      source: "link_check",
    });
    return out;
  }

  if (check.redirected && check.finalUrl) {
    const samePath = normalizeUrl(check.finalUrl) === normalizeUrl(check.url);
    if (!samePath) {
      let hostChanged = false;
      try {
        hostChanged = new URL(check.finalUrl).host !== new URL(check.url).host;
      } catch {
        hostChanged = true;
      }
      out.push({
        programId: program.id,
        category: kind === "applyUrl" ? "apply_url" : "link_health",
        severity: hostChanged ? (kind === "applyUrl" ? "high" : "medium") : "low",
        title: `${label} redirects for ${program.name}`,
        detail: `${check.url} → ${check.finalUrl} (HTTP ${check.status ?? "?"})`,
        evidenceUrl: check.finalUrl,
        suggestedAction:
          kind === "applyUrl"
            ? `Consider updating applyUrl to the final destination: ${check.finalUrl}`
            : `Confirm the redirected source is still the right citation; update sources[] if needed.`,
        libraryField: kind === "applyUrl" ? "applyUrl" : "sources",
        source: "link_check",
      });
    }
  }

  return out;
}

export function findingsFromPageHeuristics(
  program: Program,
  page: PageFetchResult,
): DraftFinding[] {
  if (!page.ok || !page.text) return [];
  const text = page.text;
  const out: DraftFinding[] = [];
  const url = page.finalUrl ?? page.url;

  const funding = matchAny(text, FUNDING_PATTERNS);
  if (funding) {
    out.push({
      programId: program.id,
      category: "funding_status",
      severity: "critical",
      title: `Possible funding / closed signal for ${program.name}`,
      detail: `Page text matched “${funding}”. Confirm whether applications are still open.`,
      evidenceUrl: url,
      suggestedAction:
        "If closed or funds exhausted, pause the program in the library (or clearly label the seasonal/closed state) before the next deploy.",
      libraryField: "deadlines / oneLiner",
      source: "heuristic",
    });
  }

  const deadline = matchAny(text, DEADLINE_PATTERNS);
  if (deadline) {
    const hasStructured = program.deadlines.some((d) => d.date != null);
    out.push({
      programId: program.id,
      category: "deadline",
      severity: hasStructured ? "medium" : "high",
      title: `Date / window language found for ${program.name}`,
      detail: `Matched “${deadline}”. Library has ${program.deadlines.length} deadline row(s)${hasStructured ? "" : " (none with a concrete date)"}.`,
      evidenceUrl: url,
      suggestedAction:
        "Compare against programs.json deadlines[]; update label/date if the agency published a new window.",
      libraryField: "deadlines",
      source: "heuristic",
    });
  }

  const eligibility = matchAny(text, ELIGIBILITY_PATTERNS);
  if (eligibility) {
    out.push({
      programId: program.id,
      category: "eligibility",
      severity: "high",
      title: `Eligibility language on live page for ${program.name}`,
      detail: `Matched “${eligibility}”. Re-check incomeGate, oneLiner, and applySteps against the official rules.`,
      evidenceUrl: url,
      suggestedAction: "Diff official eligibility text vs library; update income bands if CARE/FERA.",
      libraryField: "incomeGate / oneLiner / applySteps",
      source: "heuristic",
    });
  }

  const processHit = matchAny(text, PROCESS_PATTERNS);
  if (processHit) {
    out.push({
      programId: program.id,
      category: "apply_process",
      severity: "medium",
      title: `Possible apply-process change for ${program.name}`,
      detail: `Matched “${processHit}”. Compare applySteps and docsNeeded to the live instructions.`,
      evidenceUrl: url,
      suggestedAction: "Rewrite applySteps / docsNeeded if the agency changed the path.",
      libraryField: "applySteps / docsNeeded",
      source: "heuristic",
    });
  }

  const amount = matchAny(text, AMOUNT_PATTERNS);
  if (amount) {
    const libraryMentionsAmount = /\$|\d+\s*%|up to/i.test(program.maxBenefit);
    if (libraryMentionsAmount || /\$/.test(amount)) {
      out.push({
        programId: program.id,
        category: "max_benefit",
        severity: "medium",
        title: `Benefit amount language for ${program.name}`,
        detail: `Live page has “${amount}”. Library maxBenefit is “${program.maxBenefit}” (estAnnualUsd=${program.estAnnualUsd}).`,
        evidenceUrl: url,
        suggestedAction:
          "If the published max changed, update maxBenefitUsd (and maxBenefit copy) and revise estAnnualUsd for the funder dashboard.",
        libraryField: "maxBenefitUsd / maxBenefit / estAnnualUsd",
        source: "heuristic",
      });
    }
  }

  // Name / branding drift: program name absent from page text
  const nameToken = program.name.split(/\s+/)[0] ?? program.name;
  if (nameToken.length >= 3 && !new RegExp(escapeRegExp(nameToken), "i").test(text)) {
    out.push({
      programId: program.id,
      category: "branding",
      severity: "low",
      title: `Program name not obvious on fetched page (${program.name})`,
      detail: `Could not find “${nameToken}” in stripped page text. Page may have moved, blocked scraping, or rebranded.`,
      evidenceUrl: url,
      suggestedAction: "Open the URL manually; update name/applyUrl if the program portal changed.",
      libraryField: "name / applyUrl",
      source: "heuristic",
    });
  }

  return out;
}

export function findingsForIncomeBandsPage(
  page: PageFetchResult,
  bandsVersion: string,
): DraftFinding[] {
  if (!page.ok || !page.text) {
    return [
      {
        programId: null,
        category: "income_bands",
        severity: "high",
        title: "Could not fetch CARE/FERA guidelines page",
        detail: page.error ?? "Empty response",
        evidenceUrl: page.url,
        suggestedAction:
          "Manually verify library/income-bands.json against current PG&E / CPUC published guidelines.",
        libraryField: "income-bands.json",
        source: "heuristic",
      },
    ];
  }

  const out: DraftFinding[] = [];
  const amountHits = page.text.match(/\$\s?[\d,]{3,}/g) ?? [];
  if (amountHits.length) {
    out.push({
      programId: null,
      category: "income_bands",
      severity: "medium",
      title: "Income dollar amounts found on CARE/FERA page",
      detail: `Page shows amounts such as ${amountHits.slice(0, 6).join(", ")}. Library income-bands version is ${bandsVersion}. Confirm careMax/feraMax still match.`,
      evidenceUrl: page.finalUrl ?? page.url,
      suggestedAction: "Update library/income-bands.json and bump its version date if thresholds changed.",
      libraryField: "income-bands.json",
      source: "heuristic",
    });
  }

  const changed = matchAny(page.text, [
    /income\s+(guidelines?|limits?)\s+(for|effective)/i,
    /effective\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}/i,
    /updated\s+income/i,
  ]);
  if (changed) {
    out.push({
      programId: null,
      category: "income_bands",
      severity: "high",
      title: "Income guideline update language detected",
      detail: `Matched “${changed}”. Re-verify household bands before production claims.`,
      evidenceUrl: page.finalUrl ?? page.url,
      suggestedAction: "Diff PG&E published CARE/FERA tables vs income-bands.json.",
      libraryField: "income-bands.json",
      source: "heuristic",
    });
  }

  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
