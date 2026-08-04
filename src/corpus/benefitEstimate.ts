import type { MaxBenefitUsd, Program } from "./types.js";

const DEFAULT_HH = 4;

function clampHouseholdSize(size: number | null | undefined): number {
  if (size == null || !Number.isFinite(size) || size < 1) return DEFAULT_HH;
  return Math.min(Math.floor(size), 12);
}

/** Maximum $ the program allows for this household (corpus math). */
export function maxBenefitAmountUsd(
  spec: MaxBenefitUsd,
  householdSize: number | null | undefined,
): number | null {
  const n = clampHouseholdSize(householdSize);

  if (spec.byHouseholdSize) {
    if (n <= 8) {
      const v = spec.byHouseholdSize[String(n)];
      if (v != null) return Math.round(v);
    }
    const base8 = spec.byHouseholdSize["8"];
    if (base8 != null && spec.eachAdditional != null) {
      return Math.round(base8 + spec.eachAdditional * (n - 8));
    }
    if (base8 != null) return Math.round(base8);
  }

  if (spec.perPerson != null) {
    let total = spec.perPerson * n;
    if (spec.maxHousehold != null) total = Math.min(total, spec.maxHousehold);
    return Math.round(total);
  }

  if (spec.percentOff != null && spec.referenceBillUsd != null) {
    return Math.round(spec.percentOff * spec.referenceBillUsd);
  }

  if (spec.amount != null) return Math.round(spec.amount);
  return null;
}

function periodLabel(period: MaxBenefitUsd["period"]): string {
  if (period === "week") return "/wk";
  if (period === "month") return "/mo";
  if (period === "year") return "/yr";
  return " one-time";
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Offer-card line: dollar max for this household (never a bare %). */
export function formatMaxBenefitEstimate(
  program: Program,
  householdSize: number | null | undefined,
): string {
  const amount = maxBenefitAmountUsd(program.maxBenefitUsd, householdSize);
  if (amount == null) {
    return `Est. ${program.maxBenefit}`;
  }
  const n = clampHouseholdSize(householdSize);
  const period = periodLabel(program.maxBenefitUsd.period);
  const scalesWithHh =
    Boolean(program.maxBenefitUsd.byHouseholdSize) ||
    program.maxBenefitUsd.perPerson != null;
  // Household size is already known from triage — don't restate it. Show
  // $/person when the max scales with size (skip for a solo household).
  const perPersonNote =
    scalesWithHh && n > 1
      ? ` (~${formatUsd(Math.round(amount / n))}/person)`
      : "";
  return `Est. up to ~${formatUsd(amount)}${period}${perPersonNote}`;
}

/** Annualize max for funder-style math (household of `size`, default 4). */
export function annualizeMaxBenefitUsd(
  program: Program,
  householdSize: number | null | undefined = DEFAULT_HH,
): number {
  const amount = maxBenefitAmountUsd(program.maxBenefitUsd, householdSize);
  if (amount == null) return program.estAnnualUsd;
  const { period } = program.maxBenefitUsd;
  if (period === "month") return amount * 12;
  if (period === "year") return amount;
  if (period === "week") return amount * (program.maxBenefitUsd.maxWeeks ?? 52);
  return amount; // one-time counts once in a year window
}
