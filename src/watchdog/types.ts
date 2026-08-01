/** Categories the corpus watcher looks for on official program pages. */
export type FindingCategory =
  | "deadline"
  | "eligibility"
  | "apply_process"
  | "funding_status"
  | "max_benefit"
  | "apply_url"
  | "link_health"
  | "docs_needed"
  | "income_bands"
  | "program_status"
  | "branding"
  | "est_annual"
  | "other";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ScanStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type FindingStatus = "open" | "acknowledged" | "dismissed" | "fixed";

export interface Finding {
  id: number;
  scanId: number;
  programId: string | null;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidenceUrl: string | null;
  suggestedAction: string | null;
  corpusField: string | null;
  status: FindingStatus;
  source: "link_check" | "heuristic" | "llm";
  createdAt: string;
}

export interface ScanRun {
  id: number;
  status: ScanStatus;
  startedAt: string;
  finishedAt: string | null;
  programsTotal: number;
  programsDone: number;
  findingsCount: number;
  error: string | null;
  llmEnabled: boolean;
  summary: string | null;
}

export interface LinkCheckResult {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  redirected: boolean;
  error: string | null;
  ms: number;
}

export interface PageFetchResult {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  text: string;
  error: string | null;
}

export interface DraftFinding {
  programId: string | null;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidenceUrl?: string | null;
  suggestedAction?: string | null;
  corpusField?: string | null;
  source: "link_check" | "heuristic" | "llm";
}

export interface CorpusOverview {
  version: string;
  market: string;
  programCount: number;
  ageDays: number | null;
  agingRuleDays: number;
  needsReview: boolean;
  incomeBandsVersion: string;
  programs: Array<{
    id: string;
    name: string;
    category: string;
    applyUrl: string;
    sourceCount: number;
    deadlineCount: number;
    hasNullDeadline: boolean;
    openFindings: number;
  }>;
  watchChecklist: WatchItem[];
}

export interface WatchItem {
  id: string;
  label: string;
  why: string;
  corpusFields: string[];
}
