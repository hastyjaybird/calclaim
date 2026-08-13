import { getImmigrationAnswer } from "../queue/immigrationMemory.js";
import { buildQueue } from "../queue/ranker.js";
import { getProgram, loadPrograms } from "../library/load.js";
import {
  isHeldFromOffer,
  isOpenNow,
  programAvailability,
} from "../library/requirements.js";
import type { Program, SessionState } from "../library/types.js";

/**
 * Programs that are waitlisted / paused / enrollment-closed right now, but
 * this saved profile would qualify if enrollment reopened. Used for the
 * end-of-flow notify opt-in and for the daily reopen fan-out.
 */
export function listHeldQualifyingPrograms(
  session: SessionState,
): Program[] {
  if (!session.branch || session.branch === "tax_only") return [];

  const immigration =
    session.savedImmigrationStatus ??
    getImmigrationAnswer(session.telegramUserId);

  // Probe queue as if held programs were offerable: temporarily ignore hold by
  // checking eligibility via buildQueue after swapping availability is hard, so
  // we build against a cloned session and filter library holds ourselves.
  const eligibleIds = new Set(
    buildQueue(session, {
      immigrationStatus: immigration,
      includeHeld: true,
    }),
  );

  return loadPrograms().filter((p) => {
    if (!eligibleIds.has(p.id)) return false;
    return isHeldFromOffer(programAvailability(p).status);
  });
}

/** True when a previously held program is now accepting applications. */
export function programReopened(programId: string): boolean {
  const program = getProgram(programId);
  if (!program) return false;
  const status = programAvailability(program).status;
  return isOpenNow(status) && !isHeldFromOffer(status);
}

export function formatHeldProgramList(programs: Program[]): string {
  return programs.map((p) => `• ${p.name}`).join("\n");
}
