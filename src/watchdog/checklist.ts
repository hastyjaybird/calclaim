import type { WatchItem } from "./types.js";

/**
 * What developers should keep an eye on when refreshing the frozen corpus.
 * Surfaced on the Developer tab; the scan agent checks as many of these as it can.
 */
export const WATCH_CHECKLIST: WatchItem[] = [
  {
    id: "deadlines",
    label: "Important dates & filing windows",
    why: "Reminders and offer cards use deadline labels/dates (e.g. tax season, LIHEAP windows).",
    corpusFields: ["deadlines"],
  },
  {
    id: "eligibility",
    label: "Qualifications / eligibility rules",
    why: "Wrong gates mis-route users. Income, categorical, age, and disability rules drift yearly.",
    corpusFields: [
      "oneLiner",
      "incomeGate",
      "requiresPastDue",
      "requiresChildInHousehold",
      "excludeIfAlreadyOn",
      "applySteps",
    ],
  },
  {
    id: "apply_process",
    label: "Application process steps",
    why: "Living next-steps PDF and offer copy come from applySteps.",
    corpusFields: ["applySteps"],
  },
  {
    id: "funding_status",
    label: "Funds exhausted / program paused",
    why: "Seasonal or capped programs (LIHEAP, local aid) may stop accepting applications mid-cycle.",
    corpusFields: ["deadlines", "oneLiner", "applySteps"],
  },
  {
    id: "max_benefit",
    label: "Max amounts per person / household",
    why: "Offer cards compute $ from maxBenefitUsd; funder dashboard uses estAnnualUsd.",
    corpusFields: ["maxBenefit", "maxBenefitUsd", "estAnnualUsd"],
  },
  {
    id: "apply_url",
    label: "Application form URLs",
    why: "Broken or redirected apply links waste trust; /r/:id only tracks what we send.",
    corpusFields: ["applyUrl", "sources"],
  },
  {
    id: "docs_needed",
    label: "Required documents",
    why: "Ranker prioritizes fewer new docs; PDF checklists copy docsNeeded.",
    corpusFields: ["docsNeeded", "docsReusableFromGate"],
  },
  {
    id: "income_bands",
    label: "CARE / FERA income thresholds",
    why: "Household income gate labels come from corpus/income-bands.json (utility/CPUC updates).",
    corpusFields: ["income-bands.json"],
  },
  {
    id: "program_status",
    label: "Open / closed / waitlist status",
    why: "No first-class status field yet — closed programs should be removed or clearly labeled.",
    corpusFields: ["oneLiner", "deadlines"],
  },
  {
    id: "branding",
    label: "Program name & portal branding",
    why: "CoveredCA / BenefitsCal / utility renames confuse users if offer cards are stale.",
    corpusFields: ["name", "oneLiner", "applyUrl"],
  },
  {
    id: "sources",
    label: "Source citation pages",
    why: "sources[] is the audit trail for the frozen corpus; dead citations break verification.",
    corpusFields: ["sources"],
  },
  {
    id: "time_to_money",
    label: "Time-to-money estimates",
    why: "Second ranking key after doc reuse; big delays change offer order.",
    corpusFields: ["timeToMoneyDays"],
  },
  {
    id: "cascades",
    label: "Skip cascades & bill-not-in-name rules",
    why: "CARE skip cascades drop ESA/AMP/Medical Baseline — wrong links break routing.",
    corpusFields: ["skipCascades", "skipReasons", "requiresPastDue"],
  },
  {
    id: "new_sunset",
    label: "New or sunset programs",
    why: "Expansion watchlist + agency announcements; add rows or park deprecated IDs.",
    corpusFields: ["programs.json", "docs/expansion-watchlist.md"],
  },
];
