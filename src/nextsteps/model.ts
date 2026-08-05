import { annualizeMaxBenefitUsd } from "../library/benefitEstimate.js";
import { docLabel, hasDoc } from "../library/docs.js";
import { getProgram } from "../library/load.js";
import { programDifficulty } from "../library/requirements.js";
import type {
  DocId,
  NextStepsItem,
  SessionState,
  TodoStatus,
} from "../library/types.js";
import { formatApplyPeriods } from "../disaster/format.js";
import { lastApplyDay, windowForProgram } from "../disaster/liveWindow.js";

function deadlineFields(programId: string): {
  deadlineLabel: string;
  deadlineDate: string | null;
} {
  const p = getProgram(programId);
  if (p) {
    // An approved disaster window has real dates; the library row only has the
    // "windows only" caveat, which reminders cannot act on.
    const window = windowForProgram(p);
    if (window) {
      return {
        deadlineLabel: `Apply ${formatApplyPeriods(window.applyPeriods)} only`,
        deadlineDate: lastApplyDay(window),
      };
    }
  }
  const d = p?.deadlines?.[0];
  if (!d) {
    return { deadlineLabel: "", deadlineDate: null };
  }
  return {
    deadlineLabel: d.label,
    deadlineDate: d.date,
  };
}

/** Per-event phone or URL beats the library apply link during a window. */
function applyLink(programId: string): string {
  const p = getProgram(programId);
  if (!p) return "";
  const window = windowForProgram(p);
  return window?.applyUrl ?? p.applyUrl;
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
  const window = windowForProgram(program);
  // Phone-only D-CalFresh operations have no apply URL, so the phone number has
  // to travel in the action text or it never reaches the Application Guide PDF.
  const applyAction =
    window?.applyPhone && !window.applyUrl
      ? `Apply for ${program.name} by phone at ${window.applyPhone}`
      : `Apply for ${program.name}`;
  const action =
    actionOverride ??
    (status === "done"
      ? `Already on ${program.name}`
      : status === "skipped"
        ? `Skipped ${program.name}`
        : status === "snoozed"
          ? `Remind later: ${program.name}`
          : applyAction);

  const existing = session.items.find((i) => i.programId === programId);
  if (existing) {
    existing.status = status;
    existing.action = action;
    existing.link = applyLink(programId);
    existing.deadlineLabel = deadlineLabel;
    existing.deadlineDate = deadlineDate;
    return;
  }

  const item: NextStepsItem = {
    programId,
    programName: program.name,
    category: program.category,
    action,
    link: applyLink(programId),
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
      if (!hasDoc(session.docsInHand, d)) set.add(d);
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
      if (hasDoc(session.docsInHand, d)) continue;
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
  const open = session.items.filter(
    (i) =>
      i.status === "todo" ||
      i.status === "in_progress" ||
      i.status === "snoozed",
  );
  const tierOrder = { easy: 0, moderate: 1, hard: 2 } as const;
  return [...open].sort((a, b) => {
    const da = programDifficulty(a.programId);
    const db = programDifficulty(b.programId);
    if (tierOrder[da.tier] !== tierOrder[db.tier]) {
      return tierOrder[da.tier] - tierOrder[db.tier];
    }
    if (da.score !== db.score) return da.score - db.score;
    return a.programName.localeCompare(b.programName);
  });
}
