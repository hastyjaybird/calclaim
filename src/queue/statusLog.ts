import {
  getImmigrationAnswer,
  passesImmigrationGate,
} from "./immigrationMemory.js";
import { passesCountyEligibility, programNeedsZip } from "../library/geo.js";
import { loadPrograms } from "../library/load.js";
import {
  isHeldFromOffer,
  programAvailability,
} from "../library/requirements.js";
import type { Program, SessionState, TodoStatus } from "../library/types.js";
import { passesCaHomeGate, programNeedsCaHome } from "../library/residency.js";
import {
  programNeedsShutoffZone,
  shutoffZoneAnswered,
} from "../library/pgeShutoff.js";
import {
  passesBillInNameGate,
  programNeedsBillInName,
  utilityBillsAnswered,
} from "../library/utilityBills.js";
import {
  meterSharingAnswered,
  passesMeterSharingGate,
  programNeedsMeterSharingGate,
} from "../library/sharedMeter.js";
import { hasOfferableDisasterWindow } from "../disaster/liveWindow.js";

/** Session-wide status for a single program, for QC / support logging. */
export type ProgramLogStatus =
  | "PENDING_TRIAGE"
  | "QUALIFIED_OFFERED"
  | "SIGN_UP"
  | "ALREADY_ENROLLED"
  | "SNOOZED"
  | "SKIPPED"
  | "HELD_WAITLIST"
  | "NOT_IN_QUEUE";

export interface ProgramLogRow {
  programId: string;
  programName: string;
  category: string;
  status: ProgramLogStatus;
  reason: string;
}

const TODO_STATUS_TO_LOG: Record<TodoStatus, ProgramLogStatus> = {
  todo: "QUALIFIED_OFFERED",
  in_progress: "SIGN_UP",
  done: "ALREADY_ENROLLED",
  snoozed: "SNOOZED",
  skipped: "SKIPPED",
};

/** Mirrors ranker.ts's buildQueue eligibility filter, but explains *why*. */
function explainEligibility(
  program: Program,
  session: SessionState,
): { eligible: boolean; reason: string } {
  if (program.id === "tax_credits") {
    return { eligible: false, reason: "Info-only card, not offered in queue" };
  }
  const branch = session.branch;
  if (!branch) return { eligible: false, reason: "Triage not started" };
  if (branch === "tax_only") {
    return { eligible: false, reason: "Tax-only branch offers no cards" };
  }
  if (!program.branches.includes(branch)) {
    return {
      eligible: false,
      reason: `Not offered on the ${branch.toUpperCase()} gate arm`,
    };
  }
  if (program.requiresPastDue && session.pastDue !== true) {
    return {
      eligible: false,
      reason:
        session.pastDue === null
          ? "Waiting on past-due answer"
          : "Utility bill is not past due",
    };
  }
  if (!passesCaHomeGate(program, session.residencyTie)) {
    return {
      eligible: false,
      reason:
        session.residencyTie === null
          ? "Waiting on where you live (California home)"
          : programNeedsCaHome(program)
            ? "Needs a California home address (work-only in CA is not enough)"
            : "Not eligible on California residency",
    };
  }
  if (program.requiresBuyingEvThisYear && session.buyingEvThisYear !== true) {
    return {
      eligible: false,
      reason:
        session.buyingEvThisYear === null
          ? "Waiting on buying-EV-this-year answer"
          : "Not buying an EV this year",
    };
  }
  if (program.requiresFirstTimeZev && session.firstTimeZev !== true) {
    return {
      eligible: false,
      reason:
        session.firstTimeZev === null
          ? "Waiting on first-time ZEV answer"
          : "Not a first-time zero-emission vehicle buyer",
    };
  }
  if (program.requiresBuyingEbikeThisYear && session.buyingEbikeThisYear !== true) {
    return {
      eligible: false,
      reason:
        session.buyingEbikeThisYear === null
          ? "Waiting on buying-e-bike-this-year answer"
          : "Not buying a pedal e-bike this year",
    };
  }
  if (program.requiresVehicleRetirement && session.wouldRetireVehicle !== true) {
    return {
      eligible: false,
      reason:
        session.wouldRetireVehicle === null
          ? "Waiting on vehicle-retirement answer"
          : "No older car to retire / scrap",
    };
  }
  if (
    program.requiresChildInHousehold &&
    session.hasChildInHousehold !== true
  ) {
    return {
      eligible: false,
      reason:
        session.hasChildInHousehold === null
          ? "Waiting on child/pregnancy answer"
          : "No children under 18 / pregnancy in household",
    };
  }
  if (program.requiresFosterYouth && session.isFosterYouth !== true) {
    return {
      eligible: false,
      reason:
        session.isFosterYouth === null
          ? "Waiting on foster-youth answer"
          : "Not a qualifying former foster youth",
    };
  }
  if (program.requiresRefugeeOrAsylee && session.isRefugeeOrAsylee !== true) {
    return {
      eligible: false,
      reason:
        session.isRefugeeOrAsylee === null
          ? "Waiting on refugee / asylee answer"
          : "Not a refugee, asylee, or similarly eligible newcomer",
    };
  }
  if (
    program.requiresMedicalDeviceOrCondition &&
    session.hasMedicalDeviceOrCondition !== true
  ) {
    return {
      eligible: false,
      reason:
        session.hasMedicalDeviceOrCondition === null
          ? "Waiting on qualifying medical condition / device answer"
          : "No qualifying medical condition or device for extra energy",
    };
  }
  if (
    program.requiresAgedBlindOrDisabled &&
    session.hasAgedBlindOrDisabled !== true
  ) {
    return {
      eligible: false,
      reason:
        session.hasAgedBlindOrDisabled === null
          ? "Waiting on aged/blind/disabled answer"
          : "No one aged 65+, blind, or disabled in household",
    };
  }
  if (
    program.requiresWorkDisruption &&
    session.workDisruption !== program.requiresWorkDisruption
  ) {
    return {
      eligible: false,
      reason:
        session.workDisruption === null
          ? "Waiting on work-disruption answer"
          : "Work-disruption reason doesn't match this program",
    };
  }
  if (program.requiresActiveDisasterWindow) {
    if (!hasOfferableDisasterWindow()) {
      return {
        eligible: false,
        reason: "No county Disaster CalFresh application window is open or approved",
      };
    }
    if (session.inDisasterArea !== true) {
      return {
        eligible: false,
        reason:
          session.inDisasterArea === null
            ? "Waiting on disaster-area answer"
            : "Did not live or work in the declared disaster area",
      };
    }
  }
  if (programNeedsZip(program)) {
    if (session.residenceZip === null) {
      return { eligible: false, reason: "Waiting on ZIP / county" };
    }
    if (!passesCountyEligibility(program, session.residenceCounty)) {
      if (program.requiresCmspCounty) {
        return {
          eligible: false,
          reason: session.residenceCounty
            ? `Not in a participating CMSP county (${session.residenceCounty})`
            : "ZIP skipped or not matched to a participating CMSP county",
        };
      }
      return {
        eligible: false,
        reason: session.residenceCounty
          ? `Not in a participating county (${session.residenceCounty})`
          : "ZIP skipped or not matched to a participating county",
      };
    }
  }
  if (programNeedsBillInName(program)) {
    if (!utilityBillsAnswered(session)) {
      return { eligible: false, reason: "Waiting on bills in user's name" };
    }
    if (!passesBillInNameGate(program, session.billsInMyName)) {
      return {
        eligible: false,
        reason: session.billNotInMyName
          ? "Bill is not in user's name"
          : "No matching bill in user's name",
      };
    }
  }
  if (programNeedsMeterSharingGate(program)) {
    if (!meterSharingAnswered(session)) {
      return { eligible: false, reason: "Waiting on shared-meter answer" };
    }
    if (!passesMeterSharingGate(program, session.meterSharing)) {
      return {
        eligible: false,
        reason:
          session.meterSharing === "shared"
            ? "Another household shares this utility meter"
            : session.meterSharing === "landlord_bill"
              ? "Landlord sends a separate bill (submeter) – AMP not available"
              : "Meter sharing does not match this program",
      };
    }
  }
  if (programNeedsShutoffZone(program)) {
    if (!shutoffZoneAnswered(session)) {
      return { eligible: false, reason: "Waiting on shut-off zone check" };
    }
    if (session.inShutoffZone !== true) {
      return {
        eligible: false,
        reason: "Not in PG&E shut-off / fire-threat pre-qualify zone (or skipped)",
      };
    }
  }
  if (!program.incomeGate || branch === "yes") {
    // no income gate on this arm
  } else if (!session.incomeBand) {
    return { eligible: false, reason: "Waiting on household income" };
  } else {
    const gate = program.incomeGate;
    const pass =
      (gate === "careBand" && session.incomeBand === "careBand") ||
      (gate === "feraBand" && session.incomeBand === "feraBand") ||
      (gate === "careOrFeraBand" &&
        (session.incomeBand === "careBand" ||
          session.incomeBand === "feraBand"));
    if (!pass) {
      return { eligible: false, reason: "Household income is above program's band" };
    }
  }
  if (session.alreadyOn.includes(program.id)) {
    return { eligible: false, reason: "Marked already enrolled at the gate" };
  }
  if (program.excludeIfAlreadyOn?.some((id) => session.alreadyOn.includes(id))) {
    const other = program.excludeIfAlreadyOn.find((id) =>
      session.alreadyOn.includes(id),
    );
    return {
      eligible: false,
      reason: `Excluded – already enrolled in ${other}`,
    };
  }
  if (
    program.id === "fera" &&
    branch === "no" &&
    session.incomeBand === "careBand"
  ) {
    return { eligible: false, reason: "CARE band covers a bigger discount than FERA" };
  }
  if (
    program.requiresCitizenOrEligibleImmigrant ||
    program.requiresIneligibleImmigrantStatus
  ) {
    const status =
      session.savedImmigrationStatus ??
      getImmigrationAnswer(session.telegramUserId);
    if (status === null) {
      return {
        eligible: false,
        reason: "Waiting on immigration status answer",
      };
    }
    if (!passesImmigrationGate(program, status)) {
      return {
        eligible: false,
        reason: "Not offered after immigration status gate",
      };
    }
  }
  if (isHeldFromOffer(programAvailability(program).status)) {
    return {
      eligible: true,
      reason:
        "Qualifies on profile, but program is waitlisted / paused / closed – held out of offer tree",
    };
  }
  return { eligible: true, reason: "" };
}

/**
 * Full per-program status for a session – every library program resolves to
 * exactly one row, so nothing is silently omitted from QC logs.
 */
export function buildProgramStatusRows(session: SessionState): ProgramLogRow[] {
  return loadPrograms().map((program) => {
    const existing = session.items.find((i) => i.programId === program.id);
    if (existing) {
      return {
        programId: program.id,
        programName: program.name,
        category: program.category,
        status: TODO_STATUS_TO_LOG[existing.status],
        reason: existing.action,
      };
    }

    const { eligible, reason } = explainEligibility(program, session);
    if (!eligible) {
      const status: ProgramLogStatus =
        reason.startsWith("Waiting on") || reason === "Triage not started"
          ? "PENDING_TRIAGE"
          : "NOT_IN_QUEUE";
      return {
        programId: program.id,
        programName: program.name,
        category: program.category,
        status,
        reason,
      };
    }

    if (reason.includes("held out of offer tree")) {
      return {
        programId: program.id,
        programName: program.name,
        category: program.category,
        status: "HELD_WAITLIST",
        reason,
      };
    }

    const inQueue = session.queue.includes(program.id);
    return {
      programId: program.id,
      programName: program.name,
      category: program.category,
      status: inQueue ? "QUALIFIED_OFFERED" : "PENDING_TRIAGE",
      reason: inQueue ? "In offer queue, not yet reached" : "Waiting on queue to build",
    };
  });
}
