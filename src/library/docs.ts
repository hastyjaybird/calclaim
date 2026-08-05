import type { DocId } from "./types.js";

export const DOC_LABELS: Record<DocId, string> = {
  categoricalProof: "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC)",
  photoId: "Photo ID",
  utilityBill: "Utility account # or recent bill",
  incomeProof: "Pay stubs or benefit award letter",
  incomeOrCategorical:
    "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC) OR pay stubs",
  taxReturn: "Filed tax return (use W-2s / 1099s to prepare it)",
  taxForms: "W-2s and 1099s",
};

/** Programs this slow (or slower) surface a docs checklist on the offer card. */
export const HIGH_FRICTION_TIME_DAYS = 21;

export function docLabel(id: DocId): string {
  return DOC_LABELS[id] ?? id;
}

/**
 * Whether the household already has what a required doc asks for.
 * `incomeOrCategorical` is satisfied by an award letter or by pay-stub income proof.
 */
export function hasDoc(docsInHand: readonly DocId[], needed: DocId): boolean {
  if (docsInHand.includes(needed)) return true;
  if (needed === "incomeOrCategorical") {
    return (
      docsInHand.includes("categoricalProof") ||
      docsInHand.includes("incomeProof")
    );
  }
  return false;
}

export function missingDocs(
  needed: readonly DocId[],
  docsInHand: readonly DocId[],
): DocId[] {
  return needed.filter((d) => !hasDoc(docsInHand, d));
}
