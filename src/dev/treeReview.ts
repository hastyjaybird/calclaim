/**
 * Temporary in-memory walkthrough of the Telegram message tree.
 * Replays the same ranker + next-steps transitions the bot uses.
 * Does not persist sessions or touch analytics.
 */

import { docLabel, missingDocs } from "../library/docs.js";
import {
  countyFromZip,
  parseZipCode,
  passesCountyEligibility,
  programNeedsZip,
} from "../library/geo.js";
import { getProgram, incomeBandLabels, loadPrograms } from "../library/load.js";
import {
  applyResidencyTie,
  programNeedsCaHome,
  residencyTieLabel,
} from "../library/residency.js";
import type {
  Branch,
  DocId,
  IncomeBand,
  MeterSharing,
  Program,
  ResidencyTie,
  SessionState,
  StepId,
  TodoStatus,
} from "../library/types.js";
import { emptySession } from "../db/session.js";
import {
  formatHeldProgramList,
  listHeldQualifyingPrograms,
} from "../reopen/qualify.js";
import {
  formatReportSummary,
  markGateAlreadyOn,
  openTodos,
  upsertItem,
} from "../nextsteps/model.js";
import { HOUSEHOLD_EXPLAIN, IMMIGRATION_STATUS_PROMPT } from "../privacy/copy.js";
import {
  applySkipCascade,
  extendOfferQueue,
  pickNextTriageGate,
  queueNeedsStatusGate,
  remainingTriageQuestions,
  type ImmigrationAnswer,
  type TriageGateId,
} from "../queue/ranker.js";
import {
  clearImmigrationAnswer,
  getImmigrationAnswer,
  markAwaitingImmigrationPrompt,
  passesImmigrationGate,
  setImmigrationAnswer,
} from "../queue/immigrationMemory.js";
import {
  disasterImpactQuestion,
  disasterWorkZipConfirmPrompt,
  disasterZipConfirmPrompt,
} from "../disaster/format.js";
import {
  hasOfferableDisasterWindow,
  offerableDisasterWindows,
  zipInOfferableDisasterArea,
} from "../disaster/liveWindow.js";
import { GATE_NONE_ID, GATE_OPTIONS } from "../bot/keyboards.js";
import { formatOfferCardText } from "../bot/offerCard.js";
import {
  SHUTOFF_ADDRESS_PROMPT,
  parseShutoffLocPayload,
  programNeedsShutoffZone,
  resolveShutoffZone,
  resolveShutoffZoneFromCoords,
  shutoffZoneAnswered,
} from "../library/pgeShutoff.js";
import {
  UTILITY_BILL_NONE_ID,
  UTILITY_BILL_OPTIONS,
  billsInMyNameLabel,
  passesBillInNameGate,
  programNeedsBillInName,
  utilityBillsAnswered,
} from "../library/utilityBills.js";
import {
  SHARED_METER_PROMPT,
  meterSharingAnswered,
  meterSharingLabel,
  passesMeterSharingGate,
  programNeedsMeterSharingGate,
  programNeedsNotMasterMetered,
} from "../library/sharedMeter.js";

export type ReqState = "met" | "unmet" | "unknown" | "na";

export type ProgramReviewStatus =
  | "waiting_gate"
  | "info_only"
  | "not_in_branch"
  | "current_offer"
  | "in_queue"
  | "added_to_guide"
  | "already_enrolled"
  | "skipped"
  | "snoozed"
  | "locked"
  | "eliminated";

export interface ReviewButton {
  label: string;
  action: string | null;
  kind: "callback" | "url" | "input" | "geolocation";
}

export interface RequirementCheck {
  id: string;
  label: string;
  needed: boolean;
  state: ReqState;
  detail: string;
}

export interface ProgramReviewRow {
  id: string;
  name: string;
  category: string;
  status: ProgramReviewStatus;
  reason: string;
  remainingQuestions: number;
  newDocs: number;
  timeToMoneyDays: number;
  queueIndex: number | null;
  requirements: RequirementCheck[];
  docs: { id: DocId; label: string; inHand: boolean }[];
}

export interface ReviewScreen {
  step: StepId;
  title: string;
  text: string;
  buttons: ReviewButton[];
  input?: {
    placeholder: string;
    actionPrefix: string;
    label?: string;
    submitLabel?: string;
    /** Character cap for the phone text box (ZIP is 10; street+city needs more). */
    maxLength?: number;
    inputMode?: "text" | "numeric" | "decimal";
  };
  telegramNote?: string;
}

export interface TreeNode {
  id: string;
  label: string;
  kind: "screen" | "branch" | "loop" | "gate" | "global";
  active: boolean;
  answered?: string;
  note?: string;
}

export interface TreeReviewSnapshot {
  actions: string[];
  notice: string | null;
  whyThisScreen: string;
  nextGate: TriageGateId | "immigration" | null;
  screen: ReviewScreen;
  facts: {
    step: StepId;
    branch: Branch | null;
    householdSize: number | null;
    incomeBand: IncomeBand | null;
    pastDue: boolean | null;
    utilityBillsAsked: boolean;
    billsInMyName: string[];
    billNotInMyName: boolean;
    meterSharing: MeterSharing | null;
    inShutoffZone: boolean | null;
    residencyTie: ResidencyTie | null;
    isCaResident: boolean | null;
    buyingEvThisYear: boolean | null;
    firstTimeZev: boolean | null;
    buyingEbikeThisYear: boolean | null;
    wouldRetireVehicle: boolean | null;
    hasChildInHousehold: boolean | null;
    isFosterYouth: boolean | null;
    isRefugeeOrAsylee: boolean | null;
    hasMedicalDeviceOrCondition: boolean | null;
    hasAgedBlindOrDisabled: boolean | null;
    workDisruption: string | null;
    inDisasterArea: boolean | null;
    residenceZip: string | null;
    residenceCounty: string | null;
    immigrationStatus: ImmigrationAnswer | null;
    docsInHand: DocId[];
    alreadyOn: string[];
    remindersEnabled: boolean;
  };
  queue: {
    ids: string[];
    index: number;
    current: string | null;
    remaining: string[];
  };
  counts: Record<ProgramReviewStatus, number>;
  programs: ProgramReviewRow[];
  tree: TreeNode[];
  disasterWindowsLive: boolean;
  presets: { id: string; label: string; actions: string[] }[];
}

const REVIEW_PRESETS: { id: string; label: string; actions: string[] }[] = [
  { id: "start", label: "Start (opt-in)", actions: [] },
  {
    id: "yes",
    label: "YES arm (Medi-Cal + CalFresh)",
    actions: [
      "opt:start",
      "gate:toggle:medi_cal",
      "gate:toggle:calfresh",
      "gate:done",
    ],
  },
  {
    id: "no",
    label: "NO arm (none at gate)",
    actions: ["opt:start", "gate:toggle:none", "gate:done"],
  },
];

function yn(v: boolean | null): string {
  if (v === null) return "not asked";
  return v ? "yes" : "no";
}

function incomeLabel(band: IncomeBand | null): string {
  if (!band) return "not asked";
  if (band === "careBand") return "CARE band";
  if (band === "feraBand") return "FERA band";
  return "above FERA";
}

function workLabel(v: string | null): string {
  if (!v) return "not asked";
  if (v === "job_loss") return "lost job";
  if (v === "health") return "illness / injury / pregnancy";
  if (v === "family_care") return "family care / bonding";
  if (v === "none") return "none";
  return v;
}

function immigrationLabel(v: ImmigrationAnswer | null): string {
  if (!v) return "not asked";
  if (v === "eligible") return "citizen / eligible immigrant";
  if (v === "ineligible") return "not eligible immigrant";
  return "prefer not to say";
}

function formatFinishClosingMessage(): string {
  return "For more help, visit BenefitsCal at https://benefitscal.com/";
}

function formatStopOptOutMessage(): string {
  return "Say STOP if you do not want any infrequent updates for benefit updates and changes.";
}

function formatEmptyQueueMessage(): string {
  return `You're through the list – nothing to add to an Application Guide right now.

Know someone who might need benefits help? Share CalClaim with a friend.

${formatFinishClosingMessage()}`;
}

function continueAfterWave(session: SessionState): void {
  if (
    session.inDisasterArea === null &&
    hasOfferableDisasterWindow() &&
    session.step !== "has_disaster_zip"
  ) {
    askTriageGate(session, "disaster");
    return;
  }
  extendOfferQueue(session);
  if (session.queueIndex < session.queue.length) {
    session.step = "offer";
    return;
  }
  const next = pickNextTriageGate(session);
  if (next) {
    askTriageGate(session, next);
    return;
  }
  if (queueNeedsStatusGate(session)) {
    session.step = "has_immigration_status";
    markAwaitingImmigrationPrompt(session.telegramUserId);
    return;
  }
  const held = listHeldQualifyingPrograms(session);
  if (held.length && session.reopenNotifyOptIn === null) {
    session.step = "has_reopen_notify";
    session.reopenWatchProgramIds = held.map((p) => p.id);
    return;
  }
  session.step = "idle";
  session.remindersEnabled = true;
}

function askTriageGate(session: SessionState, gate: TriageGateId): void {
  switch (gate) {
    case "income":
      session.step = session.householdSize == null ? "household_size" : "income_band";
      return;
    case "past_due":
      session.step = "past_due";
      return;
    case "utility_bills":
      session.step = "has_utility_bills";
      session.billsInMyName = [];
      return;
    case "shared_meter":
      session.step = "has_shared_meter";
      return;
    case "shutoff_zone":
      session.step = "has_shutoff_zone";
      session.shutoffAddressChoices = null;
      return;
    case "ca_residency":
      session.step = "has_ca_residency";
      return;
    case "buying_ev":
      session.step = "has_buying_ev";
      return;
    case "first_time_zev":
      session.step = "has_first_time_zev";
      return;
    case "buying_ebike":
      session.step = "has_buying_ebike";
      return;
    case "retire_vehicle":
      session.step = "has_retire_vehicle";
      return;
    case "child":
      session.step = "has_child";
      return;
    case "foster_youth":
      session.step = "has_foster_youth";
      return;
    case "refugee":
      session.step = "has_refugee_status";
      return;
    case "medical_need":
      session.step = "has_medical_need";
      return;
    case "abd":
      session.step = "has_abd";
      return;
    case "work":
      session.step = "has_work_disruption";
      return;
    case "disaster": {
      const windows = offerableDisasterWindows();
      if (!windows.length) {
        session.inDisasterArea = false;
        continueAfterWave(session);
        return;
      }
      session.step = "has_disaster_area";
      return;
    }
    case "zip":
      session.step = "has_zip";
      return;
  }
}

async function applyAction(
  session: SessionState,
  data: string,
): Promise<{ notice: string | null }> {
  if (data === "opt:start") {
    session.step = "gate";
    session.alreadyOn = [];
    return { notice: null };
  }

  if (data === "opt:share") {
    return {
      notice:
        "Share menu (copyable link + Telegram share + QR). Stays on OPT_IN until Start.",
    };
  }

  if (data === "review:skip_rest" || data === "review:add_rest") {
    const status: TodoStatus = data === "review:add_rest" ? "in_progress" : "skipped";
    while (session.queueIndex < session.queue.length) {
      const id = session.queue[session.queueIndex]!;
      if (status === "skipped") {
        const dropped = applySkipCascade(session, id);
        for (const droppedId of dropped) {
          upsertItem(
            session,
            droppedId,
            "skipped",
            droppedId === id
              ? undefined
              : `Skipped (dropped with ${getProgram(id)?.name ?? id})`,
          );
        }
      } else {
        upsertItem(session, id, status);
      }
      session.queueIndex += 1;
    }
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("gate:toggle:")) {
    const id = data.slice("gate:toggle:".length);
    const isProgram = GATE_OPTIONS.some((o) => o.id === id);
    const isNone = id === GATE_NONE_ID;
    if (!isProgram && !isNone) {
      return { notice: `Unknown gate program: ${id}` };
    }
    if (session.alreadyOn.includes(id)) {
      session.alreadyOn = session.alreadyOn.filter((x) => x !== id);
    } else if (isNone) {
      session.alreadyOn = [GATE_NONE_ID];
    } else {
      session.alreadyOn = [
        ...session.alreadyOn.filter((x) => x !== GATE_NONE_ID),
        id,
      ];
    }
    return { notice: null };
  }

  if (data === "gate:done") {
    if (session.alreadyOn.length === 0) {
      return { notice: "Pick at least one program, or check None." };
    }
    if (session.alreadyOn.includes(GATE_NONE_ID)) {
      session.branch = "no";
      session.docsInHand = ["photoId", "utilityBill"];
      session.alreadyOn = [];
      session.queue = [];
      session.queueIndex = 0;
      continueAfterWave(session);
      return { notice: null };
    }
    session.branch = "yes";
    session.docsInHand = ["categoricalProof", "photoId", "utilityBill"];
    session.queue = [];
    session.queueIndex = 0;
    markGateAlreadyOn(session);
    continueAfterWave(session);
    return { notice: null };
  }

  // Stale review / voice shortcut.
  if (data === "gate:none") {
    session.branch = "no";
    session.docsInHand = ["photoId", "utilityBill"];
    session.alreadyOn = [];
    session.queue = [];
    session.queueIndex = 0;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "hh:more") {
    session.step = "household_size_custom";
    return { notice: null };
  }

  if (data.startsWith("hh:")) {
    const n = Number(data.slice(3));
    if (!Number.isFinite(n) || n < 1 || n > 30 || !Number.isInteger(n)) {
      return {
        notice:
          session.step === "household_size_custom"
            ? "Household size must be a whole number from 9–30."
            : "Household size must be 1–8, or tap More.",
      };
    }
    session.householdSize = n;
    session.step = "income_band";
    return { notice: null };
  }

  if (data.startsWith("income:")) {
    const band = data.slice("income:".length) as IncomeBand;
    if (band !== "careBand" && band !== "feraBand" && band !== "aboveFera") {
      return { notice: `Unknown income band: ${band}` };
    }
    session.incomeBand = band;
    session.branch = "no";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "pastdue:yes" || data === "pastdue:no") {
    session.pastDue = data === "pastdue:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("bills:toggle:")) {
    const id = data.slice("bills:toggle:".length);
    const isBill = UTILITY_BILL_OPTIONS.some((o) => o.id === id);
    const isNone = id === UTILITY_BILL_NONE_ID;
    if (!isBill && !isNone) {
      return { notice: `Unknown bill type: ${id}` };
    }
    if (session.billsInMyName.includes(id)) {
      session.billsInMyName = session.billsInMyName.filter((x) => x !== id);
    } else if (isNone) {
      session.billsInMyName = [UTILITY_BILL_NONE_ID];
    } else {
      session.billsInMyName = [
        ...session.billsInMyName.filter((x) => x !== UTILITY_BILL_NONE_ID),
        id,
      ];
    }
    return { notice: null };
  }

  if (data === "bills:done") {
    if (session.billsInMyName.length === 0) {
      return { notice: "Pick at least one bill type, or check None." };
    }
    session.utilityBillsAsked = true;
    session.billNotInMyName = session.billsInMyName.includes(
      UTILITY_BILL_NONE_ID,
    );
    if (session.billNotInMyName) {
      session.docsInHand = session.docsInHand.filter((d) => d !== "utilityBill");
    }
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "shutoff:yes") {
    session.inShutoffZone = true;
    session.shutoffAddressChoices = null;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "shutoff:unsure" || data === "shutoff:locate") {
    session.step = "has_shutoff_address";
    session.shutoffAddressChoices = null;
    return { notice: null };
  }

  if (data === "shutoff:no" || data === "shutoffaddr:skip") {
    session.inShutoffZone = false;
    session.shutoffAddressChoices = null;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("shutoffloc:")) {
    const coords = parseShutoffLocPayload(data);
    if (!coords) {
      return { notice: "Couldn't read that location – type an address instead." };
    }
    const result = await resolveShutoffZoneFromCoords(coords.lat, coords.lng);
    if (result.kind === "unresolved") {
      session.step = "has_shutoff_address";
      session.shutoffAddressChoices = null;
      return { notice: result.message };
    }
    session.inShutoffZone = result.inZone;
    session.shutoffAddressChoices = null;
    continueAfterWave(session);
    return { notice: result.message };
  }

  if (data.startsWith("shutoffaddr:") && data !== "shutoffaddr:skip") {
    const query = data.slice("shutoffaddr:".length).trim();
    if (query.length < 5) {
      return { notice: "Type a fuller street address and city." };
    }
    const { inZone, message } = await resolveShutoffZone(query);
    session.inShutoffZone = inZone;
    session.shutoffAddressChoices = null;
    continueAfterWave(session);
    return { notice: message };
  }

  if (data === "child:yes" || data === "child:no") {
    session.hasChildInHousehold = data === "child:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "home:ca") {
    applyResidencyTie(session, "ca_home");
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "home:visit") {
    applyResidencyTie(session, "visitor");
    continueAfterWave(session);
    return {
      notice:
        "Most California food and health programs need you to live here. Checking programs that don't need a California home.",
    };
  }

  if (data === "home:other") {
    session.step = "has_ca_work";
    return { notice: null };
  }

  if (data === "cawork:yes") {
    applyResidencyTie(session, "out_of_state_ca_work");
    continueAfterWave(session);
    return {
      notice:
        "Most California food and health programs need you to live here. Checking California work-based programs.",
    };
  }

  if (data === "cawork:no") {
    applyResidencyTie(session, "out_of_state");
    continueAfterWave(session);
    return {
      notice:
        "Most California programs need you to live or work here. Checking programs that don't need a California home.",
    };
  }

  if (data === "buyingev:yes" || data === "buyingev:no") {
    session.buyingEvThisYear = data === "buyingev:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "firstzev:yes" || data === "firstzev:no") {
    session.firstTimeZev = data === "firstzev:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "buyingebike:yes" || data === "buyingebike:no") {
    session.buyingEbikeThisYear = data === "buyingebike:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "retirecar:yes" || data === "retirecar:no") {
    session.wouldRetireVehicle = data === "retirecar:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "abd:yes" || data === "abd:no") {
    session.hasAgedBlindOrDisabled = data === "abd:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "foster:yes" || data === "foster:no") {
    session.isFosterYouth = data === "foster:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "refugee:yes" || data === "refugee:no") {
    session.isRefugeeOrAsylee = data === "refugee:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "medneed:yes" || data === "medneed:no") {
    session.hasMedicalDeviceOrCondition = data === "medneed:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (
    data === "meter:own" ||
    data === "meter:shared" ||
    data === "meter:landlord"
  ) {
    session.meterSharing =
      data === "meter:own"
        ? "own"
        : data === "meter:shared"
          ? "shared"
          : "landlord_bill";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "disaster:yes" || data === "disaster:no") {
    session.inDisasterArea = data === "disaster:yes";
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "disaster:unsure") {
    session.step = "has_disaster_zip";
    return { notice: null };
  }

  if (data === "disasterzip:skip") {
    session.inDisasterArea = false;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("disasterzip:")) {
    const zip = parseZipCode(data.slice("disasterzip:".length));
    if (!zip) {
      return { notice: "Please send a 5-digit ZIP code, or tap Skip." };
    }
    if (!countyFromZip(zip)) {
      return {
        notice: "I couldn't match that to a California ZIP. Try again, or tap Skip.",
      };
    }
    session.inDisasterArea = zipInOfferableDisasterArea(zip);
    continueAfterWave(session);
    return { notice: null };
  }

  if (data === "zip:skip") {
    session.residenceZip = "";
    session.residenceCounty = null;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("zip:")) {
    const zip = parseZipCode(data.slice("zip:".length));
    if (!zip) return { notice: "Please send a 5-digit ZIP code, or tap Skip." };
    const county = countyFromZip(zip);
    if (!county) {
      return {
        notice: "I couldn't match that to a California ZIP. Try again, or tap Skip.",
      };
    }
    session.residenceZip = zip;
    session.residenceCounty = county;
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("work:")) {
    const reason = data.slice("work:".length);
    if (
      reason !== "job_loss" &&
      reason !== "health" &&
      reason !== "family_care" &&
      reason !== "none"
    ) {
      return { notice: `Unknown work answer: ${reason}` };
    }
    session.workDisruption = reason;
    continueAfterWave(session);
    return { notice: null };
  }

  if (
    data === "status:eligible" ||
    data === "status:ineligible" ||
    data === "status:declined"
  ) {
    setImmigrationAnswer(
      session.telegramUserId,
      data.slice("status:".length) as ImmigrationAnswer,
    );
    continueAfterWave(session);
    return { notice: null };
  }

  if (data.startsWith("offer:signup:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "in_progress");
    session.queueIndex += 1;
    continueAfterWave(session);
    return { notice: "Added to your Application Guide." };
  }
  if (data.startsWith("offer:already:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "done");
    session.queueIndex += 1;
    continueAfterWave(session);
    return { notice: null };
  }
  if (data.startsWith("offer:remind:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "snoozed");
    session.queueIndex += 1;
    continueAfterWave(session);
    return { notice: null };
  }
  if (data.startsWith("offer:skip:")) {
    const id = data.split(":")[2]!;
    const dropped = applySkipCascade(session, id);
    for (const droppedId of dropped) {
      upsertItem(
        session,
        droppedId,
        "skipped",
        droppedId === id
          ? undefined
          : `Skipped (dropped with ${getProgram(id)?.name ?? id})`,
      );
    }
    session.queueIndex += 1;
    continueAfterWave(session);
    return { notice: null };
  }
  if (data === "offer:exit_guide") {
    if (openTodos(session).length === 0) {
      return { notice: null };
    }
    const held = listHeldQualifyingPrograms(session);
    if (held.length && session.reopenNotifyOptIn === null) {
      session.step = "has_reopen_notify";
      session.reopenWatchProgramIds = held.map((p) => p.id);
      return { notice: null };
    }
    session.step = "idle";
    session.remindersEnabled = true;
    return { notice: null };
  }

  if (data === "reopen:yes" || data === "reopen:no") {
    const held = listHeldQualifyingPrograms(session);
    session.reopenNotifyOptIn = data === "reopen:yes";
    if (session.reopenNotifyOptIn) {
      session.reopenWatchProgramIds = held.map((p) => p.id);
    } else {
      session.reopenWatchProgramIds = [];
      session.savedImmigrationStatus = null;
    }
    session.step = "idle";
    session.remindersEnabled = true;
    return {
      notice:
        data === "reopen:yes"
          ? "Opted in to reopen alerts for held programs."
          : "Declined reopen alerts.",
    };
  }

  if (data === "idle:restart") {
    const uid = session.telegramUserId;
    clearImmigrationAnswer(uid);
    Object.assign(session, emptySession(uid));
    return { notice: "Profile rewritten – starting over." };
  }

  return { notice: `Unknown / unsupported review action: ${data}` };
}

function previewScreen(session: SessionState, canGoBack = false): ReviewScreen {
  const screen = previewScreenInner(session);
  if (
    canGoBack &&
    screen.step !== "opt_in" &&
    !screen.buttons.some((b) => b.action === "nav:back")
  ) {
    screen.buttons = [
      ...screen.buttons,
      { label: "Back", action: "nav:back", kind: "callback" },
    ];
  }
  return screen;
}

function previewScreenInner(session: SessionState): ReviewScreen {
  const step = session.step;

  if (step === "opt_in") {
    return {
      step,
      title: "OPT_IN",
      text: `Find benefits for food, health, phone, and energy bills. CalClaim creates a personalized Application Guide that makes applying easier.

At any time, text about an issue, correction or suggest an improvement.

Estimates only. Not affiliated with any agency.
Type 'help' for more options.`,
      buttons: [
        { label: "Start", action: "opt:start", kind: "callback" },
        {
          label: "Share CalClaim with friends",
          action: "opt:share",
          kind: "callback",
        },
        {
          label: "Donate",
          action: "https://calclaim.jayhasty.com/impact#donate",
          kind: "url",
        },
      ],
    };
  }

  if (step === "gate") {
    const buttons: ReviewButton[] = GATE_OPTIONS.map((opt) => ({
      label: `${session.alreadyOn.includes(opt.id) ? "✓ " : ""}${opt.label}`,
      action: `gate:toggle:${opt.id}`,
      kind: "callback",
    }));
    buttons.push(
      {
        label: `${session.alreadyOn.includes(GATE_NONE_ID) ? "✓ " : ""}None`,
        action: `gate:toggle:${GATE_NONE_ID}`,
        kind: "callback",
      },
      { label: "— Done —", action: "gate:done", kind: "callback" },
    );
    return {
      step,
      title: "GATE",
      text: `Is anyone in your household already on any of these?

${HOUSEHOLD_EXPLAIN}

Tap all that apply (or None), then Done.`,
      buttons,
    };
  }

  if (step === "household_size") {
    return {
      step,
      title: "HOUSEHOLD_SIZE",
      text: `How many people are in your household?

${HOUSEHOLD_EXPLAIN}

Tap a number (or More):`,
      buttons: [
        ...Array.from({ length: 8 }, (_, i) => ({
          label: String(i + 1),
          action: `hh:${i + 1}`,
          kind: "callback" as const,
        })),
        { label: "More", action: "hh:more", kind: "callback" as const },
      ],
    };
  }

  if (step === "household_size_custom") {
    return {
      step,
      title: "HOUSEHOLD_SIZE",
      text: "Type how many people are in your household (9 or more):",
      buttons: [],
      input: {
        placeholder: "e.g. 10",
        actionPrefix: "hh:",
        label: "Household size",
        submitLabel: "Send",
        maxLength: 2,
        inputMode: "numeric",
      },
    };
  }

  if (step === "income_band") {
    const size = session.householdSize ?? 1;
    const labels = incomeBandLabels(size);
    return {
      step,
      title: "INCOME_BAND",
      text: `About how much is your household's total yearly income before taxes?

${HOUSEHOLD_EXPLAIN}

Add up income for everyone you just counted.`,
      buttons: [
        { label: labels.careBand, action: "income:careBand", kind: "callback" },
        { label: labels.feraBand, action: "income:feraBand", kind: "callback" },
        { label: labels.aboveFera, action: "income:aboveFera", kind: "callback" },
      ],
    };
  }

  if (step === "past_due") {
    return {
      step,
      title: "PAST_DUE",
      text: "Is your utility bill past due?",
      buttons: [
        { label: "Yes – past due", action: "pastdue:yes", kind: "callback" },
        { label: "No", action: "pastdue:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_utility_bills") {
    const buttons: ReviewButton[] = UTILITY_BILL_OPTIONS.map((opt) => ({
      label: `${session.billsInMyName.includes(opt.id) ? "✓ " : ""}${opt.label}`,
      action: `bills:toggle:${opt.id}`,
      kind: "callback",
    }));
    buttons.push({
      label: `${session.billsInMyName.includes(UTILITY_BILL_NONE_ID) ? "✓ " : ""}None`,
      action: `bills:toggle:${UTILITY_BILL_NONE_ID}`,
      kind: "callback",
    });
    buttons.push({
      label: "— Done —",
      action: "bills:done",
      kind: "callback",
    });
    return {
      step,
      title: "HAS_UTILITY_BILLS",
      text: `Which bills do you have in your name?

Tap all that apply (or None), then Done.`,
      buttons,
    };
  }

  if (step === "has_shutoff_zone") {
    return {
      step,
      title: "HAS_SHUTOFF_ZONE",
      text: `PG&E has rebates for a portable generator or battery if your home is in a shut-off or high fire-risk area. Renters also qualify.

Do you already know whether you're in one of those areas?`,
      buttons: [
        {
          label: "Yes – I'm in a shut-off zone",
          action: "shutoff:yes",
          kind: "callback",
        },
        {
          label: "No / I don't think so",
          action: "shutoff:no",
          kind: "callback",
        },
        {
          label: "Use my location",
          action: "shutoffloc:",
          kind: "geolocation",
        },
        {
          label: "Not sure – check my address",
          action: "shutoff:unsure",
          kind: "callback",
        },
      ],
      telegramNote:
        "Telegram can't request GPS from an inline button. Use my location opens a Share location keyboard, then we snap to the nearest street.",
    };
  }

  if (step === "has_shutoff_address") {
    return {
      step,
      title: "HAS_SHUTOFF_ADDRESS",
      text: SHUTOFF_ADDRESS_PROMPT,
      buttons: [
        {
          label: "Use my location",
          action: "shutoffloc:",
          kind: "geolocation",
        },
        { label: "Skip – don't check", action: "shutoffaddr:skip", kind: "callback" },
      ],
      telegramNote:
        "Telegram asks the phone for location permission, snaps to the nearest street, and checks PG&E's map. Street and GPS are not stored.",
      input: {
        placeholder: "e.g. 123 Main St, Santa Rosa",
        actionPrefix: "shutoffaddr:",
        label: "Type street address and city",
        submitLabel: "Check address",
        // Street + city (unit, compass, long street names). ZIP reuse was 10.
        maxLength: 200,
        inputMode: "text",
      },
    };
  }

  if (step === "has_ca_residency") {
    return {
      step,
      title: "HAS_CA_RESIDENCY",
      text: "Where do you live most of the year?",
      buttons: [
        { label: "In California", action: "home:ca", kind: "callback" },
        { label: "In another state", action: "home:other", kind: "callback" },
        {
          label: "Just visiting / neither",
          action: "home:visit",
          kind: "callback",
        },
      ],
    };
  }

  if (step === "has_ca_work") {
    return {
      step,
      title: "HAS_CA_WORK",
      text: "Do you work in California (commute, job site, or CA employer wages)?",
      buttons: [
        {
          label: "Yes – I work in California",
          action: "cawork:yes",
          kind: "callback",
        },
        { label: "No", action: "cawork:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_buying_ev") {
    return {
      step,
      title: "HAS_BUYING_EV",
      text: "Are you trying to buy an electric vehicle (or a hydrogen car) this year?",
      buttons: [
        { label: "Yes", action: "buyingev:yes", kind: "callback" },
        { label: "No", action: "buyingev:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_first_time_zev") {
    return {
      step,
      title: "HAS_FIRST_TIME_ZEV",
      text: "Would this be your first battery-electric or hydrogen vehicle (not a plug-in hybrid)?",
      buttons: [
        { label: "Yes – first ZEV", action: "firstzev:yes", kind: "callback" },
        { label: "No", action: "firstzev:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_buying_ebike") {
    return {
      step,
      title: "HAS_BUYING_EBIKE",
      text: "Are you trying to buy a pedal e-bike this year (not a scooter)?",
      buttons: [
        { label: "Yes", action: "buyingebike:yes", kind: "callback" },
        { label: "No", action: "buyingebike:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_retire_vehicle") {
    return {
      step,
      title: "HAS_RETIRE_VEHICLE",
      text: "Do you have an older gas or diesel car you could retire (scrap) for a bigger rebate?",
      buttons: [
        {
          label: "Yes – I could scrap one",
          action: "retirecar:yes",
          kind: "callback",
        },
        { label: "No", action: "retirecar:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_child") {
    return {
      step,
      title: "HAS_CHILD",
      text: `Any kids under 18 (or a pregnancy) in the household?

${HOUSEHOLD_EXPLAIN}`,
      buttons: [
        { label: "Yes", action: "child:yes", kind: "callback" },
        { label: "No", action: "child:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_foster_youth") {
    return {
      step,
      title: "HAS_FOSTER_YOUTH",
      text: "Are you (or someone filing) a former foster youth age 18–25 who was in foster care on or after their 18th birthday?",
      buttons: [
        { label: "Yes", action: "foster:yes", kind: "callback" },
        { label: "No", action: "foster:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_refugee_status") {
    return {
      step,
      title: "HAS_REFUGEE_STATUS",
      text: "Are you a refugee, asylee, or similar eligible newcomer (SIV holder, Afghan or Ukrainian parolee, Cuban/Haitian entrant, or certified trafficking victim)?",
      buttons: [
        { label: "Yes", action: "refugee:yes", kind: "callback" },
        { label: "No", action: "refugee:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_shared_meter") {
    return {
      step,
      title: "HAS_SHARED_METER",
      text: SHARED_METER_PROMPT,
      buttons: [
        { label: "No, just us", action: "meter:own", kind: "callback" },
        { label: "Yes, we share it", action: "meter:shared", kind: "callback" },
        { label: "Landlord bills me", action: "meter:landlord", kind: "callback" },
      ],
    };
  }

  if (step === "has_medical_need") {
    return {
      step,
      title: "HAS_MEDICAL_NEED",
      text: "Does anyone living in the home have a qualifying medical condition or device that needs extra electricity or gas (for example life-support equipment, dialysis, asthma, or extra heating or cooling)?",
      buttons: [
        { label: "Yes", action: "medneed:yes", kind: "callback" },
        { label: "No", action: "medneed:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_abd") {
    return {
      step,
      title: "HAS_ABD",
      text: `Is anyone in the household 65 or older, blind, or disabled?

${HOUSEHOLD_EXPLAIN}`,
      buttons: [
        { label: "Yes", action: "abd:yes", kind: "callback" },
        { label: "No", action: "abd:no", kind: "callback" },
      ],
    };
  }

  if (step === "has_work_disruption") {
    return {
      step,
      title: "HAS_WORK_DISRUPTION",
      text:
        session.residencyTie === "out_of_state_ca_work"
          ? "About your California job – has anything affected your ability to work in the last few months?"
          : "Has anything affected your ability to work in the last few months?",
      buttons: [
        { label: "Lost my job", action: "work:job_loss", kind: "callback" },
        {
          label: "Can't work – illness, injury, or pregnancy",
          action: "work:health",
          kind: "callback",
        },
        {
          label: "Caring for a sick family member / new baby",
          action: "work:family_care",
          kind: "callback",
        },
        { label: "None of these", action: "work:none", kind: "callback" },
      ],
    };
  }

  if (step === "has_disaster_area") {
    return {
      step,
      title: "HAS_DISASTER_AREA",
      text: disasterImpactQuestion(offerableDisasterWindows()),
      buttons: [
        { label: "Yes", action: "disaster:yes", kind: "callback" },
        { label: "No", action: "disaster:no", kind: "callback" },
        { label: "Not sure", action: "disaster:unsure", kind: "callback" },
      ],
    };
  }

  if (step === "has_disaster_zip") {
    return {
      step,
      title: "HAS_DISASTER_ZIP",
      text:
        session.residencyTie === "out_of_state_ca_work"
          ? disasterWorkZipConfirmPrompt()
          : disasterZipConfirmPrompt(),
      buttons: [
        { label: "Skip – not sure", action: "disasterzip:skip", kind: "callback" },
      ],
      input: {
        placeholder: "e.g. 90012",
        actionPrefix: "disasterzip:",
        maxLength: 10,
        inputMode: "numeric",
      },
    };
  }

  if (step === "has_zip") {
    return {
      step,
      title: "HAS_ZIP",
      text: "What's your home ZIP code? (5 digits – used only to check county-specific programs.)",
      buttons: [{ label: "Skip – not sure", action: "zip:skip", kind: "callback" }],
      input: {
        placeholder: "e.g. 95476",
        actionPrefix: "zip:",
        maxLength: 10,
        inputMode: "numeric",
      },
    };
  }

  if (step === "has_immigration_status") {
    return {
      step,
      title: "HAS_IMMIGRATION_STATUS",
      text: IMMIGRATION_STATUS_PROMPT,
      buttons: [
        {
          label: "Yes – citizen or eligible immigrant",
          action: "status:eligible",
          kind: "callback",
        },
        { label: "No", action: "status:ineligible", kind: "callback" },
        {
          label: "Prefer not to say",
          action: "status:declined",
          kind: "callback",
        },
      ],
    };
  }

  if (step === "has_reopen_notify") {
    const held = listHeldQualifyingPrograms(session);
    return {
      step,
      title: "HAS_REOPEN_NOTIFY",
      text: `A few programs you may qualify for are waitlisted or closed to new enrollments right now (not shown in the offer tree):\n\n${formatHeldProgramList(held)}\n\nWant a text if one of these opens and you still qualify on your saved answers?`,
      buttons: [
        { label: "Yes – notify me", action: "reopen:yes", kind: "callback" },
        { label: "No thanks", action: "reopen:no", kind: "callback" },
      ],
    };
  }

  if (step === "offer") {
    const id = session.queue[session.queueIndex];
    const program = id ? getProgram(id) : undefined;
    if (!program) {
      return {
        step,
        title: "OFFER_CARD",
        text: "(No current program – queue cursor is past the end.)",
        buttons: [],
      };
    }
    return {
      step,
      title: `OFFER · ${program.name}`,
      text: formatOfferCardText(program, session),
      buttons: [
        {
          label: "Add to My Application Guide",
          action: `offer:signup:${program.id}`,
          kind: "callback",
        },
        {
          label: "I'm already enrolled",
          action: `offer:already:${program.id}`,
          kind: "callback",
        },
        {
          label: "Skip program",
          action: `offer:skip:${program.id}`,
          kind: "callback",
        },
        ...(openTodos(session).length > 0
          ? [
              {
                label: "Exit & print My Application Guide now",
                action: "offer:exit_guide",
                kind: "callback" as const,
              },
            ]
          : []),
      ],
    };
  }

  if (step === "idle") {
    const open = openTodos(session);
    if (open.length === 0) {
      return {
        step,
        title: "FINISH / IDLE",
        text: `${formatEmptyQueueMessage()}

${formatStopOptOutMessage()}`,
        telegramNote:
          "Telegram sends the empty-queue copy and the STOP line as separate messages. No Application Guide PDF.",
        buttons: [
          {
            label: "Share CalClaim with friends",
            action: null,
            kind: "url",
          },
          { label: "Update my answers", action: "idle:restart", kind: "callback" },
          { label: "More info", action: null, kind: "url" },
        ],
      };
    }
    return {
      step,
      title: "FINISH / IDLE",
      text: `${formatReportSummary(session)}

[PDF] calclaim-application-guide.pdf

${formatFinishClosingMessage()}

${formatStopOptOutMessage()}`,
      telegramNote:
        "Telegram sends summary → PDF → closing → STOP as separate messages, then idle buttons.",
      buttons: [
        {
          label: "Email Application Guide to my computer",
          action: null,
          kind: "url",
        },
        {
          label: "Share CalClaim with friends",
          action: null,
          kind: "url",
        },
        { label: "Update my answers", action: "idle:restart", kind: "callback" },
        { label: "More info", action: null, kind: "url" },
      ],
    };
  }

  return {
    step,
    title: step.toUpperCase(),
    text: `(Screen ${step} is not part of the main offer tree.)`,
    buttons: [{ label: "Update my answers", action: "idle:restart", kind: "callback" }],
  };
}

function req(
  id: string,
  label: string,
  needed: boolean,
  state: ReqState,
  detail: string,
): RequirementCheck {
  return { id, label, needed, state, detail };
}

function evaluateRequirements(
  program: Program,
  session: SessionState,
  immigration: ImmigrationAnswer | null,
): RequirementCheck[] {
  const checks: RequirementCheck[] = [];
  const branch = session.branch;

  if (program.id === "tax_credits") {
    checks.push(
      req(
        "info_only",
        "Offer queue",
        true,
        "unmet",
        "Info-only – never enters the offer queue",
      ),
    );
  }

  if (!branch) {
    checks.push(
      req("branch", "YES / NO arm", true, "unknown", "Gate not answered yet"),
    );
  } else if (!program.branches.includes(branch)) {
    checks.push(
      req(
        "branch",
        "YES / NO arm",
        true,
        "unmet",
        `Only offered on ${program.branches.join(" / ")} – user is on ${branch.toUpperCase()}`,
      ),
    );
  } else {
    checks.push(
      req(
        "branch",
        "YES / NO arm",
        true,
        "met",
        `Offered on ${branch.toUpperCase()}`,
      ),
    );
  }

  if (program.incomeGate) {
    if (branch === "yes") {
      checks.push(
        req(
          "income",
          `Income (${program.incomeGate})`,
          true,
          "met",
          "YES arm skips the income gate",
        ),
      );
    } else if (branch !== "no") {
      checks.push(
        req("income", `Income (${program.incomeGate})`, true, "unknown", "Branch unknown"),
      );
    } else if (session.incomeBand == null) {
      checks.push(
        req(
          "income",
          `Income (${program.incomeGate})`,
          true,
          "unknown",
          "Household / income not asked yet",
        ),
      );
    } else {
      const ok =
        program.incomeGate === "careBand"
          ? session.incomeBand === "careBand"
          : program.incomeGate === "feraBand"
            ? session.incomeBand === "feraBand"
            : session.incomeBand === "careBand" || session.incomeBand === "feraBand";
      checks.push(
        req(
          "income",
          `Income (${program.incomeGate})`,
          true,
          ok ? "met" : "unmet",
          `User is ${incomeLabel(session.incomeBand)}`,
        ),
      );
    }
  } else {
    checks.push(req("income", "Income gate", false, "na", "Not income-gated"));
  }

  if (branch === "no" && session.incomeBand === "careBand" && program.id === "fera") {
    checks.push(
      req(
        "fera_vs_care",
        "FERA vs CARE",
        true,
        "unmet",
        "NO + CARE band drops FERA (CARE covers the lower band)",
      ),
    );
  }

  if (program.requiresPastDue) {
    if (session.pastDue === null) {
      checks.push(req("past_due", "Past-due bill", true, "unknown", "Not asked yet"));
    } else {
      checks.push(
        req(
          "past_due",
          "Past-due bill",
          true,
          session.pastDue ? "met" : "unmet",
          `Past due = ${yn(session.pastDue)}`,
        ),
      );
    }
  } else {
    checks.push(req("past_due", "Past-due bill", false, "na", "Not required"));
  }

  if (programNeedsBillInName(program)) {
    if (!utilityBillsAnswered(session)) {
      checks.push(
        req(
          "bill_name",
          "Bill in user's name",
          true,
          "unknown",
          "Not asked yet",
        ),
      );
    } else {
      const pass = passesBillInNameGate(program, session.billsInMyName);
      checks.push(
        req(
          "bill_name",
          "Bill in user's name",
          true,
          pass ? "met" : "unmet",
          pass
            ? billsInMyNameLabel(session.billsInMyName)
            : session.billNotInMyName
              ? "Dropped (none in name)"
              : `No matching bill (${billsInMyNameLabel(session.billsInMyName)})`,
        ),
      );
    }
  }

  if (programNeedsMeterSharingGate(program)) {
    const meterLabel = programNeedsNotMasterMetered(program)
      ? "Not landlord / master meter"
      : "Own meter (not shared)";
    if (!meterSharingAnswered(session)) {
      checks.push(
        req("shared_meter", meterLabel, true, "unknown", "Not asked yet"),
      );
    } else {
      const pass = passesMeterSharingGate(program, session.meterSharing);
      checks.push(
        req(
          "shared_meter",
          meterLabel,
          true,
          pass ? "met" : "unmet",
          meterSharingLabel(session.meterSharing),
        ),
      );
    }
  }

  if (programNeedsShutoffZone(program)) {
    if (!shutoffZoneAnswered(session)) {
      checks.push(
        req(
          "shutoff_zone",
          "PG&E shut-off / fire-threat zone",
          true,
          "unknown",
          "Not asked yet",
        ),
      );
    } else {
      checks.push(
        req(
          "shutoff_zone",
          "PG&E shut-off / fire-threat zone",
          true,
          session.inShutoffZone === true ? "met" : "unmet",
          session.inShutoffZone === true
            ? "Pre-qualifies or unclear map result (offer shown)"
            : "Clear map no / declined address check",
        ),
      );
    }
  }

  if (programNeedsCaHome(program)) {
    if (session.residencyTie === null) {
      checks.push(
        req("ca_residency", "CA home", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "ca_residency",
          "CA home",
          true,
          session.residencyTie === "ca_home" ? "met" : "unmet",
          residencyTieLabel(session.residencyTie),
        ),
      );
    }
  } else {
    checks.push(req("ca_residency", "CA home", false, "na", "Not required"));
  }

  if (program.requiresBuyingEvThisYear) {
    if (session.buyingEvThisYear === null) {
      checks.push(
        req("buying_ev", "Buying EV this year", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "buying_ev",
          "Buying EV this year",
          true,
          session.buyingEvThisYear ? "met" : "unmet",
          `Buying EV = ${yn(session.buyingEvThisYear)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("buying_ev", "Buying EV this year", false, "na", "Not required"),
    );
  }

  if (program.requiresFirstTimeZev) {
    if (session.firstTimeZev === null) {
      checks.push(
        req("first_time_zev", "First-time ZEV", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "first_time_zev",
          "First-time ZEV",
          true,
          session.firstTimeZev ? "met" : "unmet",
          `First-time ZEV = ${yn(session.firstTimeZev)}`,
        ),
      );
    }
  } else {
    checks.push(req("first_time_zev", "First-time ZEV", false, "na", "Not required"));
  }

  if (program.requiresBuyingEbikeThisYear) {
    if (session.buyingEbikeThisYear === null) {
      checks.push(
        req("buying_ebike", "Buying e-bike this year", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "buying_ebike",
          "Buying e-bike this year",
          true,
          session.buyingEbikeThisYear ? "met" : "unmet",
          `Buying e-bike = ${yn(session.buyingEbikeThisYear)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("buying_ebike", "Buying e-bike this year", false, "na", "Not required"),
    );
  }

  if (program.requiresVehicleRetirement) {
    if (session.wouldRetireVehicle === null) {
      checks.push(
        req("retire_vehicle", "Retire older vehicle", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "retire_vehicle",
          "Retire older vehicle",
          true,
          session.wouldRetireVehicle ? "met" : "unmet",
          `Scrap car = ${yn(session.wouldRetireVehicle)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("retire_vehicle", "Retire older vehicle", false, "na", "Not required"),
    );
  }

  if (program.requiresChildInHousehold) {
    if (session.hasChildInHousehold === null) {
      checks.push(req("child", "Child / pregnancy", true, "unknown", "Not asked yet"));
    } else {
      checks.push(
        req(
          "child",
          "Child / pregnancy",
          true,
          session.hasChildInHousehold ? "met" : "unmet",
          `Has child = ${yn(session.hasChildInHousehold)}`,
        ),
      );
    }
  } else {
    checks.push(req("child", "Child / pregnancy", false, "na", "Not required"));
  }

  if (program.requiresFosterYouth) {
    if (session.isFosterYouth === null) {
      checks.push(
        req("foster_youth", "Former foster youth", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "foster_youth",
          "Former foster youth",
          true,
          session.isFosterYouth ? "met" : "unmet",
          `Foster youth = ${yn(session.isFosterYouth)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("foster_youth", "Former foster youth", false, "na", "Not required"),
    );
  }

  if (program.requiresRefugeeOrAsylee) {
    if (session.isRefugeeOrAsylee === null) {
      checks.push(
        req("refugee", "Refugee / asylee", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "refugee",
          "Refugee / asylee",
          true,
          session.isRefugeeOrAsylee ? "met" : "unmet",
          `Refugee / asylee = ${yn(session.isRefugeeOrAsylee)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("refugee", "Refugee / asylee", false, "na", "Not required"),
    );
  }

  if (program.requiresMedicalDeviceOrCondition) {
    if (session.hasMedicalDeviceOrCondition === null) {
      checks.push(
        req("medical_need", "Medical energy need", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "medical_need",
          "Medical energy need",
          true,
          session.hasMedicalDeviceOrCondition ? "met" : "unmet",
          `Medical need = ${yn(session.hasMedicalDeviceOrCondition)}`,
        ),
      );
    }
  } else {
    checks.push(
      req("medical_need", "Medical energy need", false, "na", "Not required"),
    );
  }

  if (program.requiresAgedBlindOrDisabled) {
    if (session.hasAgedBlindOrDisabled === null) {
      checks.push(req("abd", "Aged / blind / disabled", true, "unknown", "Not asked yet"));
    } else {
      checks.push(
        req(
          "abd",
          "Aged / blind / disabled",
          true,
          session.hasAgedBlindOrDisabled ? "met" : "unmet",
          `ABD = ${yn(session.hasAgedBlindOrDisabled)}`,
        ),
      );
    }
  } else {
    checks.push(req("abd", "Aged / blind / disabled", false, "na", "Not required"));
  }

  if (program.requiresWorkDisruption) {
    if (session.workDisruption === null) {
      checks.push(
        req(
          "work",
          `Work (${program.requiresWorkDisruption})`,
          true,
          "unknown",
          "Not asked yet",
        ),
      );
    } else {
      const ok = session.workDisruption === program.requiresWorkDisruption;
      checks.push(
        req(
          "work",
          `Work (${program.requiresWorkDisruption})`,
          true,
          ok ? "met" : "unmet",
          `Answer = ${workLabel(session.workDisruption)}`,
        ),
      );
    }
  } else {
    checks.push(req("work", "Work disruption", false, "na", "Not required"));
  }

  if (program.requiresActiveDisasterWindow) {
    if (!hasOfferableDisasterWindow()) {
      checks.push(
        req(
          "disaster",
          "Live disaster window",
          true,
          "unmet",
          "No approved county window right now (dormant)",
        ),
      );
    } else if (session.inDisasterArea === null) {
      checks.push(
        req("disaster", "Lived/worked in disaster area", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "disaster",
          "Lived/worked in disaster area",
          true,
          session.inDisasterArea ? "met" : "unmet",
          `In area = ${yn(session.inDisasterArea)}`,
        ),
      );
    }
  } else {
    checks.push(req("disaster", "Disaster window", false, "na", "Not required"));
  }

  if (programNeedsZip(program)) {
    const zipLabel = program.requiresCmspCounty
      ? "CMSP county (ZIP)"
      : "County (ZIP)";
    if (session.residenceZip === null) {
      checks.push(req("zip", zipLabel, true, "unknown", "ZIP not asked yet"));
    } else if (!session.residenceCounty) {
      checks.push(
        req("zip", zipLabel, true, "unmet", "ZIP skipped / unknown county"),
      );
    } else {
      const ok = passesCountyEligibility(program, session.residenceCounty);
      const kind = program.requiresCmspCounty ? "a CMSP county" : "an eligible county";
      checks.push(
        req(
          "zip",
          zipLabel,
          true,
          ok ? "met" : "unmet",
          `${session.residenceCounty} ${ok ? "is" : "is not"} ${kind}`,
        ),
      );
    }
  } else {
    checks.push(req("zip", "County (ZIP)", false, "na", "Not required"));
  }

  if (program.requiresCitizenOrEligibleImmigrant) {
    if (!immigration) {
      checks.push(
        req("immigration", "Citizen / eligible immigrant", true, "unknown", "Not asked yet"),
      );
    } else {
      checks.push(
        req(
          "immigration",
          "Citizen / eligible immigrant",
          true,
          passesImmigrationGate(program, immigration) ? "met" : "unmet",
          `Answer = ${immigrationLabel(immigration)}`,
        ),
      );
    }
  } else if (program.requiresIneligibleImmigrantStatus) {
    if (!immigration) {
      checks.push(
        req(
          "immigration",
          "Non-citizen programs (CAPI / CFAP)",
          true,
          "unknown",
          "Not asked yet",
        ),
      );
    } else {
      const ok = passesImmigrationGate(program, immigration);
      checks.push(
        req(
          "immigration",
          "Non-citizen programs (CAPI / CFAP)",
          true,
          ok ? "met" : "unmet",
          immigration === "declined"
            ? "Prefer not to say – shown without assuming status"
            : `Answer = ${immigrationLabel(immigration)}`,
        ),
      );
    }
  } else {
    checks.push(req("immigration", "Immigration status", false, "na", "Not required"));
  }

  if (session.alreadyOn.includes(program.id)) {
    checks.push(
      req("already_on", "Not already on this program", true, "unmet", "Marked at gate"),
    );
  } else {
    checks.push(
      req("already_on", "Not already on this program", true, "met", "Not marked at gate"),
    );
  }

  if (program.excludeIfAlreadyOn?.length) {
    const hit = program.excludeIfAlreadyOn.filter((id) =>
      session.alreadyOn.includes(id),
    );
    if (hit.length) {
      checks.push(
        req(
          "exclude",
          "excludeIfAlreadyOn",
          true,
          "unmet",
          `Dropped because already on ${hit.map((id) => getProgram(id)?.name ?? id).join(", ")}`,
        ),
      );
    } else {
      checks.push(
        req(
          "exclude",
          "excludeIfAlreadyOn",
          true,
          "met",
          `Not on ${program.excludeIfAlreadyOn.map((id) => getProgram(id)?.name ?? id).join(", ")}`,
        ),
      );
    }
  }

  return checks;
}

function remainingWithImmigration(
  program: Program,
  session: SessionState,
  immigration: ImmigrationAnswer | null,
): number {
  let n = remainingTriageQuestions(program, session);
  if (
    !immigration &&
    (program.requiresCitizenOrEligibleImmigrant ||
      program.requiresIneligibleImmigrantStatus)
  ) {
    n += 1;
  }
  return n;
}

function classifyProgram(
  program: Program,
  session: SessionState,
  immigration: ImmigrationAnswer | null,
  checks: RequirementCheck[],
): { status: ProgramReviewStatus; reason: string } {
  if (program.id === "tax_credits") {
    return { status: "info_only", reason: "Never offered as a card" };
  }
  if (!session.branch) {
    return { status: "waiting_gate", reason: "Waiting on the categorical gate" };
  }

  const item = session.items.find((i) => i.programId === program.id);
  if (item?.status === "in_progress") {
    return { status: "added_to_guide", reason: "User added to Application Guide" };
  }
  if (item?.status === "done") {
    return {
      status: "already_enrolled",
      reason: item.action || "Already enrolled",
    };
  }
  if (item?.status === "skipped") {
    return { status: "skipped", reason: item.action || "Skipped" };
  }
  if (item?.status === "snoozed") {
    return { status: "snoozed", reason: "Remind later" };
  }

  const qIndex = session.queue.indexOf(program.id);
  if (qIndex === session.queueIndex && session.step === "offer" && qIndex >= 0) {
    return {
      status: "current_offer",
      reason: `Queue position ${qIndex + 1} of ${session.queue.length}`,
    };
  }
  if (qIndex >= session.queueIndex && qIndex >= 0) {
    return {
      status: "in_queue",
      reason: `Queued at position ${qIndex + 1} (offered after current card)`,
    };
  }

  const unmet = checks.find((c) => c.needed && c.state === "unmet");
  if (unmet) return { status: "eliminated", reason: unmet.detail };

  const unknown = checks.find((c) => c.needed && c.state === "unknown");
  if (unknown) {
    const left = remainingWithImmigration(program, session, immigration);
    return {
      status: "locked",
      reason: `${unknown.label} unanswered · ${left} question${left === 1 ? "" : "s"} left`,
    };
  }

  if (!program.branches.includes(session.branch)) {
    return {
      status: "not_in_branch",
      reason: `Not in the ${session.branch.toUpperCase()} arm`,
    };
  }

  return { status: "locked", reason: "Eligible on answers so far but not yet queued" };
}

function whyThisScreen(
  session: SessionState,
  nextGate: TriageGateId | "immigration" | null,
): string {
  switch (session.step) {
    case "opt_in":
      return "First message. User has not tapped Start. Global Help / STOP / free-form feedback apply from here on.";
    case "gate":
      return "After Start. Categorical programs already in the household split YES vs NO and seed docsInHand.";
    case "offer": {
      const id = session.queue[session.queueIndex];
      const p = id ? getProgram(id) : undefined;
      if (!p) return "Offer cursor is past the current wave.";
      const newDocs = missingDocs(p.docsNeeded, session.docsInHand).length;
      return `Current wave still has cards. Ranker put ${p.name} here (newDocs=${newDocs}, timeToMoney=${p.timeToMoneyDays}d, ${session.branch === "yes" ? "yesOrder" : "noOrder"}=${session.branch === "yes" ? p.yesOrder : p.noOrder}). Docs change rank, not eligibility.`;
    }
    case "household_size":
      return "Wave empty. pickNextTriageGate() chose income; household size is still unknown, so that is asked first.";
    case "household_size_custom":
      return "User tapped More on household size. Waiting for a typed count (9–30).";
    case "income_band":
      return `Wave empty. pickNextTriageGate() chose income. Household size is ${session.householdSize}. Income-gated programs stay locked until this answer.`;
    case "past_due":
      return "Wave empty. Past-due is the cheapest remaining gate (unlocks AMP).";
    case "has_utility_bills":
      return "Wave empty. Bills-in-name is the cheapest remaining gate (CARE / FERA / LIHEAP / AMP / Medical Baseline / PG&E rebates).";
    case "has_shared_meter":
      return "Wave empty. Shared-meter is the cheapest remaining gate (CARE / FERA out if another household shares this meter; AMP out if landlord bills / submeter).";
    case "has_shutoff_zone":
      return "Wave empty. PG&E bill on file – ask if they already know they're in a shut-off / high fire-risk area (Yes → offer; No → drop; Use my location → nearest street; Not sure → address check).";
    case "has_shutoff_address":
      return "Waiting on GPS (nearest street) or typed street + city (neither stored). Sloppy input is standardized when we are ≥90% sure of the premise; a clear not-in-zone hides the generator/battery offer.";
    case "has_ca_residency":
      return "Wave empty. A CA-home program would unlock – ask where they live most of the year (not work address).";
    case "has_ca_work":
      return "User lives in another state. Ask whether they work in California before dropping or keeping work-based programs.";
    case "has_buying_ev":
      return "Wave empty. Buying-EV intent is the cheapest remaining gate (MyFirstEV / PG&E EV – after the e-bike thread).";
    case "has_first_time_zev":
      return "Wave empty. First-time ZEV is the cheapest remaining gate (MyFirstEV – after buying-EV intent).";
    case "has_buying_ebike":
      return "Wave empty. Pedal e-bike intent is the cheapest remaining gate (after core household 1q gates; scooters never qualify).";
    case "has_retire_vehicle":
      return "Wave empty. Vehicle retirement is the cheapest remaining gate (after e-bike yes; $7,500 CC4A/DCAP before ZIP).";
    case "has_child":
      return "Wave empty. Child/pregnancy is the cheapest remaining gate (WIC / CalWORKs).";
    case "has_foster_youth":
      return "Wave empty. Foster-youth status is the cheapest remaining gate (Foster Youth Tax Credit).";
    case "has_refugee_status":
      return "Wave empty. Refugee/asylee status is the cheapest remaining gate (Refugee Cash Assistance – after citizen/eligible Yes).";
    case "has_medical_need":
      return "Wave empty. Qualifying medical condition/device is the cheapest remaining gate (Medical Baseline – after bills-in-name).";
    case "has_abd":
      return "Wave empty. ABD is the cheapest remaining gate (SSI / CAPI / IHSS / SSDI).";
    case "has_work_disruption":
      return "Wave empty. Work disruption is the cheapest remaining gate (UI / SDI / PFL – mutually exclusive).";
    case "has_disaster_area":
      return "Live Disaster CalFresh window – asked first after the gate (before other offers) with Yes / No / Not sure.";
    case "has_disaster_zip":
      return "User chose Not sure on the disaster list. Confirm with a residence-or-work ZIP against the active window geography.";
    case "has_zip":
      return "Wave empty. ZIP is the cheapest remaining gate (CMSP / local e-bike county check).";
    case "has_immigration_status":
      return "All cheaper triage gates are done. Immigration is asked late on purpose – status-blind wins first. Answer is process-memory only, not stored on the session. A refugee/asylee follow-up may come next for RCA.";
    case "idle":
      return nextGate
        ? `Should not be idle while ${nextGate} remains – check simulator.`
        : "No more unlockable programs. Reminders armed. Application Guide only if open to-dos exist.";
    default:
      return `On ${session.step}.`;
  }
}

function buildTree(session: SessionState): TreeNode[] {
  const step = session.step;
  const gateAnswer =
    session.branch === "yes"
      ? `YES · ${session.alreadyOn.map((id) => getProgram(id)?.name ?? id).join(", ") || "programs"}`
      : session.branch === "no"
        ? "NO · none"
        : undefined;

  return [
    {
      id: "opt_in",
      label: "OPT_IN",
      kind: "screen",
      active: step === "opt_in",
      note: "Disclaimer · Start",
    },
    {
      id: "gate",
      label: "GATE",
      kind: "screen",
      active: step === "gate",
      answered: gateAnswer,
      note: "Categorical programs already on?",
    },
    {
      id: "yes",
      label: "YES arm",
      kind: "branch",
      active: session.branch === "yes" && step !== "gate" && step !== "opt_in",
      note: "docs: award letter + photo ID + utility bill",
    },
    {
      id: "no",
      label: "NO arm",
      kind: "branch",
      active: session.branch === "no" && step !== "gate" && step !== "opt_in",
      note: "docs: photo ID + utility bill · income later",
    },
    {
      id: "offer",
      label: "OFFER_CARD loop",
      kind: "loop",
      active: step === "offer",
      answered:
        session.queue.length > 0
          ? `${Math.min(session.queueIndex + (step === "offer" ? 1 : 0), session.queue.length)}/${session.queue.length} in current queue`
          : undefined,
      note: "Already · Add to guide · Skip → next card or next gate",
    },
    {
      id: "household_size",
      label: "HOUSEHOLD_SIZE",
      kind: "gate",
      active: step === "household_size" || step === "household_size_custom",
      answered:
        session.householdSize != null ? String(session.householdSize) : undefined,
      note: "NO arm · 1–8 or More (typed) · only when income-gated programs are next",
    },
    {
      id: "income_band",
      label: "INCOME_BAND",
      kind: "gate",
      active: step === "income_band",
      answered:
        session.incomeBand != null ? incomeLabel(session.incomeBand) : undefined,
      note: "CARE / FERA / above · drops or unlocks income-gated offers",
    },
    {
      id: "has_ca_residency",
      label: "HAS_CA_HOME",
      kind: "gate",
      active: step === "has_ca_residency",
      answered:
        session.residencyTie != null && session.step !== "has_ca_work"
          ? residencyTieLabel(session.residencyTie)
          : undefined,
      note: "Unlock-gated · CA home vs other state / visiting",
    },
    {
      id: "has_ca_work",
      label: "HAS_CA_WORK",
      kind: "gate",
      active: step === "has_ca_work",
      answered:
        session.residencyTie === "out_of_state_ca_work" ||
        session.residencyTie === "out_of_state"
          ? residencyTieLabel(session.residencyTie)
          : undefined,
      note: "Only after “another state”",
    },
    {
      id: "has_utility_bills",
      label: "HAS_UTILITY_BILLS",
      kind: "gate",
      active: step === "has_utility_bills",
      answered: utilityBillsAnswered(session)
        ? billsInMyNameLabel(session.billsInMyName)
        : undefined,
      note: "Multiselect · None drops account-in-name programs · after CA home · before past-due",
    },
    {
      id: "has_shared_meter",
      label: "HAS_SHARED_METER",
      kind: "gate",
      active: step === "has_shared_meter",
      answered:
        session.meterSharing != null
          ? meterSharingLabel(session.meterSharing)
          : undefined,
      note: "After bills-in-name · CARE/FERA vs AMP · No/Yes/Landlord",
    },
    {
      id: "has_shutoff_zone",
      label: "HAS_SHUTOFF_ZONE",
      kind: "gate",
      active: step === "has_shutoff_zone" || step === "has_shutoff_address",
      answered:
        session.inShutoffZone != null ? yn(session.inShutoffZone) : undefined,
      note: "Yes = already know · No = drop · Use my location → nearest street · Not sure → type street+city · address/GPS not stored",
    },
    {
      id: "past_due",
      label: "PAST_DUE",
      kind: "gate",
      active: step === "past_due",
      answered: session.pastDue != null ? yn(session.pastDue) : undefined,
      note: "Gates AMP · after bills-in-name",
    },
    {
      id: "has_medical_need",
      label: "HAS_MEDICAL_NEED",
      kind: "gate",
      active: step === "has_medical_need",
      answered:
        session.hasMedicalDeviceOrCondition != null
          ? yn(session.hasMedicalDeviceOrCondition)
          : undefined,
      note: "After bills-in-name · Medical Baseline",
    },
    {
      id: "has_child",
      label: "HAS_CHILD",
      kind: "gate",
      active: step === "has_child",
      answered:
        session.hasChildInHousehold != null
          ? yn(session.hasChildInHousehold)
          : undefined,
      note: "WIC / CalWORKs / CTC / Sun Bucks",
    },
    {
      id: "has_foster_youth",
      label: "HAS_FOSTER_YOUTH",
      kind: "gate",
      active: step === "has_foster_youth",
      answered:
        session.isFosterYouth != null ? yn(session.isFosterYouth) : undefined,
      note: "Foster Youth Tax Credit",
    },
    {
      id: "has_abd",
      label: "HAS_ABD",
      kind: "gate",
      active: step === "has_abd",
      answered:
        session.hasAgedBlindOrDisabled != null
          ? yn(session.hasAgedBlindOrDisabled)
          : undefined,
      note: "SSI / CAPI / IHSS / SSDI",
    },
    {
      id: "has_work_disruption",
      label: "HAS_WORK",
      kind: "gate",
      active: step === "has_work_disruption",
      answered:
        session.workDisruption != null ? workLabel(session.workDisruption) : undefined,
      note: "UI / SDI / PFL (single-select)",
    },
    {
      id: "has_buying_ebike",
      label: "HAS_BUYING_EBIKE",
      kind: "gate",
      active: step === "has_buying_ebike",
      answered:
        session.buyingEbikeThisYear != null
          ? yn(session.buyingEbikeThisYear)
          : undefined,
      note: "After core 1q household gates · pedal e-bike (not scooter)",
    },
    {
      id: "has_retire_vehicle",
      label: "HAS_RETIRE_VEHICLE",
      kind: "gate",
      active: step === "has_retire_vehicle",
      answered:
        session.wouldRetireVehicle != null
          ? yn(session.wouldRetireVehicle)
          : undefined,
      note: "After e-bike yes · $7,500 CC4A/DCAP · before ZIP",
    },
    {
      id: "has_buying_ev",
      label: "HAS_BUYING_EV",
      kind: "gate",
      active: step === "has_buying_ev",
      answered:
        session.buyingEvThisYear != null
          ? yn(session.buyingEvThisYear)
          : undefined,
      note: "After e-bike thread · MyFirstEV / EV rebates",
    },
    {
      id: "has_first_time_zev",
      label: "HAS_FIRST_TIME_ZEV",
      kind: "gate",
      active: step === "has_first_time_zev",
      answered:
        session.firstTimeZev != null ? yn(session.firstTimeZev) : undefined,
      note: "MyFirstEV · then offer card",
    },
    {
      id: "has_disaster_area",
      label: "HAS_DISASTER",
      kind: "gate",
      active: step === "has_disaster_area",
      answered:
        session.inDisasterArea != null ? yn(session.inDisasterArea) : undefined,
      note: hasOfferableDisasterWindow()
        ? "Live window – asked first · Yes/No/Not sure"
        : "No live window (dormant)",
    },
    {
      id: "has_disaster_zip",
      label: "HAS_DISASTER_ZIP",
      kind: "gate",
      active: step === "has_disaster_zip",
      note: "Not sure → residence or work ZIP confirm",
    },
    {
      id: "has_zip",
      label: "HAS_ZIP",
      kind: "gate",
      active: step === "has_zip",
      answered:
        session.residenceZip != null
          ? session.residenceZip
            ? `${session.residenceZip} · ${session.residenceCounty ?? "?"}`
            : "skipped"
          : undefined,
      note: "CMSP and local e-bike county · last among these gates",
    },
    {
      id: "has_immigration_status",
      label: "IMMIGRATION",
      kind: "gate",
      active: step === "has_immigration_status",
      answered: (() => {
        const v = getImmigrationAnswer(session.telegramUserId);
        return v ? immigrationLabel(v) : undefined;
      })(),
      note: "After cheaper gates · not stored on session",
    },
    {
      id: "has_refugee_status",
      label: "HAS_REFUGEE_STATUS",
      kind: "gate",
      active: step === "has_refugee_status",
      answered:
        session.isRefugeeOrAsylee != null
          ? yn(session.isRefugeeOrAsylee)
          : undefined,
      note: "After citizen/eligible Yes · Refugee Cash Assistance",
    },
    {
      id: "idle",
      label: "FINISH / IDLE",
      kind: "screen",
      active: step === "idle",
      note: "Application Guide if open to-dos · reminders armed",
    },
    {
      id: "global",
      label: "Help / STOP / free-form",
      kind: "global",
      active: false,
      note: "Anytime · does not advance the tree",
    },
  ];
}

function emptyCounts(): Record<ProgramReviewStatus, number> {
  return {
    waiting_gate: 0,
    info_only: 0,
    not_in_branch: 0,
    current_offer: 0,
    in_queue: 0,
    added_to_guide: 0,
    already_enrolled: 0,
    skipped: 0,
    snoozed: 0,
    locked: 0,
    eliminated: 0,
  };
}

export async function simulateTreeReview(
  actions: string[],
): Promise<TreeReviewSnapshot> {
  const uid = -Math.floor(1_000_000_000 + Math.random() * 1_000_000_000);
  const session = emptySession(uid);
  let notice: string | null = null;

  try {
    for (const raw of actions) {
      const data = String(raw ?? "").trim();
      if (!data) continue;
      const result = await applyAction(session, data);
      if (result.notice) notice = result.notice;
    }

    const immigration = getImmigrationAnswer(uid);
    const nextTriage = pickNextTriageGate(session);
    const nextGate: TriageGateId | "immigration" | null =
      nextTriage ??
      (session.step !== "idle" && queueNeedsStatusGate(session)
        ? "immigration"
        : session.step === "has_immigration_status"
          ? "immigration"
          : null);

    const programs = loadPrograms().map((program) => {
      const checks = evaluateRequirements(program, session, immigration);
      const { status, reason } = classifyProgram(
        program,
        session,
        immigration,
        checks,
      );
      const qIndex = session.queue.indexOf(program.id);
      return {
        id: program.id,
        name: program.name,
        category: program.category,
        status,
        reason,
        remainingQuestions: remainingWithImmigration(program, session, immigration),
        newDocs: missingDocs(program.docsNeeded, session.docsInHand).length,
        timeToMoneyDays: program.timeToMoneyDays,
        queueIndex: qIndex >= 0 ? qIndex : null,
        requirements: checks,
        docs: program.docsNeeded.map((id) => ({
          id,
          label: docLabel(id),
          inHand: !missingDocs([id], session.docsInHand).length,
        })),
      } satisfies ProgramReviewRow;
    });

    const counts = emptyCounts();
    for (const row of programs) counts[row.status] += 1;

    programs.sort((a, b) => {
      const order: ProgramReviewStatus[] = [
        "current_offer",
        "in_queue",
        "locked",
        "added_to_guide",
        "already_enrolled",
        "snoozed",
        "skipped",
        "eliminated",
        "not_in_branch",
        "info_only",
        "waiting_gate",
      ];
      const d = order.indexOf(a.status) - order.indexOf(b.status);
      if (d !== 0) return d;
      if (a.queueIndex != null && b.queueIndex != null) {
        return a.queueIndex - b.queueIndex;
      }
      if (a.remainingQuestions !== b.remainingQuestions) {
        return a.remainingQuestions - b.remainingQuestions;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      actions: actions.map((a) => String(a)).filter(Boolean),
      notice,
      whyThisScreen: whyThisScreen(session, nextGate),
      nextGate,
      screen: previewScreen(session, actions.length > 0),
      facts: {
        step: session.step,
        branch: session.branch,
        householdSize: session.householdSize,
        incomeBand: session.incomeBand,
        pastDue: session.pastDue,
        utilityBillsAsked: session.utilityBillsAsked,
        billsInMyName: session.billsInMyName,
        billNotInMyName: session.billNotInMyName,
        meterSharing: session.meterSharing,
        inShutoffZone: session.inShutoffZone,
        residencyTie: session.residencyTie,
        isCaResident: session.isCaResident,
        buyingEvThisYear: session.buyingEvThisYear,
        firstTimeZev: session.firstTimeZev,
        buyingEbikeThisYear: session.buyingEbikeThisYear,
        wouldRetireVehicle: session.wouldRetireVehicle,
        hasChildInHousehold: session.hasChildInHousehold,
        isFosterYouth: session.isFosterYouth,
        isRefugeeOrAsylee: session.isRefugeeOrAsylee,
        hasMedicalDeviceOrCondition: session.hasMedicalDeviceOrCondition,
        hasAgedBlindOrDisabled: session.hasAgedBlindOrDisabled,
        workDisruption: session.workDisruption,
        inDisasterArea: session.inDisasterArea,
        residenceZip: session.residenceZip,
        residenceCounty: session.residenceCounty,
        immigrationStatus: immigration,
        docsInHand: session.docsInHand,
        alreadyOn: session.alreadyOn,
        remindersEnabled: session.remindersEnabled,
      },
      queue: {
        ids: session.queue,
        index: session.queueIndex,
        current: session.queue[session.queueIndex] ?? null,
        remaining: session.queue.slice(session.queueIndex),
      },
      counts,
      programs,
      tree: buildTree(session),
      disasterWindowsLive: hasOfferableDisasterWindow(),
      presets: REVIEW_PRESETS,
    };
  } finally {
    clearImmigrationAnswer(uid);
  }
}
