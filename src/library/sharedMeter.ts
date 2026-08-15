import { getProgramRequirements } from "./requirements.js";
import type { MeterSharing, Program, SessionState } from "./types.js";

export type { MeterSharing };

/** Telegram + /dev#tree copy – short, no “master-metered” jargon. */
export const SHARED_METER_PROMPT = `Does another household share this utility meter with you?

Two families on one bill counts as yes. If your landlord sends you a separate bill, tap that instead.`;

export function programNeedsNoSharedMeter(program: Program): boolean {
  return getProgramRequirements(program.id).eligibility.includes(
    "no_shared_meter",
  );
}

export function programNeedsNotMasterMetered(program: Program): boolean {
  return getProgramRequirements(program.id).eligibility.includes(
    "not_master_metered",
  );
}

/** CARE/FERA (own meter) and/or AMP (not landlord/master). */
export function programNeedsMeterSharingGate(program: Program): boolean {
  return (
    programNeedsNoSharedMeter(program) || programNeedsNotMasterMetered(program)
  );
}

export function meterSharingAnswered(session: SessionState): boolean {
  return session.meterSharing !== null;
}

/**
 * CARE/FERA: two households on one meter are out; landlord-billed (submeter)
 * still qualifies via the paper form. AMP: only a meter that is just this
 * household – landlord/submeter and shared residential meters are out.
 */
export function passesMeterSharingGate(
  program: Program,
  sharing: MeterSharing | null,
): boolean {
  if (!programNeedsMeterSharingGate(program)) return true;
  if (sharing == null) return false;
  if (programNeedsNoSharedMeter(program) && sharing === "shared") return false;
  if (programNeedsNotMasterMetered(program) && sharing !== "own") return false;
  return true;
}

export function meterSharingLabel(sharing: MeterSharing | null): string {
  if (sharing == null) return "not asked";
  if (sharing === "own") return "just this household";
  if (sharing === "shared") return "shares meter with another household";
  return "landlord sends a separate bill";
}
