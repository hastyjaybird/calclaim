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

export interface Program {
  id: string;
  name: string;
  category: ProgramCategory;
  oneLiner: string;
  maxBenefit: string;
  applyUrl: string;
  deadlines: Deadline[];
  applySteps: string[];
  docsNeeded: DocId[];
  docsReusableFromGate: DocId[];
  timeToMoneyDays: number;
  branches: Branch[];
  yesOrder: number;
  noOrder: number;
  gateFeeder?: boolean;
  incomeGate?: "careBand" | "feraBand" | "careOrFeraBand";
  requiresPastDue?: boolean;
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

export interface SessionState {
  telegramUserId: number;
  step: StepId;
  branch: Branch | null;
  language: "en";
  householdSize: number | null;
  incomeBand: IncomeBand | null;
  pastDue: boolean | null;
  docsInHand: DocId[];
  queue: string[];
  queueIndex: number;
  alreadyOn: string[];
  items: NextStepsItem[];
  remindersEnabled: boolean;
  awaitingConfirm: "stop" | "erase" | null;
  createdAt: string;
  updatedAt: string;
}
