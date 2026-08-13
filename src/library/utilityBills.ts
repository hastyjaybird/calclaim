import { getProgramRequirements } from "./requirements.js";
import type { Program, SessionState } from "./types.js";
import { programAvailableForBills } from "./utilityTerritory.js";

/** Bill / account types asked on the utility-bills triage gate. */
export type UtilityBillType =
  | "pge"
  | "sdge"
  | "sce"
  | "socalgas"
  | "ladwp"
  | "smud"
  | "other_ca_utility"
  | "heating_fuel"
  | "phone_internet";

/** Sentinel in `billsInMyName` while answering: none of these bills. */
export const UTILITY_BILL_NONE_ID = "none";

export const UTILITY_BILL_OPTIONS = [
  { id: "pge" as const, label: "PG&E bill" },
  { id: "sdge" as const, label: "SDG&E bill" },
  { id: "sce" as const, label: "SCE bill" },
  { id: "socalgas" as const, label: "SoCalGas bill" },
  { id: "ladwp" as const, label: "LADWP bill" },
  { id: "smud" as const, label: "SMUD bill" },
  {
    id: "other_ca_utility" as const,
    label: "Other CA electric or gas utility",
  },
  {
    id: "heating_fuel" as const,
    label: "Heating fuel bill (propane, oil, wood, etc.)",
  },
  { id: "phone_internet" as const, label: "Phone or internet bill" },
] as const;

/** Favorable probe for unlock ranking (any bill that opens energy + telecom paths). */
export const ALL_UTILITY_BILLS: UtilityBillType[] = UTILITY_BILL_OPTIONS.map(
  (o) => o.id,
);

const VALID_BILL_IDS = new Set<string>([
  ...ALL_UTILITY_BILLS,
  UTILITY_BILL_NONE_ID,
]);

/** Legacy ids from older sessions / samples → current ids. */
const LEGACY_BILL_IDS: Record<string, UtilityBillType> = {
  pge_electric: "pge",
  pge_gas: "pge",
  heating_cooling: "heating_fuel",
  phone_bill: "phone_internet",
  internet_bill: "phone_internet",
};

const LIHEAP_BILL_IDS = new Set<string>([
  "pge",
  "sdge",
  "sce",
  "socalgas",
  "ladwp",
  "smud",
  "other_ca_utility",
  "heating_fuel",
]);

const LIFELINE_BILL_IDS = new Set<string>(["phone_internet"]);

/** Normalize a stored bill id (legacy → current). Returns null if unknown. */
export function normalizeUtilityBillId(id: string): string | null {
  if (LEGACY_BILL_IDS[id]) return LEGACY_BILL_IDS[id]!;
  if (VALID_BILL_IDS.has(id)) return id;
  return null;
}

/** Migrate/dedupe a session bills array in place-friendly form. */
export function migrateBillsInMyName(bills: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of bills) {
    const id = normalizeUtilityBillId(raw);
    if (!id || out.includes(id)) continue;
    out.push(id);
  }
  if (out.includes(UTILITY_BILL_NONE_ID) && out.length > 1) {
    return [UTILITY_BILL_NONE_ID];
  }
  return out;
}

/**
 * Programs that need an account in the applicant's name before offer.
 * ESA is included even without the matrix tag – renters without an account
 * were dropped with the old “bill not in my name” path.
 */
export function programNeedsBillInName(program: Program): boolean {
  if (program.id === "esa") return true;
  return getProgramRequirements(program.id).eligibility.includes(
    "account_in_your_name",
  );
}

export function utilityBillsAnswered(session: SessionState): boolean {
  return session.utilityBillsAsked === true;
}

/** True when the user finished the gate with None (or empty). */
export function hasNoBillsInName(session: SessionState): boolean {
  if (!utilityBillsAnswered(session)) return false;
  const bills = session.billsInMyName;
  return (
    bills.length === 0 ||
    bills.includes(UTILITY_BILL_NONE_ID) ||
    session.billNotInMyName
  );
}

export function selectedUtilityBills(session: SessionState): string[] {
  if (!utilityBillsAnswered(session)) return [];
  return session.billsInMyName.filter((id) => id !== UTILITY_BILL_NONE_ID);
}

/**
 * Whether this program passes given the selected bills.
 * IOU CARE-family + munis via territory rules; LIHEAP any energy/fuel bill;
 * LifeLine phone or internet bill.
 */
export function passesBillInNameGate(
  program: Program,
  bills: readonly string[] | null,
): boolean {
  if (!programNeedsBillInName(program)) return true;
  if (bills == null) return false;
  const selected = migrateBillsInMyName(bills).filter(
    (id) => id !== UTILITY_BILL_NONE_ID,
  );
  if (selected.length === 0 || bills.includes(UTILITY_BILL_NONE_ID)) {
    return false;
  }
  if (program.id === "lifeline") {
    return selected.some((id) => LIFELINE_BILL_IDS.has(id));
  }
  if (program.id === "liheap") {
    return selected.some((id) => LIHEAP_BILL_IDS.has(id));
  }
  return programAvailableForBills(program, selected);
}

export function billsInMyNameLabel(bills: readonly string[] | null): string {
  if (bills == null) return "not asked";
  const normalized = migrateBillsInMyName(bills);
  if (normalized.includes(UTILITY_BILL_NONE_ID) || normalized.length === 0) {
    return "none in my name";
  }
  const labels = UTILITY_BILL_OPTIONS.filter((o) =>
    normalized.includes(o.id),
  ).map((o) => o.label);
  return labels.length ? labels.join(", ") : normalized.join(", ");
}
