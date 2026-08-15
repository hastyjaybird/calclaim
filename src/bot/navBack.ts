/**
 * Step-back undo for the eligibility tree.
 * Snapshots session (+ immigration answer) before each progressing tap so Back
 * erases the last collected answer / offer decision and restores prior state.
 */

import type { SessionState } from "../library/types.js";
import type { ImmigrationAnswer } from "../queue/ranker.js";
import {
  clearImmigrationAnswer,
  getImmigrationAnswer,
  setImmigrationAnswer,
} from "../queue/immigrationMemory.js";
import type { InlineKeyboard } from "grammy";

export interface UndoFrame {
  /** Session JSON without undoStack (avoids nested copies). */
  stateJson: string;
  immigration: ImmigrationAnswer | null;
}

const MAX_UNDO = 80;

export function canNavBack(session: SessionState): boolean {
  return (session.undoStack?.length ?? 0) > 0;
}

/** Call immediately before mutating session for a tree-progressing answer. */
export function pushUndoFrame(session: SessionState): void {
  const { undoStack, ...rest } = session;
  const frame: UndoFrame = {
    stateJson: JSON.stringify(rest),
    immigration: getImmigrationAnswer(session.telegramUserId) ?? null,
  };
  const next = [...(undoStack ?? []), frame];
  session.undoStack = next.length > MAX_UNDO ? next.slice(-MAX_UNDO) : next;
}

/** Restore the previous tree state. Returns false when there is nothing to undo. */
export function popUndoFrame(session: SessionState): boolean {
  const stack = session.undoStack ?? [];
  if (stack.length === 0) return false;
  const frame = stack[stack.length - 1]!;
  const remaining = stack.slice(0, -1);
  const restored = JSON.parse(frame.stateJson) as Omit<SessionState, "undoStack">;
  const uid = session.telegramUserId;
  Object.assign(session, restored);
  session.telegramUserId = uid;
  session.undoStack = remaining;

  clearImmigrationAnswer(uid);
  if (frame.immigration) {
    setImmigrationAnswer(uid, frame.immigration);
  }
  return true;
}

export function clearUndoStack(session: SessionState): void {
  session.undoStack = [];
}

/** Append a Back row when the user has something to undo. */
export function withNavBack(
  kb: InlineKeyboard,
  session: SessionState,
): InlineKeyboard {
  if (canNavBack(session)) {
    kb.row().text("Back", "nav:back");
  }
  return kb;
}
