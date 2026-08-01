export type ProgramCategory =
  | "health"
  | "food"
  | "cash"
  | "telecom"
  | "energy"
  | "tax"
  | "other";

export type DocId =
  | "categoricalProof"
  | "photoId"
  | "utilityBill"
  | "incomeProof";

export type IncomeBand = "careBand" | "feraBand" | "aboveFera";

export type Branch = "yes" | "no" | "tax_only";

export type TodoStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "snoozed"
  | "skipped";

export type StepId =
  | "opt_in"
  | "gate"
  | "household_size"
  | "income_band"
  | "past_due"
  | "has_child"
  | "offer"
  | "care_skip"
  | "idle"
  | "confirm_stop"
  | "confirm_erase"
  | "help_menu";

export interface Deadline {
  label: string;
  date: string | null;
}

/** Structured max aid used to compute offer-card $ estimates. */
export type BenefitPeriod = "month" | "year" | "once";

export interface MaxBenefitUsd {
  period: BenefitPeriod;
  /** Flat household max (same for any size). */
  amount?: number;
  /** Per-person max × household size (optional cap). */
  perPerson?: number;
  maxHousehold?: number;
  /** Explicit max by household size ("1"…"8"). */
  byHouseholdSize?: Record<string, number>;
  /** Added for each person above 8 when using byHouseholdSize. */
  eachAdditional?: number;
  /**
   * For % discount programs: max $ = percentOff × referenceBillUsd.
   * Offer copy shows dollars, not the percentage.
   */
  percentOff?: number;
  referenceBillUsd?: number;
}

export interface Program {
  id: string;
  name: string;
  category: ProgramCategory;
  oneLiner: string;
  maxBenefit: string;
  /** Max $ by person/household — source of truth for offer “Est.” line. */
  maxBenefitUsd: MaxBenefitUsd;
  /** Conservative annual $ estimate for funder impact math (not a promise). */
  estAnnualUsd: number;
  applyUrl: string;
  deadlines: Deadline[];
  applySteps: string[];
  docsNeeded: DocId[];
  docsReusableFromGate: DocId[];
  timeToMoneyDays: number;
  /** Cold-start form fill estimate (minutes). Discounted when docs already in hand. */
  formFillMinutes: number;
  branches: Branch[];
  yesOrder: number;
  noOrder: number;
  gateFeeder?: boolean;
  incomeGate?: "careBand" | "feraBand" | "careOrFeraBand";
  requiresPastDue?: boolean;
  /** CalWORKs / WIC-style: needs a child under 18 or pregnancy in the household. */
  requiresChildInHousehold?: boolean;
  skipCascades: string[];
  skipReasons: string[];
  sources: string[];
}

export interface NextStepsItem {
  programId: string;
  programName: string;
  category: ProgramCategory;
  action: string;
  link: string;
  deadlineLabel: string;
  deadlineDate: string | null;
  status: TodoStatus;
  docs: DocId[];
}

/** Last interactive bot prompt — re-shown after alpha feedback. */
export interface LastBotMessage {
  text: string;
  replyMarkup: { inline_keyboard: unknown } | null;
}

export interface SessionState {
  telegramUserId: number;
  step: StepId;
  branch: Branch | null;
  language: "en";
  householdSize: number | null;
  incomeBand: IncomeBand | null;
  pastDue: boolean | null;
  /** True when user said the utility / PG&E bill is not in their name. */
  billNotInMyName: boolean;
  /** Kids under 18 or pregnancy — gates requiresChildInHousehold programs. */
  hasChildInHousehold: boolean | null;
  docsInHand: DocId[];
  queue: string[];
  queueIndex: number;
  alreadyOn: string[];
  items: NextStepsItem[];
  remindersEnabled: boolean;
  awaitingConfirm: "stop" | "erase" | null;
  /** Most recent screen prompt (text + keyboard) for feedback replay. */
  lastBotMessage: LastBotMessage | null;
  createdAt: string;
  updatedAt: string;
}
