import {
  getImmigrationAnswer,
  passesImmigrationGate,
  type ImmigrationAnswer,
} from "./immigrationMemory.js";
import { missingDocs } from "../library/docs.js";
import { passesCountyEligibility, programNeedsZip } from "../library/geo.js";
import { getProgram, loadPrograms } from "../library/load.js";
import {
  isHeldFromOffer,
  programAvailability,
} from "../library/requirements.js";
import type {
  Branch,
  DocId,
  IncomeBand,
  Program,
  SessionState,
} from "../library/types.js";
import { passesCaHomeGate, programNeedsCaHome } from "../library/residency.js";
import {
  programNeedsShutoffZone,
  sessionHasPgeBill,
  shutoffZoneAnswered,
} from "../library/pgeShutoff.js";
import {
  ALL_UTILITY_BILLS,
  hasNoBillsInName,
  passesBillInNameGate,
  programNeedsBillInName,
  utilityBillsAnswered,
} from "../library/utilityBills.js";
import {
  meterSharingAnswered,
  passesMeterSharingGate,
  programNeedsMeterSharingGate,
} from "../library/sharedMeter.js";
import {
  daysUntilOpen,
  hasOfferableDisasterWindow,
  windowForProgram,
} from "../disaster/liveWindow.js";

export type { ImmigrationAnswer };

export interface BuildQueueOptions {
  /** Override process-memory answer (probes / applying a just-tapped answer). */
  immigrationStatus?: ImmigrationAnswer | null;
  /**
   * Include waitlisted / paused / closed programs in the queue so callers can
   * discover who would qualify if enrollment reopened. Default false = hold
   * them out of the offer tree.
   */
  includeHeld?: boolean;
}

/** Deferred triage questions asked only when they unlock the next offer wave. */
export type TriageGateId =
  | "income"
  | "past_due"
  | "utility_bills"
  | "shared_meter"
  | "shutoff_zone"
  | "ca_residency"
  | "buying_ev"
  | "first_time_zev"
  | "buying_ebike"
  | "retire_vehicle"
  | "child"
  | "foster_youth"
  | "refugee"
  | "medical_need"
  | "abd"
  | "work"
  | "disaster"
  | "zip";

function newDocsCount(program: Program, docsInHand: DocId[]): number {
  return missingDocs(program.docsNeeded, docsInHand).length;
}

function passesIncomeGate(
  program: Program,
  incomeBand: IncomeBand | null,
  branch: Branch,
): boolean {
  if (branch === "yes" || branch === "tax_only") return true;
  if (!program.incomeGate) return true;
  // Unknown income = not yet eligible (ask right before income-gated offers).
  if (!incomeBand) return false;
  if (program.incomeGate === "careBand") return incomeBand === "careBand";
  if (program.incomeGate === "feraBand") return incomeBand === "feraBand";
  if (program.incomeGate === "careOrFeraBand") {
    return incomeBand === "careBand" || incomeBand === "feraBand";
  }
  return true;
}

/**
 * Days until money for ranking. Disaster CalFresh pays within three days of
 * applying, but a window that opens next week cannot pay before it opens, so the
 * wait is added in. Without this the card outranks programs that pay sooner.
 */
function effectiveTimeToMoney(program: Program): number {
  if (!program.requiresActiveDisasterWindow) return program.timeToMoneyDays;
  const window = windowForProgram(program);
  if (!window) return program.timeToMoneyDays;
  return program.timeToMoneyDays + daysUntilOpen(window);
}

function includeInBranch(program: Program, branch: Branch): boolean {
  // Tax-credits card removed from offers (user feedback: drop-off / confusion).
  if (program.id === "tax_credits") return false;
  if (branch === "tax_only") return false;
  return program.branches.includes(branch);
}

function resolveImmigrationStatus(
  session: SessionState,
  opts?: BuildQueueOptions,
): ImmigrationAnswer | null {
  if (opts && "immigrationStatus" in opts) {
    return opts.immigrationStatus ?? null;
  }
  return getImmigrationAnswer(session.telegramUserId);
}

export function buildQueue(
  session: SessionState,
  opts?: BuildQueueOptions,
): string[] {
  const branch = session.branch;
  if (!branch) return [];

  const immigrationStatus = resolveImmigrationStatus(session, opts);

  // Disaster CalFresh only exists around a county application window; with no
  // approved window it cannot be applied for by anyone, so it leaves the queue.
  const windowOffered = hasOfferableDisasterWindow();

  const programs = loadPrograms().filter((p) => {
    if (!includeInBranch(p, branch)) return false;
    if (!passesImmigrationGate(p, immigrationStatus)) return false;
    if (p.requiresActiveDisasterWindow) {
      if (!windowOffered) return false;
      if (session.inDisasterArea !== true) return false;
    }
    if (p.requiresPastDue && session.pastDue !== true) return false;
    if (!passesCaHomeGate(p, session.residencyTie)) return false;
    if (programNeedsBillInName(p)) {
      if (!utilityBillsAnswered(session)) return false;
      if (!passesBillInNameGate(p, session.billsInMyName)) return false;
    }
    if (programNeedsMeterSharingGate(p)) {
      if (!meterSharingAnswered(session)) return false;
      if (!passesMeterSharingGate(p, session.meterSharing)) return false;
    }
    if (programNeedsShutoffZone(p)) {
      if (!shutoffZoneAnswered(session)) return false;
      if (session.inShutoffZone !== true) return false;
    }
    if (p.requiresBuyingEvThisYear && session.buyingEvThisYear !== true) {
      return false;
    }
    if (p.requiresFirstTimeZev && session.firstTimeZev !== true) {
      return false;
    }
    if (p.requiresBuyingEbikeThisYear && session.buyingEbikeThisYear !== true) {
      return false;
    }
    if (p.requiresVehicleRetirement && session.wouldRetireVehicle !== true) {
      return false;
    }
    if (p.requiresChildInHousehold && session.hasChildInHousehold !== true) {
      return false;
    }
    if (p.requiresFosterYouth && session.isFosterYouth !== true) {
      return false;
    }
    if (p.requiresRefugeeOrAsylee && session.isRefugeeOrAsylee !== true) {
      return false;
    }
    if (
      p.requiresMedicalDeviceOrCondition &&
      session.hasMedicalDeviceOrCondition !== true
    ) {
      return false;
    }
    if (
      p.requiresAgedBlindOrDisabled &&
      session.hasAgedBlindOrDisabled !== true
    ) {
      return false;
    }
    if (
      p.requiresWorkDisruption &&
      session.workDisruption !== p.requiresWorkDisruption
    ) {
      return false;
    }
    // ZIP unanswered → county unknown → not yet eligible for CMSP / local e-bike.
    if (!passesCountyEligibility(p, session.residenceCounty)) {
      return false;
    }
    if (!passesIncomeGate(p, session.incomeBand, branch)) return false;
    if (session.alreadyOn.includes(p.id)) return false;
    if (
      p.excludeIfAlreadyOn?.some((id) => session.alreadyOn.includes(id))
    ) {
      return false;
    }
    // Waitlisted / paused / enrollment closed – held out of the offer tree
    // unless a reopen-watch probe asks to include them.
    if (
      !opts?.includeHeld &&
      isHeldFromOffer(programAvailability(p).status)
    ) {
      return false;
    }
    return true;
  });

  // FERA on NO+careBand: exclude (CARE covers the lower band).
  const filtered =
    branch === "no" && session.incomeBand === "careBand"
      ? programs.filter((p) => p.id !== "fera")
      : programs;

  const scored = filtered.map((p) => ({
    id: p.id,
    newDocs: newDocsCount(p, session.docsInHand),
    time: effectiveTimeToMoney(p),
    order: branch === "yes" ? p.yesOrder : p.noOrder,
    elim: p.skipCascades.length,
  }));

  scored.sort((a, b) => {
    if (a.newDocs !== b.newDocs) return a.newDocs - b.newDocs;
    if (a.time !== b.time) return a.time - b.time;
    if (a.order !== b.order) return a.order - b.order;
    return b.elim - a.elim;
  });

  return scored.map((s) => s.id);
}

export function currentProgram(session: SessionState): Program | undefined {
  const id = session.queue[session.queueIndex];
  return id ? getProgram(id) : undefined;
}

/**
 * Fill only still-null triage fields so a single-gate probe isn't blocked by
 * other unanswered questions. Already-answered no/false values stay put.
 */
function withOptimisticGates(
  session: SessionState,
  overrides: Partial<SessionState> = {},
): SessionState {
  return {
    ...session,
    householdSize: session.householdSize ?? 1,
    incomeBand:
      session.incomeBand ??
      (session.branch === "no" ? "careBand" : session.incomeBand),
    pastDue: session.pastDue ?? true,
    utilityBillsAsked: true,
    billsInMyName:
      utilityBillsAnswered(session) && session.billsInMyName.length > 0
        ? session.billsInMyName
        : [...ALL_UTILITY_BILLS],
    billNotInMyName: false,
    meterSharing: session.meterSharing ?? "own",
    inShutoffZone: session.inShutoffZone ?? true,
    shutoffAddressChoices: null,
    residencyTie: session.residencyTie ?? "ca_home",
    isCaResident: session.isCaResident ?? true,
    buyingEvThisYear: session.buyingEvThisYear ?? true,
    firstTimeZev: session.firstTimeZev ?? true,
    buyingEbikeThisYear: session.buyingEbikeThisYear ?? true,
    wouldRetireVehicle: session.wouldRetireVehicle ?? true,
    hasChildInHousehold: session.hasChildInHousehold ?? true,
    isFosterYouth: session.isFosterYouth ?? true,
    isRefugeeOrAsylee: session.isRefugeeOrAsylee ?? true,
    hasMedicalDeviceOrCondition: session.hasMedicalDeviceOrCondition ?? true,
    hasAgedBlindOrDisabled: session.hasAgedBlindOrDisabled ?? true,
    workDisruption: session.workDisruption ?? "job_loss",
    inDisasterArea: session.inDisasterArea ?? true,
    residenceZip: session.residenceZip ?? "95476",
    residenceCounty: session.residenceCounty ?? "Sonoma",
    ...overrides,
  };
}

/** How many chat questions remain before this program can be offered. */
export function remainingTriageQuestions(
  program: Program,
  session: SessionState,
): number {
  let n = 0;
  if (session.branch === "no" && program.incomeGate && session.incomeBand === null) {
    n += session.householdSize == null ? 2 : 1;
  }
  if (program.requiresPastDue && session.pastDue === null) n += 1;
  if (programNeedsBillInName(program) && !utilityBillsAnswered(session)) n += 1;
  if (programNeedsMeterSharingGate(program) && !meterSharingAnswered(session)) {
    n += 1;
  }
  if (programNeedsShutoffZone(program) && !shutoffZoneAnswered(session)) n += 1;
  if (programNeedsCaHome(program) && session.residencyTie === null) n += 1;
  if (program.requiresBuyingEvThisYear && session.buyingEvThisYear === null) {
    n += 1;
  }
  if (program.requiresFirstTimeZev && session.firstTimeZev === null) {
    n += 1;
  }
  if (program.requiresBuyingEbikeThisYear && session.buyingEbikeThisYear === null) {
    n += 1;
  }
  if (program.requiresVehicleRetirement && session.wouldRetireVehicle === null) {
    n += 1;
  }
  if (program.requiresChildInHousehold && session.hasChildInHousehold === null) {
    n += 1;
  }
  if (program.requiresFosterYouth && session.isFosterYouth === null) {
    n += 1;
  }
  if (program.requiresRefugeeOrAsylee && session.isRefugeeOrAsylee === null) {
    n += 1;
  }
  if (
    program.requiresMedicalDeviceOrCondition &&
    session.hasMedicalDeviceOrCondition === null
  ) {
    n += 1;
  }
  if (
    program.requiresAgedBlindOrDisabled &&
    session.hasAgedBlindOrDisabled === null
  ) {
    n += 1;
  }
  if (program.requiresWorkDisruption && session.workDisruption === null) n += 1;
  if (
    program.requiresActiveDisasterWindow &&
    hasOfferableDisasterWindow() &&
    session.inDisasterArea === null
  ) {
    n += 1;
  }
  if (programNeedsZip(program) && session.residenceZip === null) n += 1;
  return n;
}

function gateStillOpen(gate: TriageGateId, session: SessionState): boolean {
  switch (gate) {
    case "income":
      return session.branch === "no" && session.incomeBand === null;
    case "past_due":
      return session.pastDue === null;
    case "utility_bills":
      return !utilityBillsAnswered(session);
    case "shared_meter":
      return (
        session.meterSharing === null &&
        utilityBillsAnswered(session) &&
        !hasNoBillsInName(session)
      );
    case "shutoff_zone":
      return (
        !shutoffZoneAnswered(session) &&
        utilityBillsAnswered(session) &&
        sessionHasPgeBill(session)
      );
    case "ca_residency":
      return session.residencyTie === null && session.step !== "has_ca_work";
    case "buying_ev":
      return session.buyingEvThisYear === null;
    case "first_time_zev":
      return session.firstTimeZev === null;
    case "buying_ebike":
      return session.buyingEbikeThisYear === null;
    case "retire_vehicle":
      return session.wouldRetireVehicle === null;
    case "child":
      return session.hasChildInHousehold === null;
    case "foster_youth":
      return session.isFosterYouth === null;
    case "refugee":
      return session.isRefugeeOrAsylee === null;
    case "medical_need":
      return session.hasMedicalDeviceOrCondition === null;
    case "abd":
      return session.hasAgedBlindOrDisabled === null;
    case "work":
      return session.workDisruption === null;
    case "disaster":
      return session.inDisasterArea === null && hasOfferableDisasterWindow();
    case "zip":
      // Home ZIP only helps CA-home county programs (CMSP).
      return (
        session.residenceZip === null &&
        (session.residencyTie === null || session.residencyTie === "ca_home")
      );
  }
}

function programUsesGate(
  program: Program,
  gate: TriageGateId,
  session: SessionState,
): boolean {
  switch (gate) {
    case "income":
      return session.branch === "no" && Boolean(program.incomeGate);
    case "past_due":
      return program.requiresPastDue === true;
    case "utility_bills":
      return programNeedsBillInName(program);
    case "shared_meter":
      return programNeedsMeterSharingGate(program);
    case "shutoff_zone":
      return programNeedsShutoffZone(program);
    case "ca_residency":
      return programNeedsCaHome(program);
    case "buying_ev":
      return program.requiresBuyingEvThisYear === true;
    case "first_time_zev":
      return program.requiresFirstTimeZev === true;
    case "buying_ebike":
      return program.requiresBuyingEbikeThisYear === true;
    case "retire_vehicle":
      return program.requiresVehicleRetirement === true;
    case "child":
      return program.requiresChildInHousehold === true;
    case "foster_youth":
      return program.requiresFosterYouth === true;
    case "refugee":
      return program.requiresRefugeeOrAsylee === true;
    case "medical_need":
      return program.requiresMedicalDeviceOrCondition === true;
    case "abd":
      return program.requiresAgedBlindOrDisabled === true;
    case "work":
      return Boolean(program.requiresWorkDisruption);
    case "disaster":
      return program.requiresActiveDisasterWindow === true;
    case "zip":
      return programNeedsZip(program);
  }
}

/**
 * Programs that would newly become offerable if this gate were answered
 * favorably (other unanswered gates assumed yes so multi-gate programs count).
 */
function programsUnlockedByGate(
  session: SessionState,
  gate: TriageGateId,
): Program[] {
  if (gate === "zip") {
    const found: Program[] = [];
    const seen = new Set<string>();
    for (const p of loadPrograms()) {
      if (!programUsesGate(p, "zip", session)) continue;
      const county = p.eligibleCounties?.[0] ?? "Sonoma";
      const ids = buildQueue(
        withOptimisticGates(session, {
          residenceZip: "99999",
          residenceCounty: county,
        }),
      );
      if (ids.includes(p.id) && !seen.has(p.id)) {
        seen.add(p.id);
        found.push(p);
      }
    }
    return found;
  }

  if (gate === "work") {
    const found: Program[] = [];
    const seen = new Set<string>();
    for (const reason of ["job_loss", "health", "family_care"] as const) {
      const ids = buildQueue(
        withOptimisticGates(session, { workDisruption: reason }),
      );
      for (const id of ids) {
        const p = getProgram(id);
        if (!p || p.requiresWorkDisruption !== reason) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        found.push(p);
      }
    }
    return found;
  }

  const overrides: Partial<SessionState> = {};
  switch (gate) {
    case "income":
      overrides.incomeBand = "careBand";
      overrides.householdSize = session.householdSize ?? 1;
      break;
    case "past_due":
      overrides.pastDue = true;
      break;
    case "utility_bills":
      overrides.utilityBillsAsked = true;
      overrides.billsInMyName = [...ALL_UTILITY_BILLS];
      overrides.billNotInMyName = false;
      break;
    case "shared_meter":
      overrides.meterSharing = "own";
      break;
    case "shutoff_zone":
      overrides.inShutoffZone = true;
      overrides.shutoffAddressChoices = null;
      break;
    case "ca_residency":
      overrides.residencyTie = "ca_home";
      overrides.isCaResident = true;
      break;
    case "buying_ev":
      overrides.buyingEvThisYear = true;
      break;
    case "first_time_zev":
      overrides.firstTimeZev = true;
      break;
    case "buying_ebike":
      overrides.buyingEbikeThisYear = true;
      break;
    case "retire_vehicle":
      overrides.wouldRetireVehicle = true;
      break;
    case "child":
      overrides.hasChildInHousehold = true;
      break;
    case "foster_youth":
      overrides.isFosterYouth = true;
      break;
    case "refugee":
      overrides.isRefugeeOrAsylee = true;
      break;
    case "medical_need":
      overrides.hasMedicalDeviceOrCondition = true;
      break;
    case "abd":
      overrides.hasAgedBlindOrDisabled = true;
      break;
    case "disaster":
      overrides.inDisasterArea = true;
      break;
  }

  return buildQueue(withOptimisticGates(session, overrides))
    .map((id) => getProgram(id))
    .filter((p): p is Program => {
      if (!p) return false;
      return programUsesGate(p, gate, session);
    });
}

/**
 * Tie-break order when two open gates unlock programs with the same remaining
 * question count. Cheaper remainingQ always wins; this list only decides ties.
 *
 * Household/bill 1-question gates sit before transportation so a scrap-car or
 * first-ZEV follow-up cannot beat WIC / SSI / UI on a 1q tie. Within
 * transportation: pedal e-bike before EV (more plausible for this audience),
 * then scrap (statewide $7,500, yes/no) before ZIP (typing; only a few
 * counties have a no-scrap rebate). ZIP is last so CMSP’s 1q county check
 * still outranks a 2q e-bike/EV intent.
 */
export const TRIAGE_GATE_ASK_ORDER: readonly TriageGateId[] = [
  "income",
  "ca_residency",
  "utility_bills",
  "shared_meter",
  "shutoff_zone",
  "past_due",
  "medical_need",
  "child",
  "foster_youth",
  "refugee",
  "abd",
  "work",
  "buying_ebike",
  "retire_vehicle",
  "buying_ev",
  "first_time_zev",
  "zip",
];

/**
 * Next question to ask. Live Disaster CalFresh windows jump the queue – the
 * application period is short, so ask before other triage. Otherwise pick the
 * open gate that unlocks programs with the fewest remaining triage questions.
 */
export function pickNextTriageGate(session: SessionState): TriageGateId | null {
  if (
    gateStillOpen("disaster", session) &&
    programsUnlockedByGate(session, "disaster").length > 0
  ) {
    return "disaster";
  }

  const gates = TRIAGE_GATE_ASK_ORDER;

  let best: TriageGateId | null = null;
  let bestMinQ = Infinity;

  for (const gate of gates) {
    if (!gateStillOpen(gate, session)) continue;
    const unlocked = programsUnlockedByGate(session, gate);
    if (unlocked.length === 0) continue;
    const minQ = Math.min(
      ...unlocked.map((p) => remainingTriageQuestions(p, session)),
    );
    if (minQ < bestMinQ) {
      bestMinQ = minQ;
      best = gate;
    }
  }

  return best;
}

/**
 * Append programs that are eligible with answers so far, ranked fewest-docs /
 * fastest-pay. Does not reset queueIndex – earlier waves stay behind the cursor.
 */
export function extendOfferQueue(
  session: SessionState,
  opts?: BuildQueueOptions,
): void {
  const resolved = new Set(session.items.map((i) => i.programId));
  const have = new Set(session.queue);
  for (const id of buildQueue(session, opts)) {
    if (resolved.has(id) || have.has(id)) continue;
    session.queue.push(id);
    have.add(id);
  }
}

/**
 * Programs still ahead on offer cards: the current card, later cards in the
 * queue (not yet seen), and programs still locked behind unanswered gates
 * (not yet unlocked). Mutually exclusive forks (work disruption, immigration)
 * count each program at most once via a union of favorable probes.
 */
export function countRemainingOfferPrograms(session: SessionState): number {
  const done = new Set<string>(session.items.map((i) => i.programId));
  for (const id of session.alreadyOn) done.add(id);
  for (let i = 0; i < session.queueIndex; i++) {
    const id = session.queue[i];
    if (id) done.add(id);
  }

  const remaining = new Set<string>();
  const addIfOpen = (id: string): void => {
    if (!done.has(id)) remaining.add(id);
  };

  for (let i = session.queueIndex; i < session.queue.length; i++) {
    const id = session.queue[i];
    if (id) addIfOpen(id);
  }

  const probe = withOptimisticGates(session);
  for (const id of buildQueue(probe)) addIfOpen(id);

  if (session.workDisruption === null) {
    for (const reason of ["job_loss", "health", "family_care"] as const) {
      for (const id of buildQueue(
        withOptimisticGates(session, { workDisruption: reason }),
      )) {
        addIfOpen(id);
      }
    }
  }

  if (getImmigrationAnswer(session.telegramUserId) === null) {
    for (const status of ["eligible", "ineligible"] as const) {
      for (const id of buildQueue(probe, { immigrationStatus: status })) {
        addIfOpen(id);
      }
    }
  }

  return remaining.size;
}

/** Parenthetical for offer cards, e.g. "(3 programs remaining)". */
export function formatProgramsRemaining(session: SessionState): string {
  const n = countRemainingOfferPrograms(session);
  return n === 1 ? "(1 program remaining)" : `(${n} programs remaining)`;
}

/**
 * Upper-bound count of experience screens still ahead after the current one
 * (open triage gates on the max path, remaining offer cards, immigration /
 * reopen prompts, and the finish screen). Used for percent-through analytics.
 */
export function estimateMaxScreensRemaining(session: SessionState): number {
  if (session.step === "idle") return 0;

  let gates = 0;
  const gateOrder: TriageGateId[] = ["disaster", ...TRIAGE_GATE_ASK_ORDER];

  for (const gate of gateOrder) {
    if (!gateStillOpen(gate, session)) continue;
    if (programsUnlockedByGate(session, gate).length === 0) continue;
    if (gate === "income") {
      gates += session.householdSize == null ? 2 : 1;
    } else if (
      gate === "ca_residency" ||
      gate === "shutoff_zone" ||
      gate === "disaster"
    ) {
      // Parent gate + possible follow-up (work / address / disaster ZIP).
      gates += 2;
    } else {
      gates += 1;
    }
  }

  // Follow-ups already in progress (parent gate closed, child step open).
  if (session.step === "has_ca_work") gates += 1;
  if (session.step === "has_shutoff_address") gates += 1;
  if (session.step === "has_disaster_zip") gates += 1;
  if (session.step === "household_size_custom") gates += 1;

  let offers = countRemainingOfferPrograms(session);
  // Current offer card is being seen now – count only cards after this one.
  if (session.step === "offer" && offers > 0) offers -= 1;

  // Current gate screen is being seen now – don't double-count it in remaining.
  const nonGateSteps = new Set([
    "offer",
    "opt_in",
    "gate",
    "has_immigration_status",
    "has_reopen_notify",
    "help_menu",
    "confirm_stop",
    "confirm_erase",
  ]);
  if (!nonGateSteps.has(session.step) && gates > 0) gates -= 1;

  let n = gates + offers;

  if (
    session.step === "has_immigration_status" ||
    queueNeedsStatusGate(session)
  ) {
    // If we're on the immigration screen, it is current (not remaining).
    if (session.step !== "has_immigration_status") n += 1;
  }

  if (session.step === "has_reopen_notify") {
    // current – not remaining
  } else if (session.reopenNotifyOptIn === null) {
    // May still ask; cheap upper bound (+1) when finish is reachable.
    n += 1;
  }

  // Finish / Application Guide screen.
  n += 1;
  return Math.max(0, n);
}

/**
 * True when status-blind waves + triage gates are done, but answering
 * immigration status could unlock more programs. Asked last on purpose so
 * households get wins before a sensitive question.
 */
export function queueNeedsStatusGate(session: SessionState): boolean {
  if (getImmigrationAnswer(session.telegramUserId) !== null) return false;
  if (pickNextTriageGate(session)) return false;

  const have = new Set([
    ...session.queue,
    ...session.items.map((i) => i.programId),
  ]);
  for (const status of ["eligible", "ineligible"] as const) {
    const probe = withOptimisticGates(session);
    for (const id of buildQueue(probe, { immigrationStatus: status })) {
      if (!have.has(id)) return true;
    }
  }
  return false;
}

/** @deprecated Prefer pickNextTriageGate – kept for status probes / callers. */
export function queueNeedsChildGate(session: SessionState): boolean {
  return (
    gateStillOpen("child", session) &&
    programsUnlockedByGate(session, "child").length > 0
  );
}

export function queueNeedsAbdGate(session: SessionState): boolean {
  return (
    gateStillOpen("abd", session) &&
    programsUnlockedByGate(session, "abd").length > 0
  );
}

export function queueNeedsWorkGate(session: SessionState): boolean {
  return (
    gateStillOpen("work", session) &&
    programsUnlockedByGate(session, "work").length > 0
  );
}

export function queueNeedsDisasterGate(session: SessionState): boolean {
  return (
    gateStillOpen("disaster", session) &&
    programsUnlockedByGate(session, "disaster").length > 0
  );
}

export function queueNeedsZipGate(session: SessionState): boolean {
  return (
    gateStillOpen("zip", session) &&
    programsUnlockedByGate(session, "zip").length > 0
  );
}

export function queueNeedsIncomeGate(session: SessionState): boolean {
  return (
    gateStillOpen("income", session) &&
    programsUnlockedByGate(session, "income").length > 0
  );
}

export function queueNeedsPastDueGate(session: SessionState): boolean {
  return (
    gateStillOpen("past_due", session) &&
    programsUnlockedByGate(session, "past_due").length > 0
  );
}

export function queueNeedsCaResidencyGate(session: SessionState): boolean {
  return (
    gateStillOpen("ca_residency", session) &&
    programsUnlockedByGate(session, "ca_residency").length > 0
  );
}

export function queueNeedsBuyingEvGate(session: SessionState): boolean {
  return (
    gateStillOpen("buying_ev", session) &&
    programsUnlockedByGate(session, "buying_ev").length > 0
  );
}

export function queueNeedsFirstTimeZevGate(session: SessionState): boolean {
  return (
    gateStillOpen("first_time_zev", session) &&
    programsUnlockedByGate(session, "first_time_zev").length > 0
  );
}

export function queueNeedsBuyingEbikeGate(session: SessionState): boolean {
  return (
    gateStillOpen("buying_ebike", session) &&
    programsUnlockedByGate(session, "buying_ebike").length > 0
  );
}

export function queueNeedsRetireVehicleGate(session: SessionState): boolean {
  return (
    gateStillOpen("retire_vehicle", session) &&
    programsUnlockedByGate(session, "retire_vehicle").length > 0
  );
}

export function queueNeedsFosterYouthGate(session: SessionState): boolean {
  return (
    gateStillOpen("foster_youth", session) &&
    programsUnlockedByGate(session, "foster_youth").length > 0
  );
}

export function queueNeedsRefugeeGate(session: SessionState): boolean {
  return (
    gateStillOpen("refugee", session) &&
    programsUnlockedByGate(session, "refugee").length > 0
  );
}

export function queueNeedsMedicalNeedGate(session: SessionState): boolean {
  return (
    gateStillOpen("medical_need", session) &&
    programsUnlockedByGate(session, "medical_need").length > 0
  );
}

export function queueNeedsSharedMeterGate(session: SessionState): boolean {
  return (
    gateStillOpen("shared_meter", session) &&
    programsUnlockedByGate(session, "shared_meter").length > 0
  );
}

export function applySkipCascade(
  session: SessionState,
  programId: string,
  reason?: string,
): string[] {
  const program = getProgram(programId);
  const dropped = new Set<string>([programId]);

  if (programId === "care" && reason === "not_my_bill" && program) {
    for (const id of program.skipCascades) dropped.add(id);
  }

  session.queue = session.queue.filter(
    (id, idx) => idx <= session.queueIndex || !dropped.has(id),
  );
  return [...dropped];
}
