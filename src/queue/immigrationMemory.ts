/**
 * Immigration-status answers stay in process memory only – never written to
 * the session DB, session logs, or analytics. Cleared on finish / erase / restart.
 * Telegram capture also skips logging the answer (see telegramCapture.ts).
 */

export type ImmigrationAnswer = "eligible" | "ineligible" | "declined";

/** Program fields the immigration gate reads. */
export type ImmigrationGatedProgram = {
  requiresCitizenOrEligibleImmigrant?: boolean;
  requiresIneligibleImmigrantStatus?: boolean;
};

/**
 * Citizen-gated programs (CalFresh, SSI, …) unlock only on Yes.
 * Non-citizen programs (CAPI, CFAP) unlock on No *or* Prefer not to say –
 * decline shows those offerings without treating the household as ineligible.
 */
export function passesImmigrationGate(
  program: ImmigrationGatedProgram,
  status: ImmigrationAnswer | null,
): boolean {
  if (program.requiresCitizenOrEligibleImmigrant) {
    return status === "eligible";
  }
  if (program.requiresIneligibleImmigrantStatus) {
    return status === "ineligible" || status === "declined";
  }
  return true;
}

const answers = new Map<number, ImmigrationAnswer>();
/** Users currently on the immigration-status prompt – text replies are not logged. */
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
