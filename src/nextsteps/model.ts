import { getProgram } from "../corpus/load.js";
import type {
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
    return { deadlineLabel: "None listed — check site", deadlineDate: null };
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
    for (const d of item.docs) set.add(d);
  }
  return [...set];
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
