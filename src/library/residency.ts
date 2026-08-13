import { getProgramRequirements } from "./requirements.js";
import type { Program, ResidencyTie, SessionState } from "./types.js";

/**
 * Programs that need a California home (not merely a CA workplace).
 * Includes CA-residency / county-residency tags and utility-at-home programs.
 * EDD wage-replacement and Disaster CalFresh are intentionally excluded – they
 * key off work / disaster area instead.
 */
export function programNeedsCaHome(program: Program): boolean {
  if (program.requiresCaResidency) return true;
  if (program.requiresActiveDisasterWindow) return false;
  if (program.requiresWorkDisruption) return false;
  const el = getProgramRequirements(program.id).eligibility;
  return (
    el.includes("ca_residency") ||
    el.includes("county_residency") ||
    el.includes("participating_utility")
  );
}

export function passesCaHomeGate(
  program: Program,
  residencyTie: ResidencyTie | null,
): boolean {
  if (!programNeedsCaHome(program)) return true;
  if (residencyTie === null) return false;
  return residencyTie === "ca_home";
}

export function applyResidencyTie(
  session: SessionState,
  tie: ResidencyTie,
): void {
  session.residencyTie = tie;
  session.isCaResident = tie === "ca_home";
}

export function residencyTieLabel(tie: ResidencyTie | null): string {
  if (tie === null) return "not asked";
  if (tie === "ca_home") return "lives in CA";
  if (tie === "out_of_state_ca_work") return "lives elsewhere · works in CA";
  if (tie === "visitor") return "visiting";
  return "lives out of state";
}
