import type { DocId } from "./types.js";

export const DOC_LABELS: Record<DocId, string> = {
  categoricalProof: "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC)",
  photoId: "Photo ID",
  utilityBill: "Utility account # or recent bill",
  incomeProof: "Proof of income (pay stub or award letter)",
};

/** Programs this slow (or slower) surface a docs checklist on the offer card. */
export const HIGH_FRICTION_TIME_DAYS = 21;

export function docLabel(id: DocId): string {
  return DOC_LABELS[id] ?? id;
}
