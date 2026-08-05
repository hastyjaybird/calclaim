import {
  getImmigrationAnswer,
  type ImmigrationAnswer,
} from "./immigrationMemory.js";
import { missingDocs } from "../library/docs.js";
import { isCmspCounty } from "../library/geo.js";
import { getProgram, loadPrograms } from "../library/load.js";
import type {
  Branch,
  DocId,
  IncomeBand,
  Program,
  SessionState,
} from "../library/types.js";
import {
  daysUntilOpen,
  hasOfferableDisasterWindow,
  windowForProgram,
} from "../disaster/liveWindow.js";

export type { ImmigrationAnswer };

export interface BuildQueueOptions {
  /** Override process-memory answer (probes / applying a just-tapped answer). */
  immigrationStatus?: ImmigrationAnswer | null;
}

/** Deferred triage questions asked only when they unlock the next offer wave. */
export type TriageGateId =
  | "income"
  | "past_due"
  | "child"
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

function passesImmigrationGate(
  program: Program,
  status: ImmigrationAnswer | null,
): boolean {
  if (program.requiresCitizenOrEligibleImmigrant) {
    return status === "eligible";
  }
  if (program.requiresIneligibleImmigrantStatus) {
    return status === "ineligible";
  }
  return true;
}

export function buildQueue(
  session: SessionState,
  opts?: BuildQueueOptions,
): string[] {
  const branch = session.branch;
  if (!branch) return [];

  const immigrationStatus = resolveImmigrationStatus(session, opts);

  const notMyBillIds = session.billNotInMyName
    ? new Set<string>([
        "care",
        "fera",
        ...(getProgram("care")?.skipCascades ?? []),
      ])
    : null;

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
    if (p.requiresChildInHousehold && session.hasChildInHousehold !== true) {
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
    // ZIP unanswered → county unknown → not yet eligible for CMSP.
    if (p.requiresCmspCounty && !isCmspCounty(session.residenceCounty)) {
      return false;
    }
    if (notMyBillIds?.has(p.id)) return false;
    if (!passesIncomeGate(p, session.incomeBand, branch)) return false;
    if (session.alreadyOn.includes(p.id)) return false;
    if (
      p.excludeIfAlreadyOn?.some((id) => session.alreadyOn.includes(id))
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
    hasChildInHousehold: session.hasChildInHousehold ?? true,
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
  if (program.requiresChildInHousehold && session.hasChildInHousehold === null) {
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
  if (program.requiresCmspCounty && session.residenceZip === null) n += 1;
  return n;
}

function gateStillOpen(gate: TriageGateId, session: SessionState): boolean {
  switch (gate) {
    case "income":
      return session.branch === "no" && session.incomeBand === null;
    case "past_due":
      return session.pastDue === null;
    case "child":
      return session.hasChildInHousehold === null;
    case "abd":
      return session.hasAgedBlindOrDisabled === null;
    case "work":
      return session.workDisruption === null;
    case "disaster":
      return session.inDisasterArea === null && hasOfferableDisasterWindow();
    case "zip":
      return session.residenceZip === null;
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
    case "child":
      return program.requiresChildInHousehold === true;
    case "abd":
      return program.requiresAgedBlindOrDisabled === true;
    case "work":
      return Boolean(program.requiresWorkDisruption);
    case "disaster":
      return program.requiresActiveDisasterWindow === true;
    case "zip":
      return program.requiresCmspCounty === true;
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
    case "child":
      overrides.hasChildInHousehold = true;
      break;
    case "abd":
      overrides.hasAgedBlindOrDisabled = true;
      break;
    case "disaster":
      overrides.inDisasterArea = true;
      break;
    case "zip":
      overrides.residenceZip = "95476";
      overrides.residenceCounty = "Sonoma";
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
 * Next question to ask: the open gate that unlocks programs with the fewest
 * remaining triage questions (so dropouts still hear about easy wins first).
 */
export function pickNextTriageGate(session: SessionState): TriageGateId | null {
  const gates: TriageGateId[] = [
    "income",
    "past_due",
    "child",
    "abd",
    "work",
    "disaster",
    "zip",
  ];

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
 * fastest-pay. Does not reset queueIndex — earlier waves stay behind the cursor.
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

/** @deprecated Prefer pickNextTriageGate — kept for status probes / callers. */
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
