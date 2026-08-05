import { missingDocs } from "./docs.js";
import type { DocId, Program } from "./types.js";

/**
 * Form-fill minutes from library cold-start, discounted when the household
 * already has docs from a prior form (e.g. Medi-Cal / gate YES).
 *
 * ~45% of cold time is hunting/entering docs – that portion scales with
 * how many `docsNeeded` are still missing from `docsInHand`.
 */
export function estimateFormFillMinutes(
  program: Program,
  docsInHand: DocId[],
): number {
  const cold = program.formFillMinutes;
  const needed = program.docsNeeded;
  if (needed.length === 0) return niceMinutes(cold);

  const newDocs = missingDocs(needed, docsInHand).length;
  const haveRatio = (needed.length - newDocs) / needed.length;
  const raw = cold * (1 - 0.45 * haveRatio);
  return niceMinutes(raw);
}

export function formatFormFillEstimate(
  program: Program,
  docsInHand: DocId[],
): string {
  const min = estimateFormFillMinutes(program, docsInHand);
  return `Est. ~${min} min to fill out form`;
}

function niceMinutes(n: number): number {
  const rounded = Math.round(n);
  if (rounded <= 5) return Math.max(3, rounded);
  // Snap to 5-minute steps for easier scanning on offer cards.
  return Math.max(5, Math.round(rounded / 5) * 5);
}
