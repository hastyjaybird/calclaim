import { annualizeMaxBenefitUsd } from "../corpus/benefitEstimate.js";
import { docLabel } from "../corpus/docs.js";
import { getProgram } from "../corpus/load.js";
import type {
  DocId,
  NextStepsItem,
  SessionState,
  TodoStatus,
} from "../corpus/types.js";

function deadlineFields(programId: string): {
  deadlineLabel: string;
  deadlineDate: string | null;
} {
  const p = getProgram(programId);
  const d = p?.deadlines?.[0];
  if (!d) {
    return { deadlineLabel: "", deadlineDate: null };
  }
  return {
    deadlineLabel: d.label,
    deadlineDate: d.date,
  };
}

export function upsertItem(
  session: SessionState,
  programId: string,
  status: TodoStatus,
  actionOverride?: string,
): void {
  const program = getProgram(programId);
  if (!program) return;
  const { deadlineLabel, deadlineDate } = deadlineFields(programId);
  const action =
    actionOverride ??
    (status === "done"
      ? `Already on ${program.name}`
      : status === "skipped"
        ? `Skipped ${program.name}`
        : status === "snoozed"
          ? `Remind later: ${program.name}`
          : `Apply for ${program.name}`);

  const existing = session.items.find((i) => i.programId === programId);
  if (existing) {
    existing.status = status;
    existing.action = action;
    existing.deadlineLabel = deadlineLabel;
    existing.deadlineDate = deadlineDate;
    return;
  }

  const item: NextStepsItem = {
    programId,
    programName: program.name,
    category: program.category,
    action,
    link: program.applyUrl,
    deadlineLabel,
    deadlineDate,
    status,
    docs: program.docsNeeded,
  };
  session.items.push(item);
}

export function markGateAlreadyOn(session: SessionState): void {
  for (const id of session.alreadyOn) {
    upsertItem(session, id, "done", `Already on (gate)`);
  }
}

export function docsToGather(session: SessionState): string[] {
  const open = session.items.filter(
    (i) => i.status === "todo" || i.status === "in_progress" || i.status === "snoozed",
  );
  const set = new Set<string>();
  for (const item of open) {
    for (const d of item.docs) {
      if (!session.docsInHand.includes(d)) set.add(d);
    }
  }
  return [...set];
}

export interface DocSavingsRow {
  docId: DocId;
  label: string;
  /** Sum of annualized max benefits for open programs that still need this doc. */
  annualUsd: number;
  programNames: string[];
}

/**
 * Documents still missing for open todos, ranked by estimated $ they unlock.
 * Each row's $ is the sum of open programs that require that document.
 */
export function docsSavingsTable(session: SessionState): DocSavingsRow[] {
  const open = openTodos(session);
  const byDoc = new Map<DocId, { annualUsd: number; programNames: string[] }>();

  for (const item of open) {
    const program = getProgram(item.programId);
    const annual = program
      ? annualizeMaxBenefitUsd(program, session.householdSize)
      : 0;
    for (const d of item.docs) {
      if (session.docsInHand.includes(d)) continue;
      const row = byDoc.get(d) ?? { annualUsd: 0, programNames: [] };
      row.annualUsd += annual;
      if (!row.programNames.includes(item.programName)) {
        row.programNames.push(item.programName);
      }
      byDoc.set(d, row);
    }
  }

  return [...byDoc.entries()]
    .map(([docId, v]) => ({
      docId,
      label: docLabel(docId),
      annualUsd: v.annualUsd,
      programNames: v.programNames,
    }))
    .sort((a, b) => b.annualUsd - a.annualUsd || a.label.localeCompare(b.label));
}

/** Unique open-program annual total (not a sum of per-doc rows). */
export function openProgramsAnnualUsd(session: SessionState): number {
  let total = 0;
  for (const item of openTodos(session)) {
    const program = getProgram(item.programId);
    if (program) total += annualizeMaxBenefitUsd(program, session.householdSize);
  }
  return total;
}

export function closestDeadline(session: SessionState): NextStepsItem | null {
  const dated = session.items
    .filter(
      (i) =>
        i.deadlineDate &&
        (i.status === "todo" || i.status === "in_progress" || i.status === "snoozed"),
    )
    .sort((a, b) => String(a.deadlineDate).localeCompare(String(b.deadlineDate)));
  return dated[0] ?? null;
}

export function openTodos(session: SessionState): NextStepsItem[] {
  return session.items.filter(
    (i) =>
      i.status === "todo" ||
      i.status === "in_progress" ||
      i.status === "snoozed",
  );
}
