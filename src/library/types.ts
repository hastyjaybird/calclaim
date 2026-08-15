export type ProgramCategory =
  | "health"
  | "food"
  | "cash"
  | "telecom"
  | "energy"
  | "tax"
  | "transportation"
  | "other";

/** Funding / authorizing level for gate-chart review labels. */
export type ProgramJurisdiction = "federal" | "state" | "both";

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
  | "household_size_custom"
  | "income_band"
  | "past_due"
  | "has_utility_bills"
  | "has_shared_meter"
  | "has_shutoff_zone"
  | "has_shutoff_address"
  | "has_ca_residency"
  | "has_ca_work"
  | "has_buying_ev"
  | "has_first_time_zev"
  | "has_buying_ebike"
  | "has_retire_vehicle"
  | "has_child"
  | "has_foster_youth"
  | "has_refugee_status"
  | "has_medical_need"
  | "has_abd"
  | "has_work_disruption"
  | "has_disaster_area"
  | "has_disaster_zip"
  | "has_zip"
  | "has_immigration_status"
  | "has_reopen_notify"
  | "offer"
  | "idle"
  | "confirm_stop"
  | "confirm_erase"
  | "help_menu";

/** Saved for reopen-watch only – never required for normal triage. */
export type SavedImmigrationStatus = "eligible" | "ineligible";

/**
 * How the household ties to California. Asked only when a CA-home program
 * would unlock. Work address alone is never `ca_home`.
 */
export type ResidencyTie =
  | "ca_home"
  | "out_of_state_ca_work"
  | "out_of_state"
  | "visitor";

/** Why work/earnings stopped or dropped recently – gates EDD wage-replacement programs. */
export type WorkDisruption = "job_loss" | "health" | "family_care" | "none";

/**
 * How this household relates to the utility meter (asked after a bill in the
 * user's name, only when CARE / FERA / AMP would otherwise be offered).
 * Street address is never stored.
 */
export type MeterSharing = "own" | "shared" | "landlord_bill";

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
  /** Federal, California-side (state/county/utility), or jointly funded. */
  jurisdiction: ProgramJurisdiction;
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
  /**
   * MyFirstEV-style: needs California residency / a California address.
   * Asked only when this would unlock the next offer wave.
   */
  requiresCaResidency?: boolean;
  /**
   * MyFirstEV-style: shopping for an EV (or hydrogen ZEV) this year.
   * Asked after CA residency when that would unlock the offer.
   */
  requiresBuyingEvThisYear?: boolean;
  /**
   * MyFirstEV: first-time zero-emission vehicle buyer / lessee.
   * Asked after buying-EV intent when that would unlock the offer.
   */
  requiresFirstTimeZev?: boolean;
  /**
   * E-bike rebates: shopping for a pedal e-bike (not a scooter / e-moto).
   * Biggest yes/no disqualifier across remaining CA e-bike programs.
   */
  requiresBuyingEbikeThisYear?: boolean;
  /**
   * Clean Cars 4 All / DCAP mobility option: must retire (scrap) an older vehicle.
   * Asked only when that would unlock the $7,500 e-bike path.
   */
  requiresVehicleRetirement?: boolean;
  /**
   * County-limited programs (511 Contra Costa, Ava Bike Electric). ZIP is asked
   * when any such program would otherwise enter the queue.
   */
  eligibleCounties?: string[];
  /** CalWORKs / WIC-style: needs a child under 18 or pregnancy in the household. */
  requiresChildInHousehold?: boolean;
  /**
   * Foster Youth Tax Credit: former foster youth (typically ages 18–25).
   * Asked only when that would unlock the next offer wave.
   */
  requiresFosterYouth?: boolean;
  /**
   * Refugee Cash Assistance: refugee, asylee, or similarly eligible newcomer.
   * Asked only when that would unlock the next offer wave (after citizen /
   * eligible-immigrant Yes – US citizens who are not refugees should tap No).
   */
  requiresRefugeeOrAsylee?: boolean;
  /**
   * Medical Baseline: a resident needs extra energy for a qualifying medical
   * condition or device. Asked only when that would unlock the next offer.
   */
  requiresMedicalDeviceOrCondition?: boolean;
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
   * Offered on “No” or “Prefer not to say” – decline does not treat the
   * household as confirmed ineligible, and citizen-gated programs stay hidden.
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
  /**
   * Utility-bills multiselect gate finished (Done). Until then, programs that
   * need an account in the user's name stay locked out of the queue.
   */
  utilityBillsAsked: boolean;
  /**
   * Bill types in the user's name (draft while on has_utility_bills; final
   * after Done). May include the sentinel `"none"`.
   */
  billsInMyName: string[];
  /**
   * True when the user finished the utility-bills gate with None.
   * Kept for older call sites; prefer billsInMyName + utilityBillsAsked.
   */
  billNotInMyName: boolean;
  /**
   * Shared / landlord meter follow-up. null = not asked.
   * own = just this household; shared = another household on this meter;
   * landlord_bill = landlord sends a separate bill (submeter).
   */
  meterSharing: MeterSharing | null;
  /**
   * PG&E shut-off / fire-threat pre-check (map gbrp_eligible).
   * null = not asked; true/false after opt-in lookup or decline.
   * Street address is never persisted – only this flag. A ≥90% address
   * guess that PG&E marks ineligible is stored as false (offer hidden).
   */
  inShutoffZone: boolean | null;
  /**
   * Transient PG&E address matches while the user picks one.
   * Cleared after selection; do not log or keep long-term.
   */
  shutoffAddressChoices: Array<{
    address: string;
    gbrpEligible: boolean;
  }> | null;
  /**
   * California home vs out-of-state / visitor / CA worker. Source of truth for
   * CA-home gates. null = not asked yet.
   */
  residencyTie: ResidencyTie | null;
  /**
   * Derived from residencyTie for older call sites: true only for ca_home.
   * Prefer residencyTie in new code.
   */
  isCaResident: boolean | null;
  /** Shopping for an EV this year – gates requiresBuyingEvThisYear programs. */
  buyingEvThisYear: boolean | null;
  /** First-time ZEV buyer – gates requiresFirstTimeZev programs. */
  firstTimeZev: boolean | null;
  /** Shopping for a pedal e-bike – gates requiresBuyingEbikeThisYear programs. */
  buyingEbikeThisYear: boolean | null;
  /** Willing to scrap an older car – gates requiresVehicleRetirement programs. */
  wouldRetireVehicle: boolean | null;
  /** Kids under 18 or pregnancy – gates requiresChildInHousehold programs. */
  hasChildInHousehold: boolean | null;
  /** Former foster youth – gates requiresFosterYouth programs. */
  isFosterYouth: boolean | null;
  /**
   * Refugee / asylee / RCA-eligible newcomer – gates requiresRefugeeOrAsylee.
   * null = not asked.
   */
  isRefugeeOrAsylee: boolean | null;
  /**
   * Qualifying medical condition or device for extra energy (Medical Baseline).
   * null = not asked.
   */
  hasMedicalDeviceOrCondition: boolean | null;
  /** Aged 65+ / blind / disabled – gates requiresAgedBlindOrDisabled programs. */
  hasAgedBlindOrDisabled: boolean | null;
  /** Job loss / health / family-care / none – gates requiresWorkDisruption programs. */
  workDisruption: WorkDisruption | null;
  /**
   * Lived or worked in a declared disaster area during an open D-CalFresh
   * window. Only asked while a window is offerable. Yes / No answer directly;
   * Not sure confirms via a residence-or-work ZIP check (not stored as home ZIP).
   */
  inDisasterArea: boolean | null;
  /**
   * Home ZIP – asked only when a county-gated program (CMSP, local e-bike
   * rebates) would enter the queue. null = not asked; "" = skipped; otherwise a
   * 5-digit ZIP.
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
  /** User said STOP – pauses reminders + reopen alerts until they message again. */
  remindersStopped: boolean;
  /**
   * Opt-in to be texted when a waitlisted / paused / closed program they
   * qualify for starts accepting applications. null = not asked yet.
   */
  reopenNotifyOptIn: boolean | null;
  /** Held program ids they qualified for when they opted in (or last finish). */
  reopenWatchProgramIds: string[];
  /**
   * Immigration answer saved only when reopen notify is on – needed to
   * re-check CFAP / RCA / CalFresh-style gates without re-asking.
   */
  savedImmigrationStatus: SavedImmigrationStatus | null;
  awaitingConfirm: "stop" | "erase" | null;
  /** Most recent screen prompt (text + keyboard) for feedback replay. */
  lastBotMessage: LastBotMessage | null;
  /** Campaign from QR / share /start payload – used for partner attribution. */
  campaignId: string | null;
  /**
   * Ordered experience screens seen this journey (tree location or offer:programId).
   * Used for percent-through / dropout analytics; reset on /start.
   */
  screensSeen: string[];
  /** When the current experience screen was shown – dwell = now − this. */
  screenShownAt: string | null;
  /**
   * Snapshots taken before each tree-progressing answer so Back can erase the
   * last collected fact / offer decision (Application Guide item, skip, etc.).
   */
  undoStack?: Array<{
    stateJson: string;
    immigration: "eligible" | "ineligible" | "declined" | null;
  }>;
  createdAt: string;
  updatedAt: string;
}
