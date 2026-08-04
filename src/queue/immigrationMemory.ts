/**
 * Immigration-status answers stay in process memory only — never written to
 * the session DB, session logs, or analytics. Cleared on finish / erase / restart.
 * Telegram capture also skips logging the answer (see telegramCapture.ts).
 */

export type ImmigrationAnswer = "eligible" | "ineligible" | "declined";

const answers = new Map<number, ImmigrationAnswer>();
/** Users currently on the immigration-status prompt — text replies are not logged. */
const awaitingPrompt = new Set<number>();

export function getImmigrationAnswer(
  telegramUserId: number,
): ImmigrationAnswer | null {
  return answers.get(telegramUserId) ?? null;
}

export function setImmigrationAnswer(
  telegramUserId: number,
  answer: ImmigrationAnswer,
): void {
  answers.set(telegramUserId, answer);
  awaitingPrompt.delete(telegramUserId);
}

export function clearImmigrationAnswer(telegramUserId: number): void {
  answers.delete(telegramUserId);
  awaitingPrompt.delete(telegramUserId);
}

export function markAwaitingImmigrationPrompt(telegramUserId: number): void {
  awaitingPrompt.add(telegramUserId);
}

/** True while the immigration-status question is on screen (answer not yet chosen). */
export function isAwaitingImmigrationPrompt(telegramUserId: number): boolean {
  return awaitingPrompt.has(telegramUserId);
}
