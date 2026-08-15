import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import { loadPrograms } from "./load.js";
import type { Program, ProgramCategory } from "./types.js";

/**
 * Requirements matrix: the operational "what does it actually take to finish
 * this application" layer that sits beside programs.json. The bot uses
 * difficulty scores to order the Application Guide PDF; the rest of the matrix
 * (eligibility tags, unlock graph, review status) is for the developer page.
 */

export type InterviewLevel =
  | "none"
  | "phone_optional"
  | "phone_required"
  | "appointment_required"
  | "in_person_required"
  | "home_assessment";

export type ReviewStatus =
  | "needs_review"
  | "verified_online"
  | "signed_off_by_program";

export type DifficultyTier = "easy" | "moderate" | "hard";

/**
 * Whether a program can actually be applied for today. Mostly derived – from
 * library deadlines and live disaster windows – because a hand-maintained flag
 * is exactly the kind of thing that goes stale and starts advertising a closed
 * program. Only `open`, `paused`, and `closed` can be pinned by hand.
 */
export type AvailabilityStatus =
  | "open"
  | "window_open"
  | "seasonal"
  | "deadline_soon"
  | "deadline_passed"
  | "dormant"
  | "paused"
  | "closed";

export type AvailabilityOverride = "open" | "paused" | "closed";

export interface Availability {
  status: AvailabilityStatus;
  label: string;
  /** A few words that fit under the badge in a table cell. */
  short: string;
  /** The full sentence, shown when the cell is expanded and in the CSV. */
  detail: string;
  /** True when a human pinned the status instead of letting it compute. */
  overridden: boolean;
}

export interface ReviewRef {
  label: string;
  url: string;
}

export interface ProgramRequirements {
  eligibility: string[];
  documents: string[];
  interview: InterviewLevel;
  /** Programs this one makes you categorically eligible for. */
  unlocks: string[];
  /** Programs you generally need first before this one is reachable. */
  prerequisites: string[];
  /** Set to pin a tier when the computed score reads wrong. */
  difficultyOverride: DifficultyTier | null;
  /** Set to pin availability when you know something the library dates do not. */
  availabilityOverride: AvailabilityOverride | null;
  /** Why it is paused/closed, or any caveat worth showing next to the status. */
  availabilityNote: string;
  reviewStatus: ReviewStatus;
  confidencePct: number | null;
  reviewRefs: ReviewRef[];
  notes: string;
  lastReviewedAt: string | null;
  reviewedBy: string | null;
}

interface RequirementsFile {
  version: string;
  notes: string;
  programs: Record<string, ProgramRequirements>;
}

export interface VocabItem {
  id: string;
  /** Full wording, used in the edit checklists and CSV export. */
  label: string;
  /** Compact wording for the summary chips, which have to fit in a table cell. */
  short: string;
  group: string;
}

/**
 * Controlled vocabulary for eligibility rules. Kept as tags rather than prose
 * so the matrix can be filtered and so two programs with the same rule read
 * identically.
 */
export const ELIGIBILITY_TAGS: readonly VocabItem[] = [
  { id: "ca_residency", label: "Lives in California", short: "CA resident", group: "Residency" },
  {
    id: "county_residency",
    label: "Lives in the applying county",
    short: "County resident",
    group: "Residency",
  },
  {
    id: "lives_at_home",
    label: "Lives at home, not in a facility",
    short: "Lives at home",
    group: "Residency",
  },
  {
    id: "lives_at_service_address",
    label: "Lives at the address the discount or service applies to",
    short: "Lives at service address",
    group: "Residency",
  },
  {
    id: "income_limit",
    label: "Household income under a program limit",
    short: "Income limit",
    group: "Money",
  },
  { id: "asset_limit", label: "Resource / asset limit applies", short: "Asset limit", group: "Money" },
  {
    id: "categorical_or_income",
    label: "Qualifies by income OR by enrollment in a listed program",
    short: "Income or program",
    group: "Money",
  },
  {
    id: "earned_income_required",
    label: "Must have earned income",
    short: "Earned income",
    group: "Money",
  },
  {
    id: "child_under_18",
    label: "Child under 18 in the household",
    short: "Child under 18",
    group: "Household",
  },
  { id: "child_under_6", label: "Child under 6", short: "Child under 6", group: "Household" },
  { id: "child_under_5", label: "Infant or child under 5", short: "Child under 5", group: "Household" },
  {
    id: "pregnant_or_postpartum",
    label: "Pregnant, postpartum, or breastfeeding",
    short: "Pregnant / postpartum",
    group: "Household",
  },
  {
    id: "fera_household_3_plus",
    label: "Household of 3 or more",
    short: "Household of 3+",
    group: "Household",
  },
  {
    id: "one_per_household",
    label: "One benefit per household",
    short: "One per household",
    group: "Household",
  },
  { id: "age_65_plus", label: "Age 65 or older", short: "Age 65+", group: "Age & disability" },
  { id: "age_21_to_64", label: "Age 21 to 64", short: "Age 21–64", group: "Age & disability" },
  {
    id: "blind_or_disabled",
    label: "Blind or has a qualifying disability",
    short: "Blind / disabled",
    group: "Age & disability",
  },
  {
    id: "medical_device_or_condition",
    label: "Medical equipment or condition needing extra energy",
    short: "Medical energy need",
    group: "Age & disability",
  },
  {
    id: "practitioner_certification",
    label: "Licensed practitioner must certify the claim",
    short: "Doctor certifies",
    group: "Age & disability",
  },
  {
    id: "care_needs_assessment",
    label: "County assesses hours of care needed",
    short: "Care assessment",
    group: "Age & disability",
  },
  {
    id: "nutrition_risk",
    label: "Nutrition or health risk screened at the appointment",
    short: "Nutrition screening",
    group: "Age & disability",
  },
  {
    id: "citizen_or_eligible_immigrant",
    label: "Citizen or eligible immigration status",
    short: "Eligible status",
    group: "Status",
  },
  { id: "ssn_or_itin", label: "SSN or ITIN required", short: "SSN or ITIN", group: "Status" },
  {
    id: "ssi_denied_for_status",
    label: "Denied SSI solely because of immigration status",
    short: "SSI denied for status",
    group: "Status",
  },
  {
    id: "no_other_coverage",
    label: "Not eligible for other comparable aid or coverage",
    short: "No other aid",
    group: "Status",
  },
  {
    id: "not_enrolled_elsewhere",
    label: "Not already enrolled in the ongoing version of this benefit",
    short: "Not already enrolled",
    group: "Status",
  },
  {
    id: "medi_cal_eligible",
    label: "Must be Medi-Cal eligible",
    short: "Medi-Cal eligible",
    group: "Status",
  },
  {
    id: "participating_utility",
    label: "Served by a participating utility",
    short: "Participating utility",
    group: "Utility",
  },
  {
    id: "account_in_your_name",
    label: "Bill or account in the applicant's name",
    short: "Account in your name",
    group: "Utility",
  },
  {
    id: "no_shared_meter",
    label:
      "Does not share a meter with another household (a unit with its own submeter still qualifies)",
    short: "Own meter",
    group: "Utility",
  },
  {
    id: "not_master_metered",
    label:
      "Not on a master-metered account (submetered tenants billed by a landlord are also out)",
    short: "Not master-metered",
    group: "Utility",
  },
  {
    id: "usage_under_baseline_cap",
    label: "Monthly electric usage under the program baseline cap",
    short: "Under usage cap",
    group: "Utility",
  },
  {
    id: "past_due_balance",
    label: "Qualifying past-due balance",
    short: "Past-due balance",
    group: "Utility",
  },
  {
    id: "enrolled_care_or_fera",
    label: "Enrolled in CARE or FERA",
    short: "CARE / FERA enrolled",
    group: "Utility",
  },
  {
    id: "payment_plan_compliance",
    label: "Must stay current on payments to keep the benefit",
    short: "Stay current",
    group: "Utility",
  },
  {
    id: "dwelling_eligibility",
    label: "Home itself must qualify (age, type, prior work)",
    short: "Home qualifies",
    group: "Utility",
  },
  {
    id: "renter_landlord_permission",
    label: "Owner sign-off needed if renting",
    short: "Owner sign-off",
    group: "Utility",
  },
  {
    id: "job_loss_no_fault",
    label: "Out of work through no fault of your own",
    short: "No-fault job loss",
    group: "Work",
  },
  {
    id: "base_period_wages",
    label: "Enough covered wages in the EDD base period",
    short: "Base-period wages",
    group: "Work",
  },
  {
    id: "able_available_seeking_work",
    label: "Able, available, and looking for work",
    short: "Seeking work",
    group: "Work",
  },
  {
    id: "unable_to_work_8_days",
    label: "Unable to work for at least 8 days",
    short: "Out 8+ days",
    group: "Work",
  },
  {
    id: "qualifying_family_event",
    label: "New child, or a seriously ill family member",
    short: "Family event",
    group: "Work",
  },
  {
    id: "biweekly_certification",
    label: "Must re-certify every two weeks",
    short: "Certify biweekly",
    group: "Work",
  },
  {
    id: "work_registration",
    label: "Employable adults must register for work services",
    short: "Work registration",
    group: "Work",
  },
  {
    id: "declared_disaster_area",
    label: "Lived or worked in the declared disaster area",
    short: "In disaster area",
    group: "Timing",
  },
  {
    id: "disaster_related_loss",
    label: "Had a disaster-related loss or expense",
    short: "Disaster loss",
    group: "Timing",
  },
  {
    id: "open_application_window",
    label: "County application window must be open",
    short: "Window open",
    group: "Timing",
  },
  {
    id: "seasonal_window",
    label: "Seasonal or funding-limited window",
    short: "Seasonal window",
    group: "Timing",
  },
  {
    id: "must_file_tax_return",
    label: "Must file a tax return to claim it",
    short: "File tax return",
    group: "Tax",
  },
  {
    id: "not_tax_dependent",
    label: "Not claimed as a dependent on another person's tax return (except spouse)",
    short: "Not a tax dependent",
    group: "Tax",
  },
  {
    id: "qualifies_for_caleitc",
    label: "Must also qualify for CalEITC",
    short: "CalEITC first",
    group: "Tax",
  },
  {
    id: "one_per_person",
    label: "One benefit per person for the life of the program",
    short: "One per person",
    group: "Household",
  },
  {
    id: "buying_ev_this_year",
    label: "Planning to buy an EV or hydrogen vehicle this year",
    short: "Buying EV this year",
    group: "Vehicle",
  },
  {
    id: "first_time_zev",
    label: "First-time zero-emission vehicle buyer or lessee",
    short: "First-time ZEV",
    group: "Vehicle",
  },
  {
    id: "participating_oem",
    label: "Must buy or lease through a participating manufacturer",
    short: "Participating OEM",
    group: "Vehicle",
  },
  {
    id: "qualifying_zev",
    label: "Battery-electric or hydrogen fuel-cell vehicle (not a plug-in hybrid)",
    short: "BEV or FCEV",
    group: "Vehicle",
  },
  {
    id: "buying_ebike_this_year",
    label: "Planning to buy a pedal e-bike this year (not a scooter)",
    short: "Buying e-bike",
    group: "Vehicle",
  },
  {
    id: "pedal_ebike",
    label: "Class 1–3 e-bike with working pedals (not a scooter or e-moto)",
    short: "Pedal e-bike",
    group: "Vehicle",
  },
  {
    id: "retire_older_vehicle",
    label: "Must retire (scrap) an eligible older vehicle",
    short: "Scrap old car",
    group: "Vehicle",
  },
  {
    id: "foster_youth_18_25",
    label: "Former foster youth age 18–25 who was in care on/after 18",
    short: "Foster youth 18–25",
    group: "Household",
  },
  {
    id: "school_age_child",
    label: "School-age child in the household (Sun Bucks / CFAP path)",
    short: "School-age child",
    group: "Household",
  },
  {
    id: "smart_device",
    label: "Compatible Nest / smart thermostat or eligible EV charger",
    short: "Smart device",
    group: "Utility",
  },
  {
    id: "fire_threat_district",
    label: "Home in a designated fire-threat / high-risk outage area",
    short: "Fire-threat district",
    group: "Utility",
  },
  {
    id: "scrap_vehicle",
    label: "Must scrap or retire a qualifying older vehicle",
    short: "Scrap vehicle",
    group: "Vehicle",
  },
  {
    id: "preowned_ev",
    label: "Buying a qualifying pre-owned electric vehicle",
    short: "Pre-owned EV",
    group: "Vehicle",
  },
  {
    id: "refugee_or_asylee",
    label: "Refugee, asylee, or other RCA-eligible immigration status",
    short: "Refugee / asylee",
    group: "Status",
  },
  {
    id: "rents_home",
    label: "Pays rent for a California residence",
    short: "Renter",
    group: "Household",
  },
  {
    id: "retirement_contribution",
    label: "Contributes to a qualifying retirement plan (IRA / 401k)",
    short: "Retirement contrib.",
    group: "Tax",
  },
  {
    id: "covered_ca_plan",
    label: "Enrolled or enrolling in Covered California marketplace coverage",
    short: "Covered CA plan",
    group: "Status",
  },
  {
    id: "work_credits_ssdi",
    label: "Enough Social Security work credits for disability insurance",
    short: "SSDI work credits",
    group: "Age & disability",
  },
];

/**
 * Documents the applicant has to physically produce. Third-party documents are
 * scored double in the difficulty math – waiting on a doctor or a landlord is
 * what actually stalls an application.
 */
export const DOCUMENT_TAGS: readonly VocabItem[] = [
  { id: "none", label: "No documents up front", short: "None", group: "None" },
  { id: "photoId", label: "Photo ID", short: "Photo ID", group: "Identity" },
  { id: "ssnProof", label: "Social Security number or card", short: "SSN", group: "Identity" },
  {
    id: "immigrationDocs",
    label: "Immigration status documents",
    short: "Immigration docs",
    group: "Identity",
  },
  {
    id: "residencyProof",
    label: "Proof of California / county residence",
    short: "Residency",
    group: "Identity",
  },
  {
    id: "householdProof",
    label: "Proof of household members or relationship",
    short: "Household",
    group: "Identity",
  },
  {
    id: "birthOrPregnancyProof",
    label: "Birth certificate or proof of pregnancy",
    short: "Birth / pregnancy",
    group: "Identity",
  },
  {
    id: "incomeProof",
    label: "Pay stubs or benefit award letter (income path)",
    short: "Pay stubs",
    group: "Money",
  },
  { id: "taxForms", label: "W-2s and 1099s", short: "W-2 / 1099", group: "Money" },
  {
    id: "taxReturn",
    label: "Filed tax return (required to claim the credit)",
    short: "Tax return",
    group: "Money",
  },
  { id: "assetStatements", label: "Bank or asset statements", short: "Bank / assets", group: "Money" },
  { id: "utilityBill", label: "Recent utility bill", short: "Utility bill", group: "Utility" },
  {
    id: "utilityAccountNumber",
    label: "Utility account number",
    short: "Account number",
    group: "Utility",
  },
  {
    id: "pastDueNotice",
    label: "Past-due balance notice",
    short: "Past-due notice",
    group: "Utility",
  },
  {
    id: "categoricalProof",
    label:
      "Award letter proving enrollment (Medi-Cal / CalFresh / SSI / CalWORKs / WIC) – categorical path",
    short: "Award letter",
    group: "Third party",
  },
  { id: "ssiDenialLetter", label: "SSI denial notice", short: "SSI denial", group: "Third party" },
  {
    id: "medicalCertification",
    label: "Practitioner certification form",
    short: "Doctor's form",
    group: "Third party",
  },
  {
    id: "disabilityRecords",
    label: "Medical records or disability evidence",
    short: "Medical records",
    group: "Third party",
  },
  {
    id: "employerInfo",
    label: "Employer name, dates, and wages",
    short: "Employer info",
    group: "Third party",
  },
  {
    id: "landlordConsent",
    label: "Landlord or property owner consent",
    short: "Landlord consent",
    group: "Third party",
  },
];

/** Docs that depend on someone else signing or mailing something. */
const THIRD_PARTY_DOCS = new Set(
  DOCUMENT_TAGS.filter((d) => d.group === "Third party").map((d) => d.id),
);

/**
 * Document alternatives: listing every member on a program means "bring any
 * one of these," not all of them. Stored as flat ids in the JSON so editors
 * can still tick individual boxes; the coverage grid and difficulty score
 * collapse a full match into a single OR column / path.
 */
export interface DocumentOrGroup {
  id: string;
  members: readonly string[];
  label: string;
  short: string;
}

export const DOCUMENT_OR_GROUPS: readonly DocumentOrGroup[] = [
  {
    id: "award_or_income",
    members: ["categoricalProof", "incomeProof"],
    label:
      "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC) OR pay stubs / benefit letter",
    short: "Award letter OR pay stubs",
  },
];

export interface ResolvedDocuments {
  /** Individual docs that are required on their own (not part of a matched OR). */
  required: string[];
  /** OR-group ids where every member is listed on the program. */
  orGroups: string[];
}

/** Collapse full OR-group matches; leftover members stay as required singles. */
export function resolveDocumentRequirements(
  documents: readonly string[],
): ResolvedDocuments {
  const docs = documents.filter((d) => d !== "none");
  const matchedGroups: string[] = [];
  const consumed = new Set<string>();

  for (const group of DOCUMENT_OR_GROUPS) {
    if (group.members.every((m) => docs.includes(m))) {
      matchedGroups.push(group.id);
      for (const m of group.members) consumed.add(m);
    }
  }

  return {
    required: docs.filter((d) => !consumed.has(d)),
    orGroups: matchedGroups,
  };
}

/** Labels stay short because they render inside a table cell dropdown. */
export const INTERVIEW_LEVELS: readonly { id: InterviewLevel; label: string; weight: number }[] = [
  { id: "none", label: "No interview", weight: 0 },
  { id: "phone_optional", label: "Phone if questions", weight: 1.5 },
  { id: "phone_required", label: "Phone required", weight: 3 },
  { id: "appointment_required", label: "Appointment", weight: 3.5 },
  { id: "in_person_required", label: "In person", weight: 4.5 },
  { id: "home_assessment", label: "Home visit", weight: 5 },
];

export const REVIEW_STATUSES: readonly { id: ReviewStatus; label: string }[] = [
  { id: "needs_review", label: "Needs review" },
  { id: "verified_online", label: "Verified online" },
  { id: "signed_off_by_program", label: "Signed off" },
];

export const DIFFICULTY_TIERS: readonly { id: DifficultyTier; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "moderate", label: "Moderate" },
  { id: "hard", label: "Hard" },
];

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  open: "Open",
  window_open: "Window open",
  seasonal: "Seasonal",
  deadline_soon: "Deadline soon",
  deadline_passed: "Deadline passed",
  dormant: "Dormant",
  paused: "Paused",
  closed: "Closed",
};

export const AVAILABILITY_OVERRIDES: readonly { id: AvailabilityOverride; label: string }[] = [
  { id: "open", label: "Open (pin)" },
  { id: "paused", label: "Paused / waitlist" },
  { id: "closed", label: "Closed" },
];

/** A dated deadline inside this many days flips a program to "deadline soon". */
const DEADLINE_SOON_DAYS = 60;

/**
 * Documents and interviews carry the weight because they are what actually
 * stalls an application. Eligibility rules are only a tiebreaker – a long rule
 * list decides *whether* you qualify, not how hard the paperwork is.
 */
const RULE_WEIGHT = 0.2;

/** Tier boundaries. Tuned so no-interview / few-document programs land easy. */
const EASY_MAX = 6.5;
const MODERATE_MAX = 10;

const REQUIREMENTS_PATH = path.join(LIBRARY_DIR, "program-requirements.json");

const ELIGIBILITY_IDS = new Set(ELIGIBILITY_TAGS.map((t) => t.id));
const DOCUMENT_IDS = new Set(DOCUMENT_TAGS.map((t) => t.id));
const INTERVIEW_IDS = new Set(INTERVIEW_LEVELS.map((t) => t.id));
const REVIEW_IDS = new Set(REVIEW_STATUSES.map((t) => t.id));
const TIER_IDS = new Set(DIFFICULTY_TIERS.map((t) => t.id));
const AVAILABILITY_OVERRIDE_IDS = new Set(AVAILABILITY_OVERRIDES.map((t) => t.id));

export function emptyRequirements(): ProgramRequirements {
  return {
    eligibility: [],
    documents: [],
    interview: "none",
    unlocks: [],
    prerequisites: [],
    difficultyOverride: null,
    availabilityOverride: null,
    availabilityNote: "",
    reviewStatus: "needs_review",
    confidencePct: null,
    reviewRefs: [],
    notes: "",
    lastReviewedAt: null,
    reviewedBy: null,
  };
}

let fileCache: RequirementsFile | null = null;
let fileCacheMtimeMs = -1;

/**
 * Cached by mtime rather than forever: this file is also hand-edited and
 * committed, so a stale cache would let the next dev-page save overwrite a
 * change made in the editor.
 */
function readFile(): RequirementsFile {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(REQUIREMENTS_PATH).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (fileCache && mtimeMs === fileCacheMtimeMs) return fileCache;

  try {
    const parsed = JSON.parse(readFileSync(REQUIREMENTS_PATH, "utf8")) as RequirementsFile;
    fileCache = {
      version: parsed.version ?? "unversioned",
      notes: parsed.notes ?? "",
      programs: parsed.programs ?? {},
    };
  } catch {
    // A missing or unparseable file must not take the dev page down – every
    // program just shows up empty and flagged for review.
    fileCache = { version: "unversioned", notes: "", programs: {} };
  }
  fileCacheMtimeMs = mtimeMs;
  return fileCache;
}

function writeFile(file: RequirementsFile): void {
  const tmp = `${REQUIREMENTS_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, REQUIREMENTS_PATH);
  fileCache = file;
  try {
    fileCacheMtimeMs = statSync(REQUIREMENTS_PATH).mtimeMs;
  } catch {
    fileCacheMtimeMs = -1;
  }
}

function requirementsFor(programId: string): ProgramRequirements {
  return { ...emptyRequirements(), ...(readFile().programs[programId] ?? {}) };
}

/** Bot / cron-safe read of one program's requirements row. */
export function getProgramRequirements(programId: string): ProgramRequirements {
  return requirementsFor(programId);
}

/** Offer-card line when a renter can apply but the owner must sign off. */
export const OWNER_SIGN_OFF_IF_RENTING_LINE = "Owner sign-off if renting.";

export function ownerSignOffIfRentingLine(programId: string): string | null {
  return getProgramRequirements(programId).eligibility.includes(
    "renter_landlord_permission",
  )
    ? OWNER_SIGN_OFF_IF_RENTING_LINE
    : null;
}

/** Difficulty score for report ordering (bot-safe read of the requirements matrix). */
export function programDifficulty(programId: string): DifficultyResult {
  const program = loadPrograms().find((p) => p.id === programId);
  const entry = requirementsFor(programId);
  return scoreDifficulty(
    { formFillMinutes: program?.formFillMinutes ?? 0 },
    entry,
  );
}

export interface DifficultyResult {
  score: number;
  tier: DifficultyTier;
  /** Human-readable breakdown shown in the UI tooltip. */
  breakdown: string;
}

export function scoreDifficulty(
  program: Pick<Program, "formFillMinutes">,
  entry: ProgramRequirements,
): DifficultyResult {
  const resolved = resolveDocumentRequirements(entry.documents);
  const pathCount = resolved.required.length + resolved.orGroups.length;
  let docPoints = 0;
  for (const d of resolved.required) {
    docPoints += THIRD_PARTY_DOCS.has(d) ? 2 : 1;
  }
  for (const groupId of resolved.orGroups) {
    const group = DOCUMENT_OR_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;
    // Score the harder alternative once (award letter is third-party; pay stubs are not).
    docPoints += Math.max(...group.members.map((m) => (THIRD_PARTY_DOCS.has(m) ? 2 : 1)));
  }
  const interviewPoints =
    INTERVIEW_LEVELS.find((l) => l.id === entry.interview)?.weight ?? 0;
  const formPoints = (program.formFillMinutes ?? 0) / 15;
  const rulePoints = entry.eligibility.length * RULE_WEIGHT;
  const prereqPoints = entry.prerequisites.length > 0 ? 1.5 : 0;
  const score =
    Math.round((docPoints + interviewPoints + formPoints + rulePoints + prereqPoints) * 10) / 10;

  const computed: DifficultyTier =
    score <= EASY_MAX ? "easy" : score <= MODERATE_MAX ? "moderate" : "hard";

  const docCountLabel = resolved.orGroups.length
    ? `${pathCount} doc path(s) (incl. OR alternatives) = ${docPoints}`
    : `${pathCount} doc(s) = ${docPoints}`;

  return {
    score,
    tier: entry.difficultyOverride ?? computed,
    breakdown: [
      docCountLabel,
      `interview = ${interviewPoints}`,
      `${program.formFillMinutes ?? 0} min form = ${Math.round(formPoints * 10) / 10}`,
      `${entry.eligibility.length} rule(s) = ${Math.round(rulePoints * 10) / 10}`,
      prereqPoints ? `prerequisite = ${prereqPoints}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** Live disaster windows, passed in so this module never imports the DB layer. */
export interface LiveWindowSummary {
  label: string;
  counties: string[];
  lastApplyDay: string | null;
}

export interface AvailabilityContext {
  /** YYYY-MM-DD; defaults to today. */
  today?: string;
  /** Published windows that have not closed, including ones not yet open. */
  disasterWindows?: LiveWindowSummary[];
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const ms = Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Library deadline labels carry parenthetical caveats meant for the full card.
 * The status cell is a few lines wide, so drop the aside and cap the length.
 */
function shortDeadlineLabel(label: string): string {
  const trimmed = label.replace(/\s*\([^)]*\)\s*/g, " ").trim() || label.trim();
  if (trimmed.length <= 56) return trimmed;
  const cut = trimmed.slice(0, 56);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function computeAvailability(
  program: Pick<Program, "deadlines" | "requiresActiveDisasterWindow">,
  entry: ProgramRequirements,
  ctx: AvailabilityContext = {},
): Availability {
  const today = ctx.today ?? todayYmd();
  const note = entry.availabilityNote.trim();
  const build = (
    status: AvailabilityStatus,
    short: string,
    detail: string,
    overridden = false,
  ): Availability => ({
    status,
    label: AVAILABILITY_LABELS[status],
    short,
    detail: note ? `${detail} ${note}` : detail,
    overridden,
  });

  if (entry.availabilityOverride) {
    const status = entry.availabilityOverride;
    const detail =
      status === "closed"
        ? "Marked closed by hand – pull it from the offer queue."
        : status === "paused"
          ? "Marked paused or waitlisted by hand."
          : "Marked open by hand, overriding the computed status.";
    return build(status, note || "set by hand", detail, true);
  }

  // Disaster-gated programs exist only around a county application window, so
  // the published window table decides, not the library.
  if (program.requiresActiveDisasterWindow) {
    const windows = ctx.disasterWindows ?? [];
    if (!windows.length) {
      return build(
        "dormant",
        "no county window open",
        "No county application window is open or approved, so the offer card stays hidden. This is the expected state most of the year.",
      );
    }
    const first = windows[0];
    const where = first.counties.length ? first.counties.join(", ") : first.label;
    const until = first.lastApplyDay ? `, apply through ${first.lastApplyDay}` : "";
    const more = windows.length > 1 ? ` (+${windows.length - 1} more)` : "";
    return build(
      "window_open",
      first.lastApplyDay ? `${where} · through ${first.lastApplyDay}` : where,
      `Live in ${where}${until}${more}.`,
    );
  }

  const dated = program.deadlines
    .filter((d): d is { label: string; date: string } => typeof d.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = dated.filter((d) => d.date >= today);

  if (dated.length && !upcoming.length) {
    const last = dated[dated.length - 1];
    const ago = plural(daysBetween(last.date, today), "day");
    return build(
      "deadline_passed",
      `${last.date} · ${ago} ago`,
      `Every library deadline is in the past – "${shortDeadlineLabel(last.label)}" was ${last.date}, ${ago} ago. Roll the date forward to the current cycle.`,
    );
  }

  const next = upcoming[0];
  if (next) {
    const days = daysBetween(today, next.date);
    if (days <= DEADLINE_SOON_DAYS) {
      return build(
        "deadline_soon",
        `${next.date} · ${plural(days, "day")} away`,
        `"${shortDeadlineLabel(next.label)}" is ${next.date} – ${plural(days, "day")} away.`,
      );
    }
  }

  if (entry.eligibility.includes("seasonal_window")) {
    return build(
      "seasonal",
      "county funding window",
      "Only open during a seasonal or funding-limited window that each county sets, so availability has to be checked locally.",
    );
  }

  const undated = program.deadlines.filter((d) => d.date == null).map((d) => d.label);
  if (next) {
    return build(
      "open",
      `next deadline ${next.date}`,
      `Accepting applications. Next deadline "${shortDeadlineLabel(next.label)}" on ${next.date}, ${plural(daysBetween(today, next.date), "day")} away.`,
    );
  }
  return build(
    "open",
    "no deadline",
    undated.length
      ? `Accepting applications. ${undated.join(" · ")}`
      : "Accepting applications year-round – no fixed deadline in the library.",
  );
}

export interface MatrixRow extends ProgramRequirements {
  id: string;
  name: string;
  category: ProgramCategory;
  oneLiner: string;
  applyUrl: string;
  librarySources: string[];
  deadlineCount: number;
  hasNullDeadline: boolean;
  formFillMinutes: number;
  timeToMoneyDays: number;
  difficultyScore: number;
  difficultyTier: DifficultyTier;
  difficultyBreakdown: string;
  availability: Availability;
  /** Reverse edges of `unlocks` – who gets you in the door here. */
  unlockedBy: string[];
  rank: number;
}

export interface MatrixSummary {
  byTier: Record<DifficultyTier, number>;
  byReview: Record<ReviewStatus, number>;
  byAvailability: Record<AvailabilityStatus, number>;
  /** Programs not accepting applications today – the number worth acting on. */
  notOpen: number;
  documented: number;
  total: number;
  avgConfidence: number | null;
}

export interface ProgramMatrix {
  version: string;
  notes: string;
  rows: MatrixRow[];
  summary: MatrixSummary;
  programIndex: { id: string; name: string; short: string }[];
  /** Document alternatives collapsed in the coverage grid and difficulty score. */
  documentOrGroups: readonly DocumentOrGroup[];
  vocab: {
    eligibility: readonly VocabItem[];
    documents: readonly VocabItem[];
    interview: readonly { id: InterviewLevel; label: string }[];
    reviewStatus: readonly { id: ReviewStatus; label: string }[];
    difficulty: readonly { id: DifficultyTier; label: string }[];
    availability: readonly { id: AvailabilityStatus; label: string }[];
    availabilityOverride: readonly { id: AvailabilityOverride; label: string }[];
  };
}

/**
 * Chip-sized program name: prefer a parenthesised acronym ("…(IHSS)" → "IHSS"),
 * otherwise drop the parenthetical ("AMP (Arrearage Management)" → "AMP").
 */
function shortProgramName(name: string): string {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (!m) return name;
  const inner = m[2];
  return /^[A-Z]{2,6}$/.test(inner) ? inner : m[1];
}

/** Programs ranked easiest to hardest, with derived columns filled in. */
export function buildProgramMatrix(ctx: AvailabilityContext = {}): ProgramMatrix {
  const programs = loadPrograms();
  const file = readFile();

  const rows: MatrixRow[] = programs.map((p) => {
    const entry = requirementsFor(p.id);
    const difficulty = scoreDifficulty(p, entry);
    return {
      ...entry,
      availability: computeAvailability(p, entry, ctx),
      id: p.id,
      name: p.name,
      category: p.category,
      oneLiner: p.oneLiner,
      applyUrl: p.applyUrl,
      librarySources: p.sources,
      deadlineCount: p.deadlines.length,
      hasNullDeadline: p.deadlines.some((d) => d.date == null),
      formFillMinutes: p.formFillMinutes,
      timeToMoneyDays: p.timeToMoneyDays,
      difficultyScore: difficulty.score,
      difficultyTier: difficulty.tier,
      difficultyBreakdown: difficulty.breakdown,
      unlockedBy: [],
      rank: 0,
    };
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const row of rows) {
    for (const target of row.unlocks) {
      byId.get(target)?.unlockedBy.push(row.id);
    }
  }

  const tierOrder: Record<DifficultyTier, number> = { easy: 0, moderate: 1, hard: 2 };
  rows.sort(
    (a, b) =>
      tierOrder[a.difficultyTier] - tierOrder[b.difficultyTier] ||
      a.difficultyScore - b.difficultyScore ||
      a.name.localeCompare(b.name),
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const summary: MatrixSummary = {
    byTier: { easy: 0, moderate: 0, hard: 0 },
    byReview: { needs_review: 0, verified_online: 0, signed_off_by_program: 0 },
    byAvailability: {
      open: 0,
      window_open: 0,
      seasonal: 0,
      deadline_soon: 0,
      deadline_passed: 0,
      dormant: 0,
      paused: 0,
      closed: 0,
    },
    notOpen: 0,
    documented: 0,
    total: rows.length,
    avgConfidence: null,
  };
  const confidences: number[] = [];
  for (const row of rows) {
    summary.byTier[row.difficultyTier] += 1;
    summary.byReview[row.reviewStatus] += 1;
    summary.byAvailability[row.availability.status] += 1;
    if (!isOpenNow(row.availability.status)) summary.notOpen += 1;
    if (row.eligibility.length || row.documents.length) summary.documented += 1;
    if (row.confidencePct != null) confidences.push(row.confidencePct);
  }
  if (confidences.length) {
    summary.avgConfidence = Math.round(
      confidences.reduce((a, b) => a + b, 0) / confidences.length,
    );
  }

  return {
    version: file.version,
    notes: file.notes,
    rows,
    summary,
    programIndex: programs.map((p) => ({
      id: p.id,
      name: p.name,
      short: shortProgramName(p.name),
    })),
    documentOrGroups: DOCUMENT_OR_GROUPS,
    vocab: {
      eligibility: ELIGIBILITY_TAGS,
      documents: DOCUMENT_TAGS,
      interview: INTERVIEW_LEVELS.map(({ id, label }) => ({ id, label })),
      reviewStatus: REVIEW_STATUSES,
      difficulty: DIFFICULTY_TIERS,
      availability: Object.entries(AVAILABILITY_LABELS).map(([id, label]) => ({
        id: id as AvailabilityStatus,
        label,
      })),
      availabilityOverride: AVAILABILITY_OVERRIDES,
    },
  };
}

/** Statuses where someone could apply today. Everything else needs a look. */
export function isOpenNow(status: AvailabilityStatus): boolean {
  return status === "open" || status === "window_open" || status === "deadline_soon";
}

/**
 * Waitlisted / paused / enrollment-closed – held out of the offer tree.
 * Users who qualify can opt in to be notified when these reopen.
 */
export function isHeldFromOffer(status: AvailabilityStatus): boolean {
  return status === "paused" || status === "closed";
}

/** Availability for a library program (mtime-aware requirements + override). */
export function programAvailability(
  program: Pick<Program, "id" | "deadlines" | "requiresActiveDisasterWindow">,
  ctx: AvailabilityContext = {},
): Availability {
  return computeAvailability(program, requirementsFor(program.id), ctx);
}

function uniqueFrom(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) throw new Error("Expected an array of ids");
  const out: string[] = [];
  for (const raw of value) {
    const id = String(raw);
    if (!allowed.has(id)) throw new Error(`Unknown id: ${id}`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function parseRefs(value: unknown): ReviewRef[] {
  if (!Array.isArray(value)) throw new Error("reviewRefs must be an array");
  if (value.length > 12) throw new Error("At most 12 references per program");
  return value.map((raw) => {
    const rec = raw as { label?: unknown; url?: unknown };
    const url = String(rec.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`Reference URL must start with http:// or https:// – got "${url}"`);
    }
    const label = String(rec.label ?? "").trim().slice(0, 160);
    return { label: label || new URL(url).hostname, url: url.slice(0, 600) };
  });
}

export type RequirementsPatch = Partial<Record<keyof ProgramRequirements, unknown>>;

/**
 * Apply a dev-page edit. Validation is strict because this writes straight into
 * a git-tracked library file – a bad id would show up as a silent blank cell.
 */
export function updateProgramRequirements(
  programId: string,
  patch: RequirementsPatch,
  ctx: AvailabilityContext = {},
): MatrixRow {
  const program = loadPrograms().find((p) => p.id === programId);
  if (!program) throw new Error(`Unknown program: ${programId}`);

  const programIds = new Set(loadPrograms().map((p) => p.id));
  const current = requirementsFor(programId);
  const next: ProgramRequirements = { ...current };

  if ("eligibility" in patch) next.eligibility = uniqueFrom(patch.eligibility, ELIGIBILITY_IDS);
  if ("documents" in patch) next.documents = uniqueFrom(patch.documents, DOCUMENT_IDS);
  if ("unlocks" in patch) {
    next.unlocks = uniqueFrom(patch.unlocks, programIds).filter((id) => id !== programId);
  }
  if ("prerequisites" in patch) {
    next.prerequisites = uniqueFrom(patch.prerequisites, programIds).filter(
      (id) => id !== programId,
    );
  }
  if ("interview" in patch) {
    const value = String(patch.interview);
    if (!INTERVIEW_IDS.has(value as InterviewLevel)) {
      throw new Error(`interview must be one of ${[...INTERVIEW_IDS].join("|")}`);
    }
    next.interview = value as InterviewLevel;
  }
  if ("reviewStatus" in patch) {
    const value = String(patch.reviewStatus);
    if (!REVIEW_IDS.has(value as ReviewStatus)) {
      throw new Error(`reviewStatus must be one of ${[...REVIEW_IDS].join("|")}`);
    }
    next.reviewStatus = value as ReviewStatus;
    next.lastReviewedAt = new Date().toISOString();
  }
  if ("difficultyOverride" in patch) {
    const raw = patch.difficultyOverride;
    if (raw == null || raw === "") {
      next.difficultyOverride = null;
    } else if (TIER_IDS.has(String(raw) as DifficultyTier)) {
      next.difficultyOverride = String(raw) as DifficultyTier;
    } else {
      throw new Error("difficultyOverride must be easy|moderate|hard or empty");
    }
  }
  if ("availabilityOverride" in patch) {
    const raw = patch.availabilityOverride;
    if (raw == null || raw === "") {
      next.availabilityOverride = null;
    } else if (AVAILABILITY_OVERRIDE_IDS.has(String(raw) as AvailabilityOverride)) {
      next.availabilityOverride = String(raw) as AvailabilityOverride;
    } else {
      throw new Error("availabilityOverride must be open|paused|closed or empty");
    }
  }
  if ("availabilityNote" in patch) {
    next.availabilityNote = String(patch.availabilityNote ?? "").slice(0, 600);
  }
  if ("confidencePct" in patch) {
    const raw = patch.confidencePct;
    if (raw == null || raw === "") {
      next.confidencePct = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error("confidencePct must be between 0 and 100");
      }
      next.confidencePct = Math.round(n);
    }
  }
  if ("reviewRefs" in patch) next.reviewRefs = parseRefs(patch.reviewRefs);
  if ("notes" in patch) next.notes = String(patch.notes ?? "").slice(0, 4000);
  if ("reviewedBy" in patch) {
    const who = String(patch.reviewedBy ?? "").trim().slice(0, 120);
    next.reviewedBy = who || null;
  }

  const file = readFile();
  writeFile({
    ...file,
    programs: { ...file.programs, [programId]: next },
  });

  const difficulty = scoreDifficulty(program, next);
  const unlockedBy = loadPrograms()
    .filter((p) => requirementsFor(p.id).unlocks.includes(programId))
    .map((p) => p.id);

  return {
    ...next,
    id: program.id,
    name: program.name,
    category: program.category,
    oneLiner: program.oneLiner,
    applyUrl: program.applyUrl,
    librarySources: program.sources,
    deadlineCount: program.deadlines.length,
    hasNullDeadline: program.deadlines.some((d) => d.date == null),
    formFillMinutes: program.formFillMinutes,
    timeToMoneyDays: program.timeToMoneyDays,
    difficultyScore: difficulty.score,
    difficultyTier: difficulty.tier,
    difficultyBreakdown: difficulty.breakdown,
    availability: computeAvailability(program, next, ctx),
    unlockedBy,
    rank: 0,
  };
}
