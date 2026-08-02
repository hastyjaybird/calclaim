import { getProgram, loadPrograms } from "../corpus/load.js";
import type {
  Branch,
  DocId,
  IncomeBand,
  Program,
  SessionState,
} from "../corpus/types.js";

function newDocsCount(program: Program, docsInHand: DocId[]): number {
  return program.docsNeeded.filter((d) => !docsInHand.includes(d)).length;
}

function passesIncomeGate(
  program: Program,
  incomeBand: IncomeBand | null,
  branch: Branch,
): boolean {
  if (branch === "yes" || branch === "tax_only") return true;
  if (!program.incomeGate) return true;
  if (!incomeBand) return true;
  if (program.incomeGate === "careBand") return incomeBand === "careBand";
  if (program.incomeGate === "feraBand") return incomeBand === "feraBand";
  if (program.incomeGate === "careOrFeraBand") {
    return incomeBand === "careBand" || incomeBand === "feraBand";
  }
  return true;
}

function includeInBranch(program: Program, branch: Branch): boolean {
  // Tax-credits card removed from offers (user feedback: drop-off / confusion).
  if (program.id === "tax_credits") return false;
  if (branch === "tax_only") return false;
  return program.branches.includes(branch);
}

export function buildQueue(session: SessionState): string[] {
  const branch = session.branch;
  if (!branch) return [];

  const notMyBillIds = session.billNotInMyName
    ? new Set<string>([
        "care",
        "fera",
        ...(getProgram("care")?.skipCascades ?? []),
      ])
    : null;

  const programs = loadPrograms().filter((p) => {
    if (!includeInBranch(p, branch)) return false;
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
    time: p.timeToMoneyDays,
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

/** True when a child-gated program would enter the queue if the user said yes. */
export function queueNeedsChildGate(session: SessionState): boolean {
  if (session.hasChildInHousehold !== null) return false;
  const probe: SessionState = {
    ...session,
    hasChildInHousehold: true,
    // Assume ABD yes so SSI/CAPI don't block the child-gate probe.
    hasAgedBlindOrDisabled: session.hasAgedBlindOrDisabled ?? true,
  };
  return buildQueue(probe).some(
    (id) => getProgram(id)?.requiresChildInHousehold === true,
  );
}

/** True when an ABD-gated program would enter the queue if the user said yes. */
export function queueNeedsAbdGate(session: SessionState): boolean {
  if (session.hasAgedBlindOrDisabled !== null) return false;
  const probe: SessionState = {
    ...session,
    hasAgedBlindOrDisabled: true,
    // Use answered child gate, or assume yes so CalWORKs/WIC don't block probe.
    hasChildInHousehold: session.hasChildInHousehold ?? true,
  };
  return buildQueue(probe).some(
    (id) => getProgram(id)?.requiresAgedBlindOrDisabled === true,
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
