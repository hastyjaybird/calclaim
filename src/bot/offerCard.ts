import {
  formatMaxBenefitEstimate,
} from "../library/benefitEstimate.js";
import { formatFormFillEstimate } from "../library/formFill.js";
import { ownerSignOffIfRentingLine } from "../library/requirements.js";
import type { Program, SessionState } from "../library/types.js";
import { getImmigrationAnswer } from "../queue/immigrationMemory.js";
import { formatProgramsRemaining } from "../queue/ranker.js";
import type { DisasterWindow } from "../disaster/db.js";
import {
  formatCounties,
  formatWindowTiming,
} from "../disaster/format.js";
import { isOpenToday, windowForProgram } from "../disaster/liveWindow.js";

/**
 * Offer cards stay in-chat: no official apply URLs (Telegram would make them
 * tappable and send people off the list). Phone numbers for a live disaster
 * window are the exception – those are not a web navigation.
 */
function offerCardApplyHint(
  window: DisasterWindow,
  openToday: boolean,
): string | null {
  if (window.applyPhone) return `Apply by phone at ${window.applyPhone}`;
  if (!openToday) {
    return "Your county publishes the phone number when the window opens.";
  }
  return null;
}

function isDisasterSupplement(program: Program, session: SessionState): boolean {
  return (
    program.requiresActiveDisasterWindow === true &&
    session.alreadyOn.includes("calfresh")
  );
}

function disasterOneLiner(window: DisasterWindow, supplement: boolean): string {
  const area = window.counties.length
    ? formatCounties(window.counties)
    : window.label;
  return supplement
    ? `Extra food benefits on your existing CalFresh card for households hit by the disaster in ${area}`
    : `One month of food benefits for households that lived or worked in ${area} during the disaster`;
}

/** Offer-card body without the remaining-count footer. */
export function formatOfferCardBody(
  program: Program,
  session: SessionState,
): string {
  const window = windowForProgram(program);
  const openToday = window ? isOpenToday(window) : false;
  const supplement = isDisasterSupplement(program, session);
  const ownerLine = ownerSignOffIfRentingLine(program.id);
  const declinedStatus =
    getImmigrationAnswer(session.telegramUserId) === "declined";
  const leadIn =
    window && !openToday
      ? `${program.name} is coming to your area.`
      : program.requiresIneligibleImmigrantStatus && declinedStatus
        ? `If you are not a U.S. citizen, you may qualify for ${program.name}.`
        : `You may qualify for ${program.name}.`;
  const lines = [
    leadIn,
    "",
    window
      ? `${program.name} – ${disasterOneLiner(window, supplement)}`
      : `${program.name} – ${program.oneLiner}`,
    ...(ownerLine ? [ownerLine] : []),
    supplement
      ? "Est. a one-time top-up to the maximum food benefit for your household size"
      : formatMaxBenefitEstimate(program, session.householdSize),
    formatFormFillEstimate(program, session.docsInHand),
  ];

  if (window) {
    const timing = formatWindowTiming(window.applyPeriods, openToday);
    if (timing) lines.push(timing);
    const hint = offerCardApplyHint(window, openToday);
    if (hint) lines.push(hint);
  } else {
    const deadline = program.deadlines[0];
    if (deadline?.label) {
      lines.push(
        deadline.date
          ? `Deadline: ${deadline.label} (${deadline.date})`
          : `Deadline: ${deadline.label}`,
      );
    }
  }

  return lines.join("\n");
}

/** Full offer-card copy (body + remaining count), shared by Telegram and /dev/tree. */
export function formatOfferCardText(
  program: Program,
  session: SessionState,
): string {
  return `${formatOfferCardBody(program, session)}\n\n${formatProgramsRemaining(session)}`;
}
