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
  | "incomeProof"
  /** Award letter from a qualifying program, or pay stubs / benefit letter. */
  | "incomeOrCategorical"
  /** Filed return – CalEITC / YCTC path (not a substitute for incomeProof). */
  | "taxReturn"
  | "taxForms";

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
  | "has_abd"
  | "has_work_disruption"
  | "has_disaster_area"
  | "has_zip"
  | "has_immigration_status"
  | "offer"
  | "idle"
  | "confirm_stop"
  | "confirm_erase"
  | "help_menu";

/** Why work/earnings stopped or dropped recently – gates EDD wage-replacement programs. */
export type WorkDisruption = "job_loss" | "health" | "family_care" | "none";

export interface Deadline {
  label: string;
  date: string | null;
}

/** Structured max aid used to compute offer-card $ estimates. */
export type BenefitPeriod = "week" | "month" | "year" | "once";

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
  /** For period "week": statutory max weeks used when annualizing (defaults to 52). */
  maxWeeks?: number;
}

export interface Program {
  id: string;
  name: string;
  category: ProgramCategory;
  oneLiner: string;
  maxBenefit: string;
  /** Max $ by person/household – source of truth for offer “Est.” line. */
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
  /** SSI / CAPI-style: needs someone aged 65+, blind, or disabled. */
  requiresAgedBlindOrDisabled?: boolean;
  /** UI/SDI/PFL-style: gated by the single-select work-disruption reason. */
  requiresWorkDisruption?: Exclude<WorkDisruption, "none">;
  /**
   * Disaster CalFresh-style: needs a county application window open today AND
   * the user confirming they lived or worked in the declared area. Dormant most
   * of the year, so these programs stay out of the queue entirely by default.
   */
  requiresActiveDisasterWindow?: boolean;
  /**
   * CMSP-style: only offered when residenceCounty is one of the participating
   * CMSP counties. ZIP is asked only when this would otherwise enter the queue.
   */
  requiresCmspCounty?: boolean;
  /**
   * Needs U.S. citizen or eligible-immigrant status (CalFresh, SSI, CalWORKs,
   * CMSP, UI). Held until after status-blind offers, then a private one-shot
   * question – the answer is not persisted on the session.
   */
  requiresCitizenOrEligibleImmigrant?: boolean;
  /**
   * CAPI-style: for non-citizens denied SSI solely due to immigration status.
   * Offered only when the user answers “No” on the immigration-status question.
   */
  requiresIneligibleImmigrantStatus?: boolean;
  /**
   * Drop from queue when user already marked one of these at the gate
   * (e.g. Disaster CalFresh if already on CalFresh; CMSP if already on Medi-Cal).
   */
  excludeIfAlreadyOn?: string[];
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

/** Last interactive bot prompt – re-shown after alpha feedback. */
export interface LastBotMessage {
  text: string;
  replyMarkup: { inline_keyboard: unknown } | null;
  /** When set, replay must use the same parse mode (e.g. HTML links). */
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
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
  /** Kids under 18 or pregnancy – gates requiresChildInHousehold programs. */
  hasChildInHousehold: boolean | null;
  /** Aged 65+ / blind / disabled – gates requiresAgedBlindOrDisabled programs. */
  hasAgedBlindOrDisabled: boolean | null;
  /** Job loss / health / family-care / none – gates requiresWorkDisruption programs. */
  workDisruption: WorkDisruption | null;
  /**
   * Lived or worked in a declared disaster area during an open D-CalFresh
   * window. Only asked while a window is live; no ZIP or county is stored
   * because eligibility turns on home *or* work location for any member.
   */
  inDisasterArea: boolean | null;
  /**
   * Home ZIP – asked only when a county-gated program (CMSP) would enter the
   * queue. null = not asked; "" = skipped; otherwise a 5-digit ZIP.
   */
  residenceZip: string | null;
  /** County resolved from residenceZip (null if skipped / unknown). */
  residenceCounty: string | null;
  docsInHand: DocId[];
  queue: string[];
  queueIndex: number;
  alreadyOn: string[];
  items: NextStepsItem[];
  remindersEnabled: boolean;
  /** User said STOP – pauses reminders until their next message (data kept). */
  remindersStopped: boolean;
  awaitingConfirm: "stop" | "erase" | null;
  /** Most recent screen prompt (text + keyboard) for feedback replay. */
  lastBotMessage: LastBotMessage | null;
  /** Campaign from QR / share /start payload – used for partner attribution. */
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
}
