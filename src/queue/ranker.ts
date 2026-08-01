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
  if (branch === "tax_only") return program.id === "tax_credits";
  return program.branches.includes(branch);
}

export function buildQueue(session: SessionState): string[] {
  const branch = session.branch;
  if (!branch) return [];

  const programs = loadPrograms().filter((p) => {
    if (!includeInBranch(p, branch)) return false;
    if (p.requiresPastDue && session.pastDue !== true) return false;
    if (!passesIncomeGate(p, session.incomeBand, branch)) return false;
    if (session.alreadyOn.includes(p.id)) return false;
    return true;
  });

  // FERA on NO+careBand: exclude (CARE covers); on feraBand only FERA incomeGate passes
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
