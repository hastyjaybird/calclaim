import type { Context } from "grammy";
import type { InlineKeyboard } from "grammy";
import { InputFile } from "grammy";
import { recordEvent } from "../analytics/db.js";
import { getCampaign } from "../analytics/campaigns.js";
import { trackFunnel } from "../analytics/funnel.js";
import { trackReportCreated } from "../analytics/screens.js";
import { fromCampaignPin } from "../analytics/geo.js";
import { countyFromZip, parseZipCode } from "../library/geo.js";
import { getProgram } from "../library/load.js";
import { applyResidencyTie } from "../library/residency.js";
import type { IncomeBand, MeterSharing, SessionState } from "../library/types.js";
import {
  deleteSession,
  emptySession,
  saveSession,
} from "../db/session.js";
import {
  formatReportSummary,
  markGateAlreadyOn,
  openTodos,
  upsertItem,
} from "../nextsteps/model.js";
import { renderNextStepsPdf } from "../nextsteps/pdf.js";
import {
  reportSharePageUrl,
  storeReportPdf,
} from "../nextsteps/reportLinks.js";
import { eraseUserFeedbackTodos } from "../feedback/todos.js";
import {
  ABOUT_TEXT,
  HELP_MENU_TEXT,
  HOUSEHOLD_EXPLAIN,
  IMMIGRATION_STATUS_PROMPT,
  PRIVACY_SHORT,
} from "../privacy/copy.js";
import { eraseUserQc } from "../qc/responses.js";
import {
  applySkipCascade,
  currentProgram,
  extendOfferQueue,
  formatProgramsRemaining,
  pickNextTriageGate,
  queueNeedsStatusGate,
  type ImmigrationAnswer,
  type TriageGateId,
} from "../queue/ranker.js";
import {
  clearImmigrationAnswer,
  getImmigrationAnswer,
  markAwaitingImmigrationPrompt,
  setImmigrationAnswer,
} from "../queue/immigrationMemory.js";
import {
  formatHeldProgramList,
  listHeldQualifyingPrograms,
} from "../reopen/qualify.js";
import {
  disasterImpactQuestion,
  disasterWorkZipConfirmPrompt,
  disasterZipConfirmPrompt,
} from "../disaster/format.js";
import {
  hasOfferableDisasterWindow,
  offerableDisasterWindows,
  zipInOfferableDisasterArea,
} from "../disaster/liveWindow.js";
import { trackedApplyUrl, type AppConfig } from "../config.js";
import { staleCallbackAck } from "./interpret.js";
import {
  GATE_NONE_ID,
  GATE_OPTIONS,
  abdHouseholdKeyboard,
  buyingEvKeyboard,
  firstTimeZevKeyboard,
  buyingEbikeKeyboard,
  retireVehicleKeyboard,
  fosterYouthKeyboard,
  refugeeStatusKeyboard,
  medicalNeedKeyboard,
  sharedMeterKeyboard,
  caResidencyKeyboard,
  caWorkKeyboard,
  childHouseholdKeyboard,
  disasterAreaKeyboard,
  disasterZipKeyboard,
  immigrationStatusKeyboard,
  workDisruptionKeyboard,
  zipKeyboard,
  confirmKeyboard,
  emailReportKeyboard,
  gateKeyboard,
  helpKeyboard,
  householdKeyboard,
  idleKeyboard,
  incomeKeyboard,
  offerKeyboard,
  optInKeyboard,
  pastDueKeyboard,
  programSitesKeyboard,
  reopenNotifyKeyboard,
  shareKeyboard,
  REMOVE_REPLY_KEYBOARD,
  shutoffAddressReplyKeyboard,
  shutoffZoneKeyboard,
  utilityBillsKeyboard,
} from "./keyboards.js";
import {
  SHUTOFF_ADDRESS_PROMPT,
  resolveShutoffZone,
  resolveShutoffZoneFromCoords,
} from "../library/pgeShutoff.js";
import {
  UTILITY_BILL_NONE_ID,
  UTILITY_BILL_OPTIONS,
} from "../library/utilityBills.js";
import { SHARED_METER_PROMPT } from "../library/sharedMeter.js";
import { primaryTerritoryForProgram } from "../library/utilityTerritory.js";
import { formatOfferCardBody } from "./offerCard.js";
import { replyTracked, repeatLastMessage } from "./reply.js";
import {
  clearUndoStack,
  popUndoFrame,
  pushUndoFrame,
  withNavBack,
} from "./navBack.js";
import {
  getOrCreatePeerShareCampaigns,
  SHARE_LINK_CAMPAIGN,
  SHARE_QR_CAMPAIGN,
  trackShareOut,
} from "../analytics/peerShare.js";
import {
  buildShareMenuText,
  renderShareQrPng,
  shareTargetUrl,
  telegramShareUrl,
} from "./share.js";

let appConfig: AppConfig | null = null;

export function setFlowConfig(config: AppConfig): void {
  appConfig = config;
}

function hasOpenReport(session: SessionState): boolean {
  return openTodos(session).length > 0;
}

function peerShareCampaignsOrFallback(telegramUserId: number): {
  linkCampaignId: string;
  qrCampaignId: string;
} {
  try {
    return getOrCreatePeerShareCampaigns(telegramUserId);
  } catch {
    return {
      linkCampaignId: SHARE_LINK_CAMPAIGN,
      qrCampaignId: SHARE_QR_CAMPAIGN,
    };
  }
}

/** Telegram rejects localhost / private / non-https URLs on inline URL buttons. */
function telegramSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function escapeTelegramHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Public site linked from the opt-in message (Telegram HTML <a>). */
const CALCLAIM_SITE_FALLBACK = "https://calclaim.jayhasty.com";


function treeKb(session: SessionState, kb: InlineKeyboard): InlineKeyboard {
  return withNavBack(kb, session);
}

/**
 * Re-show the screen that matches restored session state after Back.
 * Does not clear draft multiselects (gate / utility bills).
 */
async function repaintCurrentScreen(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  switch (session.step) {
    case "opt_in":
      await sendOptIn(ctx, session);
      return;
    case "gate":
      await replyTracked(
        ctx,
        session,
        `Is anyone in your household already on any of these?

${HOUSEHOLD_EXPLAIN}

Tap all that apply (or None), then Done.`,
        { reply_markup: treeKb(session, gateKeyboard(session.alreadyOn)) },
      );
      return;
    case "household_size":
      await replyTracked(
        ctx,
        session,
        `How many people are in your household?

${HOUSEHOLD_EXPLAIN}

Tap a number (or More):`,
        { reply_markup: treeKb(session, householdKeyboard()) },
      );
      return;
    case "household_size_custom":
      await replyTracked(
        ctx,
        session,
        "Type how many people are in your household (9 or more):",
      );
      return;
    case "income_band":
      await replyTracked(
        ctx,
        session,
        `About how much is your household's total yearly income before taxes?

${HOUSEHOLD_EXPLAIN}

Add up income for everyone you just counted.`,
        {
          reply_markup: treeKb(
            session,
            incomeKeyboard(session.householdSize ?? 1),
          ),
        },
      );
      return;
    case "past_due":
      await replyTracked(ctx, session, "Is your utility bill past due?", {
        reply_markup: treeKb(session, pastDueKeyboard()),
      });
      return;
    case "has_utility_bills":
      await replyTracked(
        ctx,
        session,
        `Which bills do you have in your name?

Tap all that apply (or None), then Done.`,
        {
          reply_markup: treeKb(
            session,
            utilityBillsKeyboard(session.billsInMyName),
          ),
        },
      );
      return;
    case "has_shared_meter":
      await replyTracked(ctx, session, SHARED_METER_PROMPT, {
        reply_markup: treeKb(session, sharedMeterKeyboard()),
      });
      return;
    case "has_shutoff_zone":
      await replyTracked(
        ctx,
        session,
        `PG&E has rebates for a portable generator or battery if your home is in a shut-off or high fire-risk area. Renters also qualify.

Do you already know whether you're in one of those areas?`,
        { reply_markup: treeKb(session, shutoffZoneKeyboard()) },
      );
      return;
    case "has_shutoff_address":
      await promptShutoffAddress(ctx, session);
      return;
    case "has_ca_residency":
      await replyTracked(ctx, session, "Where do you live most of the year?", {
        reply_markup: treeKb(session, caResidencyKeyboard()),
      });
      return;
    case "has_ca_work":
      await replyTracked(
        ctx,
        session,
        "Do you work in California (commute, job site, or CA employer wages)?",
        { reply_markup: treeKb(session, caWorkKeyboard()) },
      );
      return;
    case "has_buying_ev":
      await replyTracked(
        ctx,
        session,
        "Are you trying to buy an electric vehicle (or a hydrogen car) this year?",
        { reply_markup: treeKb(session, buyingEvKeyboard()) },
      );
      return;
    case "has_first_time_zev":
      await replyTracked(
        ctx,
        session,
        "Would this be your first battery-electric or hydrogen vehicle (not a plug-in hybrid)?",
        { reply_markup: treeKb(session, firstTimeZevKeyboard()) },
      );
      return;
    case "has_buying_ebike":
      await replyTracked(
        ctx,
        session,
        "Are you trying to buy a pedal e-bike this year (not a scooter)?",
        { reply_markup: treeKb(session, buyingEbikeKeyboard()) },
      );
      return;
    case "has_retire_vehicle":
      await replyTracked(
        ctx,
        session,
        "Do you have an older gas or diesel car you could retire (scrap) for a bigger rebate?",
        { reply_markup: treeKb(session, retireVehicleKeyboard()) },
      );
      return;
    case "has_child":
      await replyTracked(
        ctx,
        session,
        `Any kids under 18 (or a pregnancy) in the household?

${HOUSEHOLD_EXPLAIN}`,
        { reply_markup: treeKb(session, childHouseholdKeyboard()) },
      );
      return;
    case "has_foster_youth":
      await replyTracked(
        ctx,
        session,
        "Are you (or someone filing) a former foster youth age 18–25 who was in foster care on or after their 18th birthday?",
        { reply_markup: treeKb(session, fosterYouthKeyboard()) },
      );
      return;
    case "has_refugee_status":
      await replyTracked(
        ctx,
        session,
        "Are you a refugee, asylee, or similar eligible newcomer (SIV holder, Afghan or Ukrainian parolee, Cuban/Haitian entrant, or certified trafficking victim)?",
        { reply_markup: treeKb(session, refugeeStatusKeyboard()) },
      );
      return;
    case "has_medical_need":
      await replyTracked(
        ctx,
        session,
        "Does anyone living in the home have a qualifying medical condition or device that needs extra electricity or gas (for example life-support equipment, dialysis, asthma, or extra heating or cooling)?",
        { reply_markup: treeKb(session, medicalNeedKeyboard()) },
      );
      return;
    case "has_abd":
      await replyTracked(
        ctx,
        session,
        `Is anyone in the household 65 or older, blind, or disabled?

${HOUSEHOLD_EXPLAIN}`,
        { reply_markup: treeKb(session, abdHouseholdKeyboard()) },
      );
      return;
    case "has_work_disruption":
      await replyTracked(
        ctx,
        session,
        session.residencyTie === "out_of_state_ca_work"
          ? "About your California job – has anything affected your ability to work in the last few months?"
          : "Has anything affected your ability to work in the last few months?",
        { reply_markup: treeKb(session, workDisruptionKeyboard()) },
      );
      return;
    case "has_disaster_area": {
      const windows = offerableDisasterWindows();
      const q = disasterImpactQuestion(windows);
      await replyTracked(ctx, session, q, {
        reply_markup: treeKb(session, disasterAreaKeyboard()),
      });
      return;
    }
    case "has_disaster_zip": {
      const zipPrompt =
        session.residencyTie === "out_of_state_ca_work"
          ? disasterWorkZipConfirmPrompt()
          : disasterZipConfirmPrompt();
      await replyTracked(ctx, session, zipPrompt, {
        reply_markup: treeKb(session, disasterZipKeyboard()),
      });
      return;
    }
    case "has_zip":
      await replyTracked(
        ctx,
        session,
        "What's your home ZIP code? (5 digits – used only to check county-specific programs.)",
        { reply_markup: treeKb(session, zipKeyboard()) },
      );
      return;
    case "has_immigration_status":
      await askImmigrationStatus(ctx, session);
      return;
    case "has_reopen_notify": {
      const held = listHeldQualifyingPrograms(session);
      await replyTracked(
        ctx,
        session,
        `A few programs you may qualify for are waitlisted or closed to new enrollments right now (not shown in the offer tree):\n\n${formatHeldProgramList(held)}\n\nWant a text if one of these opens and you still qualify on your saved answers?`,
        { reply_markup: treeKb(session, reopenNotifyKeyboard()) },
      );
      return;
    }
    case "offer":
      await presentOffer(ctx, session);
      return;
    case "idle":
      await replyTracked(ctx, session, "What next?", {
        reply_markup: idleKeyboard(hasOpenReport(session)),
      });
      return;
    default:
      if (session.queue.length && session.queueIndex < session.queue.length) {
        await presentOffer(ctx, session);
        return;
      }
      await beginOfferQueue(ctx, session);
  }
}

export async function sendOptIn(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  const configured = appConfig?.publicBaseUrl;
  const siteUrl =
    configured && telegramSafeUrl(configured)
      ? configured
      : CALCLAIM_SITE_FALLBACK;
  await replyTracked(
    ctx,
    session,
    `<a href="${siteUrl}">CalClaim</a> finds help with food, health coverage, phone discounts, energy bills, and more – and gives you a personalized Application Guide for California and federal programs to make it easier to apply.

At any time, text about an issue, correction or suggest an improvement.

Estimates only. Not affiliated with any agency.
Type 'help' for more options.`,
    { reply_markup: optInKeyboard(), parse_mode: "HTML" },
  );
}

export async function sendGate(ctx: Context, session: SessionState): Promise<void> {
  session.step = "gate";
  session.alreadyOn = [];
  saveSession(session);
  await replyTracked(
    ctx,
    session,
    `Is anyone in your household already on any of these?

${HOUSEHOLD_EXPLAIN}

Tap all that apply (or None), then Done.`,
    { reply_markup: treeKb(session, gateKeyboard([])) },
  );
}

async function continueAfterGateYes(ctx: Context, session: SessionState): Promise<void> {
  session.branch = "yes";
  session.docsInHand = ["categoricalProof", "photoId", "utilityBill"];
  session.queue = [];
  session.queueIndex = 0;
  markGateAlreadyOn(session);
  // Offer zero-question programs immediately; past-due / child / etc. come later.
  await beginOfferQueue(ctx, session);
}

async function continueAfterGateNo(ctx: Context, session: SessionState): Promise<void> {
  session.branch = "no";
  session.docsInHand = ["photoId", "utilityBill"];
  session.alreadyOn = [];
  session.queue = [];
  session.queueIndex = 0;
  // Lifeline / LIHEAP / etc. need no income – ask household/income only when needed.
  await beginOfferQueue(ctx, session);
}

async function sendNextStepsFile(ctx: Context, session: SessionState): Promise<void> {
  const buf = await renderNextStepsPdf(session);
  await ctx.replyWithDocument(
    new InputFile(buf, "calclaim-application-guide.pdf"),
    { caption: "Click to download your Application Guide" },
  );
  trackReportCreated(session.telegramUserId, session.campaignId);
}

/** Resolve Telegram-safe apply URLs (prefer tracked /r/:id when public base is https). */
function programSiteButtons(
  session: SessionState,
): { label: string; url: string }[] {
  const sites: { label: string; url: string }[] = [];
  for (const item of openTodos(session)) {
    const program = getProgram(item.programId);
    const territory = program
      ? primaryTerritoryForProgram(program, session)
      : null;
    const tracked =
      appConfig?.publicBaseUrl &&
      trackedApplyUrl(appConfig.publicBaseUrl, item.programId, territory);
    const url =
      (tracked && telegramSafeUrl(tracked) && tracked) ||
      (telegramSafeUrl(item.link) ? item.link : null);
    if (!url) continue;
    sites.push({ label: item.programName, url });
  }
  return sites;
}

async function promptVisitProgramSites(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  const sites = programSiteButtons(session);
  if (sites.length === 0) return;
  await replyTracked(ctx, session, "Visit the program sites now:", {
    reply_markup: programSitesKeyboard(sites),
  });
}

async function sendReportBundle(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  await replyTracked(ctx, session, formatReportSummary(session));
  await sendNextStepsFile(ctx, session);
  await promptVisitProgramSites(ctx, session);
}

function formatFinishClosingMessage(): string {
  return "For more help, visit BenefitsCal at https://benefitscal.com/";
}

function formatStopOptOutMessage(): string {
  return "Say STOP anytime to pause deadline reminders and reopen alerts. Say erase to delete your saved answers and exit.";
}

function formatEmptyQueueMessage(): string {
  return `You're through the list – nothing to add to an Application Guide right now.

Know someone who might need benefits help? Share CalClaim with a friend.

${formatFinishClosingMessage()}`;
}

/** Pause deadline reminders + reopen alerts – keeps session, todos, and data. */
export async function stopRemindersOnly(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  session.remindersStopped = true;
  session.awaitingConfirm = null;
  if (session.step === "confirm_stop") {
    session.step =
      session.queue.length > 0 || session.items.length > 0 ? "idle" : "opt_in";
  }
  saveSession(session);
  await replyTracked(
    ctx,
    session,
    "Alerts stopped (deadline reminders and waitlist reopen texts). Your Application Guide and saved answers stay. Message me anytime to turn alerts back on – or say 'guide' for your guide, help for more info. Tap Update my answers if your situation changed.",
    { reply_markup: idleKeyboard(hasOpenReport(session)) },
  );
}

/** Clear STOP pause when the user messages again (anything except STOP). */
export function resumeRemindersAfterMessage(session: SessionState): boolean {
  if (!session.remindersStopped) return false;
  session.remindersStopped = false;
  saveSession(session);
  return true;
}

async function completeFinish(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  clearImmigrationAnswer(session.telegramUserId);
  session.step = "idle";
  session.remindersEnabled = true;
  saveSession(session);
  trackFunnel("finished", session.telegramUserId, {
    campaignId: session.campaignId,
  });

  const open = openTodos(session);
  if (open.length === 0) {
    await replyTracked(ctx, session, formatEmptyQueueMessage());
    await replyTracked(ctx, session, formatStopOptOutMessage(), {
      reply_markup: idleKeyboard(false),
    });
    return;
  }

  await sendReportBundle(ctx, session);
  await replyTracked(ctx, session, formatFinishClosingMessage());
  await replyTracked(ctx, session, formatStopOptOutMessage(), {
    reply_markup: idleKeyboard(true),
  });
}

/**
 * End of offer tree. If the user qualifies for waitlisted/paused programs,
 * ask once whether to text them when enrollment reopens – then finish.
 */
async function finishQueue(ctx: Context, session: SessionState): Promise<void> {
  const held = listHeldQualifyingPrograms(session);
  if (held.length && session.reopenNotifyOptIn === null) {
    session.step = "has_reopen_notify";
    session.reopenWatchProgramIds = held.map((p) => p.id);
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      `A few programs you may qualify for are waitlisted or closed to new enrollments right now (not shown above):\n\n${formatHeldProgramList(held)}\n\nWant a text if one of these opens and you still qualify on your saved answers?\n\nWe'll keep your profile for that check. You can say STOP anytime to pause alerts, or erase to delete your data.`,
      { reply_markup: treeKb(session, reopenNotifyKeyboard()) },
    );
    return;
  }

  await completeFinish(ctx, session);
}

export async function presentOffer(ctx: Context, session: SessionState): Promise<void> {
  if (session.queueIndex >= session.queue.length) {
    // Wave done – ask the next cheapest gate, or finish if none remain.
    await beginOfferQueue(ctx, session);
    return;
  }

  const program = currentProgram(session);
  if (!program) {
    session.queueIndex += 1;
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }

  if (session.queueIndex === 0) {
    trackFunnel("triage_done", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    trackFunnel("first_offer", session.telegramUserId, {
      programId: program.id,
      campaignId: session.campaignId,
    });
  }

  session.step = "offer";
  saveSession(session);

  const remaining = formatProgramsRemaining(session);
  const body = escapeTelegramHtml(formatOfferCardBody(program, session));
  const remainingHtml = `<i>${escapeTelegramHtml(remaining)}</i>`;

  await replyTracked(ctx, session, `${body}\n\n${remainingHtml}`, {
    reply_markup: treeKb(session, offerKeyboard(program.id, {
      canExitGuide: hasOpenReport(session),
    })),
    parse_mode: "HTML",
  });
}

/**
 * Offer programs eligible with answers so far (fewest extra questions first via
 * wave order). When a Disaster CalFresh window is offerable and unanswered, ask
 * that first – before any offers – so the short window is not buried. Otherwise
 * when the current wave is empty, ask the next gate that unlocks more programs.
 */
async function beginOfferQueue(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  if (
    session.inDisasterArea === null &&
    hasOfferableDisasterWindow() &&
    session.step !== "has_disaster_zip"
  ) {
    await askTriageGate(ctx, session, "disaster");
    return;
  }

  extendOfferQueue(session);

  if (session.queueIndex < session.queue.length) {
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }

  const next = pickNextTriageGate(session);
  if (next) {
    await askTriageGate(ctx, session, next);
    return;
  }

  if (queueNeedsStatusGate(session)) {
    await askImmigrationStatus(ctx, session);
    return;
  }

  saveSession(session);
  await finishQueue(ctx, session);
}

async function askImmigrationStatus(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  session.step = "has_immigration_status";
  markAwaitingImmigrationPrompt(session.telegramUserId);
  saveSession(session);
  await replyTracked(
    ctx,
    session,
    IMMIGRATION_STATUS_PROMPT,
    { reply_markup: treeKb(session, immigrationStatusKeyboard()) },
  );
}

async function askTriageGate(
  ctx: Context,
  session: SessionState,
  gate: TriageGateId,
): Promise<void> {
  switch (gate) {
    case "income":
      if (session.householdSize == null) {
        session.step = "household_size";
        saveSession(session);
        await replyTracked(
          ctx,
          session,
          `How many people are in your household?

${HOUSEHOLD_EXPLAIN}

Tap a number (or More):`,
          { reply_markup: treeKb(session, householdKeyboard()) },
        );
        return;
      }
      session.step = "income_band";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `About how much is your household's total yearly income before taxes?

${HOUSEHOLD_EXPLAIN}

Add up income for everyone you just counted.`,
        { reply_markup: treeKb(session, incomeKeyboard(session.householdSize)) },
      );
      return;
    case "past_due":
      session.step = "past_due";
      saveSession(session);
      await replyTracked(ctx, session, "Is your utility bill past due?", {
        reply_markup: treeKb(session, pastDueKeyboard()),
      });
      return;
    case "utility_bills":
      session.step = "has_utility_bills";
      session.billsInMyName = [];
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `Which bills do you have in your name?

Tap all that apply (or None), then Done.`,
        { reply_markup: treeKb(session, utilityBillsKeyboard([])) },
      );
      return;
    case "shared_meter":
      session.step = "has_shared_meter";
      saveSession(session);
      await replyTracked(ctx, session, SHARED_METER_PROMPT, {
        reply_markup: treeKb(session, sharedMeterKeyboard()),
      });
      return;
    case "shutoff_zone":
      session.step = "has_shutoff_zone";
      session.shutoffAddressChoices = null;
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `PG&E has rebates for a portable generator or battery if your home is in a shut-off or high fire-risk area. Renters also qualify.

Do you already know whether you're in one of those areas?`,
        { reply_markup: treeKb(session, shutoffZoneKeyboard()) },
      );
      return;
    case "ca_residency":
      session.step = "has_ca_residency";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Where do you live most of the year?",
        { reply_markup: treeKb(session, caResidencyKeyboard()) },
      );
      return;
    case "buying_ev":
      session.step = "has_buying_ev";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Are you trying to buy an electric vehicle (or a hydrogen car) this year?",
        { reply_markup: treeKb(session, buyingEvKeyboard()) },
      );
      return;
    case "first_time_zev":
      session.step = "has_first_time_zev";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Would this be your first battery-electric or hydrogen vehicle (not a plug-in hybrid)?",
        { reply_markup: treeKb(session, firstTimeZevKeyboard()) },
      );
      return;
    case "buying_ebike":
      session.step = "has_buying_ebike";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Are you trying to buy a pedal e-bike this year (not a scooter)?",
        { reply_markup: treeKb(session, buyingEbikeKeyboard()) },
      );
      return;
    case "retire_vehicle":
      session.step = "has_retire_vehicle";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Do you have an older gas or diesel car you could retire (scrap) for a bigger rebate?",
        { reply_markup: treeKb(session, retireVehicleKeyboard()) },
      );
      return;
    case "child":
      session.step = "has_child";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `Any kids under 18 (or a pregnancy) in the household?

${HOUSEHOLD_EXPLAIN}`,
        { reply_markup: treeKb(session, childHouseholdKeyboard()) },
      );
      return;
    case "foster_youth":
      session.step = "has_foster_youth";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Are you (or someone filing) a former foster youth age 18–25 who was in foster care on or after their 18th birthday?",
        { reply_markup: treeKb(session, fosterYouthKeyboard()) },
      );
      return;
    case "refugee":
      session.step = "has_refugee_status";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Are you a refugee, asylee, or similar eligible newcomer (SIV holder, Afghan or Ukrainian parolee, Cuban/Haitian entrant, or certified trafficking victim)?",
        { reply_markup: treeKb(session, refugeeStatusKeyboard()) },
      );
      return;
    case "medical_need":
      session.step = "has_medical_need";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Does anyone living in the home have a qualifying medical condition or device that needs extra electricity or gas (for example life-support equipment, dialysis, asthma, or extra heating or cooling)?",
        { reply_markup: treeKb(session, medicalNeedKeyboard()) },
      );
      return;
    case "abd":
      session.step = "has_abd";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `Is anyone in the household 65 or older, blind, or disabled?

${HOUSEHOLD_EXPLAIN}`,
        { reply_markup: treeKb(session, abdHouseholdKeyboard()) },
      );
      return;
    case "work":
      session.step = "has_work_disruption";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        session.residencyTie === "out_of_state_ca_work"
          ? "About your California job – has anything affected your ability to work in the last few months?"
          : "Has anything affected your ability to work in the last few months?",
        { reply_markup: treeKb(session, workDisruptionKeyboard()) },
      );
      return;
    case "disaster": {
      const windows = offerableDisasterWindows();
      if (!windows.length) {
        session.inDisasterArea = false;
        await beginOfferQueue(ctx, session);
        return;
      }
      session.step = "has_disaster_area";
      saveSession(session);
      await replyTracked(ctx, session, disasterImpactQuestion(windows), {
        reply_markup: treeKb(session, disasterAreaKeyboard()),
      });
      return;
    }
    case "zip":
      session.step = "has_zip";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "What's your home ZIP code? (5 digits – used only to check county-specific programs.)",
        { reply_markup: treeKb(session, zipKeyboard()) },
      );
      return;
  }
}

function advanceQueue(session: SessionState): void {
  session.queueIndex += 1;
}

/**
 * Phone → computer handoff: open Mail with a short-lived download link.
 * Phones can't attach files to mailto:, so the link is the attachment substitute.
 */
async function promptEmailToComputer(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  if (!hasOpenReport(session)) {
    await replyTracked(
      ctx,
      session,
      "There's no Application Guide to email right now. Share CalClaim with a friend who might need help?",
      { reply_markup: idleKeyboard(false) },
    );
    return;
  }

  const forwardFallback =
    "To open your Application Guide on a computer: forward the PDF above to your own email (Telegram → Share), then open the attachment on your laptop.";

  const emailCopy =
    "To open your Application Guide on a computer: tap below – your email app opens with a download link. Send it to yourself, then open the link on your laptop.\n\n" +
    "(Phones can't attach the PDF to email automatically.)";

  if (!appConfig?.publicBaseUrl) {
    await replyTracked(ctx, session, forwardFallback, {
      reply_markup: idleKeyboard(true),
    });
    return;
  }

  const pdf = await renderNextStepsPdf(session);
  const token = storeReportPdf(pdf);
  const shareUrl = reportSharePageUrl(appConfig.publicBaseUrl, token);

  if (!telegramSafeUrl(shareUrl)) {
    await replyTracked(
      ctx,
      session,
      `${forwardFallback}\n\n(Link sharing needs a public HTTPS URL.)`,
      { reply_markup: idleKeyboard(true) },
    );
    return;
  }

  session.step = "idle";
  saveSession(session);
  await replyTracked(ctx, session, emailCopy, {
    reply_markup: emailReportKeyboard(shareUrl),
    link_preview_options: { is_disabled: true },
  });
}

/** Free-text street + city → PG&E map pre-check. Does not persist the address. */
export async function handleShutoffAddressText(
  ctx: Context,
  session: SessionState,
  query: string,
): Promise<void> {
  pushUndoFrame(session);
  const { inZone, message } = await resolveShutoffZone(query);
  session.inShutoffZone = inZone;
  session.shutoffAddressChoices = null;
  await ctx.reply(message, { reply_markup: REMOVE_REPLY_KEYBOARD });
  await beginOfferQueue(ctx, session);
}

/** GPS → nearest street → PG&E map. Does not persist coords or the street. */
export async function handleShutoffLocation(
  ctx: Context,
  session: SessionState,
  lat: number,
  lng: number,
): Promise<void> {
  const result = await resolveShutoffZoneFromCoords(lat, lng);
  if (result.kind === "unresolved") {
    session.step = "has_shutoff_address";
    session.shutoffAddressChoices = null;
    saveSession(session);
    await replyTracked(ctx, session, result.message, {
      reply_markup: shutoffAddressReplyKeyboard(),
    });
    return;
  }
  pushUndoFrame(session);
  session.inShutoffZone = result.inZone;
  session.shutoffAddressChoices = null;
  await ctx.reply(result.message, { reply_markup: REMOVE_REPLY_KEYBOARD });
  await beginOfferQueue(ctx, session);
}

async function promptShutoffAddress(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  session.step = "has_shutoff_address";
  session.shutoffAddressChoices = null;
  saveSession(session);
  await replyTracked(ctx, session, SHUTOFF_ADDRESS_PROMPT, {
    reply_markup: shutoffAddressReplyKeyboard(),
  });
}

export async function handleCallback(
  ctx: Context,
  session: SessionState,
  data: string,
): Promise<void> {
  // Only ack real button taps. Typing "help"/"Help"/etc. reuses this handler
  // without a callback_query – grammy's answerCallbackQuery throws sync then.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => undefined);
  }


  if (data === "nav:back") {
    if (!popUndoFrame(session)) {
      await ctx.reply("Nothing to go back to.");
      return;
    }
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      "Went back one step. Your last answer was cleared – choose again.",
    );
    await repaintCurrentScreen(ctx, session);
    return;
  }

  if (data === "opt:start") {
    pushUndoFrame(session);
    trackFunnel("started", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    await sendGate(ctx, session);
    return;
  }
  if (data === "opt:share") {
    await sendShareMenu(ctx, session);
    return;
  }

  if (data === "help:menu") {
    session.step = "help_menu";
    saveSession(session);
    await replyTracked(ctx, session, HELP_MENU_TEXT, {
      reply_markup: helpKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  if (data === "help:privacy") {
    await replyTracked(ctx, session, PRIVACY_SHORT, {
      reply_markup: helpKeyboard(),
    });
    return;
  }
  if (data === "help:about") {
    await replyTracked(ctx, session, ABOUT_TEXT, {
      reply_markup: helpKeyboard(),
    });
    return;
  }
  if (data === "help:share") {
    await sendShareMenu(ctx, session);
    return;
  }
  if (data === "help:share_qr") {
    await sendShareQr(ctx, session);
    return;
  }
  if (data === "help:erase_ask") {
    session.awaitingConfirm = "erase";
    session.step = "confirm_erase";
    saveSession(session);
    await replyTracked(ctx, session, "Erase all your CalClaim data and exit?", {
      reply_markup: confirmKeyboard("erase"),
    });
    return;
  }
  if (data === "help:back") {
    if (session.queue.length && session.step !== "idle") {
      await presentOffer(ctx, session);
    } else if (session.step === "idle" || session.remindersEnabled) {
      session.step = "idle";
      saveSession(session);
      await replyTracked(ctx, session, "You're on the idle screen.", {
        reply_markup: idleKeyboard(hasOpenReport(session)),
      });
    } else if (!session.branch) {
      session.step = "opt_in";
      saveSession(session);
      await sendOptIn(ctx, session);
    } else {
      await sendGate(ctx, session);
    }
    return;
  }

  if (data === "stop:ask" || data === "stop:yes") {
    await stopRemindersOnly(ctx, session);
    return;
  }
  if (data === "erase:yes") {
    const uid = session.telegramUserId;
    clearImmigrationAnswer(uid);
    eraseUserQc(uid);
    eraseUserFeedbackTodos(uid);
    deleteSession(uid);
    await ctx.reply("Your data is erased. Goodbye – message /start anytime to begin again.");
    return;
  }
  if (data === "stop:no" || data === "erase:no") {
    session.awaitingConfirm = null;
    saveSession(session);
    if (session.queue.length) {
      await presentOffer(ctx, session);
    } else {
      await sendGate(ctx, session);
    }
    return;
  }

  if (data.startsWith("gate:toggle:")) {
    const id = data.slice("gate:toggle:".length);
    const isProgram = GATE_OPTIONS.some((o) => o.id === id);
    const isNone = id === GATE_NONE_ID;
    if (isProgram || isNone) {
      pushUndoFrame(session);
      if (session.alreadyOn.includes(id)) {
        session.alreadyOn = session.alreadyOn.filter((x) => x !== id);
      } else if (isNone) {
        // None clears any program picks (and vice versa below).
        session.alreadyOn = [GATE_NONE_ID];
      } else {
        session.alreadyOn = [
          ...session.alreadyOn.filter((x) => x !== GATE_NONE_ID),
          id,
        ];
      }
      saveSession(session);
      await ctx.editMessageReplyMarkup({
        reply_markup: treeKb(session, gateKeyboard(session.alreadyOn)),
      }).catch(() => undefined);
      return;
    }
    // Unknown program id – fall through to stale-button reply
  }

  if (data === "gate:done") {
    if (session.alreadyOn.length === 0) {
      await ctx.reply("Pick at least one program, or check None.");
      return;
    }
    pushUndoFrame(session);
    trackFunnel("gate_done", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    if (session.alreadyOn.includes(GATE_NONE_ID)) {
      await continueAfterGateNo(ctx, session);
    } else {
      await continueAfterGateYes(ctx, session);
    }
    return;
  }

  // Stale inline button / voice "none" shortcut – same as check None + Done.
  if (data === "gate:none") {
    pushUndoFrame(session);
    trackFunnel("gate_done", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    await continueAfterGateNo(ctx, session);
    return;
  }

  if (data === "hh:more") {
    pushUndoFrame(session);
    session.step = "household_size_custom";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      "Type how many people are in your household (9 or more):",
    );
    return;
  }

  if (data.startsWith("hh:")) {
    const n = Number(data.slice(3));
    if (!Number.isFinite(n) || n < 1 || n > 30 || !Number.isInteger(n)) {
      const onCustom = session.step === "household_size_custom";
      await replyTracked(
        ctx,
        session,
        onCustom
          ? "Please type a whole number between 9 and 30."
          : "Please tap a number 1–8, or More.",
        onCustom ? undefined : { reply_markup: treeKb(session, householdKeyboard()) },
      );
      return;
    }
    pushUndoFrame(session);
    session.householdSize = n;
    session.step = "income_band";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      `About how much is your household's total yearly income before taxes?

${HOUSEHOLD_EXPLAIN}

Add up income for everyone you just counted.`,
      { reply_markup: treeKb(session, incomeKeyboard(n)) },
    );
    return;
  }

  if (data.startsWith("income:")) {
    const band = data.slice("income:".length) as IncomeBand;
    pushUndoFrame(session);
    session.incomeBand = band;
    session.branch = "no";
    // aboveFera drops income-gated programs; keep any earlier zero-question offers.
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "pastdue:yes" || data === "pastdue:no") {
    pushUndoFrame(session);
    session.pastDue = data === "pastdue:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("bills:toggle:")) {
    const id = data.slice("bills:toggle:".length);
    const isBill = UTILITY_BILL_OPTIONS.some((o) => o.id === id);
    const isNone = id === UTILITY_BILL_NONE_ID;
    if (isBill || isNone) {
      pushUndoFrame(session);
      if (session.billsInMyName.includes(id)) {
        session.billsInMyName = session.billsInMyName.filter((x) => x !== id);
      } else if (isNone) {
        session.billsInMyName = [UTILITY_BILL_NONE_ID];
      } else {
        session.billsInMyName = [
          ...session.billsInMyName.filter((x) => x !== UTILITY_BILL_NONE_ID),
          id,
        ];
      }
      saveSession(session);
      await ctx
        .editMessageReplyMarkup({
          reply_markup: treeKb(session, utilityBillsKeyboard(session.billsInMyName)),
        })
        .catch(() => undefined);
      return;
    }
  }

  if (data === "bills:done") {
    if (session.billsInMyName.length === 0) {
      await ctx.reply("Pick at least one bill type, or check None.");
      return;
    }
    pushUndoFrame(session);
    session.utilityBillsAsked = true;
    session.billNotInMyName = session.billsInMyName.includes(
      UTILITY_BILL_NONE_ID,
    );
    if (session.billNotInMyName) {
      session.docsInHand = session.docsInHand.filter((d) => d !== "utilityBill");
    }
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "shutoff:yes") {
    pushUndoFrame(session);
    session.inShutoffZone = true;
    session.shutoffAddressChoices = null;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "shutoff:unsure" || data === "shutoff:locate") {
    pushUndoFrame(session);
    await promptShutoffAddress(ctx, session);
    return;
  }

  if (data === "shutoff:no") {
    pushUndoFrame(session);
    session.inShutoffZone = false;
    session.shutoffAddressChoices = null;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "shutoffaddr:skip") {
    pushUndoFrame(session);
    session.inShutoffZone = false;
    session.shutoffAddressChoices = null;
    await ctx.reply("Okay, skipping the map check.", {
      reply_markup: REMOVE_REPLY_KEYBOARD,
    });
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "child:yes" || data === "child:no") {
    pushUndoFrame(session);
    session.hasChildInHousehold = data === "child:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "home:ca") {
    pushUndoFrame(session);
    applyResidencyTie(session, "ca_home");
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "home:visit") {
    pushUndoFrame(session);
    applyResidencyTie(session, "visitor");
    await replyTracked(
      ctx,
      session,
      "Most California food and health programs need you to live here. Check benefits in the state where you live for those – we'll only show programs that don't need a California home.",
    );
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "home:other") {
    pushUndoFrame(session);
    session.step = "has_ca_work";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      "Do you work in California (commute, job site, or CA employer wages)?",
      { reply_markup: treeKb(session, caWorkKeyboard()) },
    );
    return;
  }

  if (data === "cawork:yes") {
    pushUndoFrame(session);
    applyResidencyTie(session, "out_of_state_ca_work");
    await replyTracked(
      ctx,
      session,
      "Most California food and health programs need you to live here. We'll check California work-based programs (like unemployment or disability from a CA job).",
    );
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "cawork:no") {
    pushUndoFrame(session);
    applyResidencyTie(session, "out_of_state");
    await replyTracked(
      ctx,
      session,
      "Most California programs need you to live or work here. Check benefits in the state where you live – we'll only show programs that don't need a California home.",
    );
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "buyingev:yes" || data === "buyingev:no") {
    pushUndoFrame(session);
    session.buyingEvThisYear = data === "buyingev:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "firstzev:yes" || data === "firstzev:no") {
    pushUndoFrame(session);
    session.firstTimeZev = data === "firstzev:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "buyingebike:yes" || data === "buyingebike:no") {
    pushUndoFrame(session);
    session.buyingEbikeThisYear = data === "buyingebike:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "retirecar:yes" || data === "retirecar:no") {
    pushUndoFrame(session);
    session.wouldRetireVehicle = data === "retirecar:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "abd:yes" || data === "abd:no") {
    pushUndoFrame(session);
    session.hasAgedBlindOrDisabled = data === "abd:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "foster:yes" || data === "foster:no") {
    pushUndoFrame(session);
    session.isFosterYouth = data === "foster:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "refugee:yes" || data === "refugee:no") {
    pushUndoFrame(session);
    session.isRefugeeOrAsylee = data === "refugee:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "medneed:yes" || data === "medneed:no") {
    pushUndoFrame(session);
    session.hasMedicalDeviceOrCondition = data === "medneed:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (
    data === "meter:own" ||
    data === "meter:shared" ||
    data === "meter:landlord"
  ) {
    pushUndoFrame(session);
    const sharing: MeterSharing =
      data === "meter:own"
        ? "own"
        : data === "meter:shared"
          ? "shared"
          : "landlord_bill";
    session.meterSharing = sharing;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "disaster:yes" || data === "disaster:no") {
    pushUndoFrame(session);
    session.inDisasterArea = data === "disaster:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "disaster:unsure") {
    pushUndoFrame(session);
    session.step = "has_disaster_zip";
    saveSession(session);
    const zipPrompt =
      session.residencyTie === "out_of_state_ca_work"
        ? disasterWorkZipConfirmPrompt()
        : disasterZipConfirmPrompt();
    await replyTracked(ctx, session, zipPrompt, {
      reply_markup: treeKb(session, disasterZipKeyboard()),
    });
    return;
  }

  if (data === "disasterzip:skip") {
    pushUndoFrame(session);
    session.inDisasterArea = false;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("disasterzip:")) {
    const zip = parseZipCode(data.slice("disasterzip:".length));
    if (!zip) {
      await replyTracked(
        ctx,
        session,
        "Please send a 5-digit ZIP code, or tap Skip.",
        { reply_markup: treeKb(session, disasterZipKeyboard()) },
      );
      return;
    }
    if (!countyFromZip(zip)) {
      await replyTracked(
        ctx,
        session,
        "I couldn't match that to a California ZIP. Try again, or tap Skip.",
        { reply_markup: treeKb(session, disasterZipKeyboard()) },
      );
      return;
    }
    pushUndoFrame(session);
    session.inDisasterArea = zipInOfferableDisasterArea(zip);
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "zip:skip") {
    pushUndoFrame(session);
    session.residenceZip = "";
    session.residenceCounty = null;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("zip:")) {
    const raw = data.slice("zip:".length);
    const zip = parseZipCode(raw);
    if (!zip) {
      await replyTracked(
        ctx,
        session,
        "Please send a 5-digit ZIP code, or tap Skip.",
        { reply_markup: treeKb(session, zipKeyboard()) },
      );
      return;
    }
    const county = countyFromZip(zip);
    if (!county) {
      await replyTracked(
        ctx,
        session,
        "I couldn't match that to a California ZIP. Try again, or tap Skip.",
        { reply_markup: treeKb(session, zipKeyboard()) },
      );
      return;
    }
    pushUndoFrame(session);
    session.residenceZip = zip;
    session.residenceCounty = county;
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("work:")) {
    const reason = data.slice("work:".length);
    if (
      reason === "job_loss" ||
      reason === "health" ||
      reason === "family_care" ||
      reason === "none"
    ) {
      pushUndoFrame(session);
      session.workDisruption = reason;
      await beginOfferQueue(ctx, session);
      return;
    }
  }

  if (
    data === "status:eligible" ||
    data === "status:ineligible" ||
    data === "status:declined"
  ) {
    const answer = data.slice("status:".length) as ImmigrationAnswer;
    pushUndoFrame(session);
    setImmigrationAnswer(session.telegramUserId, answer);
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("offer:signup:")) {
    const id = data.split(":")[2]!;
    pushUndoFrame(session);
    recordEvent({
      eventType: "follow_through",
      source: "bot",
      programId: id,
      telegramUserId: session.telegramUserId,
      campaignId: session.campaignId,
    });
    upsertItem(session, id, "in_progress");
    advanceQueue(session);
    saveSession(session);
    await ctx.reply("Added to your Application Guide.");
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:already:")) {
    const id = data.split(":")[2]!;
    pushUndoFrame(session);
    upsertItem(session, id, "done");
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:remind:")) {
    const id = data.split(":")[2]!;
    pushUndoFrame(session);
    upsertItem(session, id, "snoozed");
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:skip:")) {
    const id = data.split(":")[2]!;
    pushUndoFrame(session);
    const dropped = applySkipCascade(session, id);
    for (const droppedId of dropped) {
      upsertItem(
        session,
        droppedId,
        "skipped",
        droppedId === id
          ? undefined
          : `Skipped (dropped with ${getProgram(id)?.name ?? id})`,
      );
    }
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }
  if (data === "offer:exit_guide") {
    if (!hasOpenReport(session)) {
      await presentOffer(ctx, session);
      return;
    }
    pushUndoFrame(session);
    await finishQueue(ctx, session);
    return;
  }

  if (data === "reopen:yes" || data === "reopen:no") {
    const held = listHeldQualifyingPrograms(session);
    pushUndoFrame(session);
    session.reopenNotifyOptIn = data === "reopen:yes";
    if (session.reopenNotifyOptIn) {
      session.reopenWatchProgramIds = held.map((p) => p.id);
      const imm = getImmigrationAnswer(session.telegramUserId);
      session.savedImmigrationStatus =
        imm === "eligible" || imm === "ineligible" ? imm : null;
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        held.length
          ? `Got it – we'll text you if ${held.length === 1 ? "this program opens" : "one of these opens"} and you still qualify. Your answers stay saved for that check.`
          : "Got it – we'll text you if a waitlisted program you qualify for opens.",
      );
    } else {
      session.reopenWatchProgramIds = [];
      session.savedImmigrationStatus = null;
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "No problem – we won't text you about waitlisted programs.",
      );
    }
    await completeFinish(ctx, session);
    return;
  }

  if (data === "idle:restart") {
    const uid = session.telegramUserId;
    const fresh = resetSession(uid);
    await replyTracked(
      ctx,
      fresh,
      "Starting over – this rewrites your saved profile (including any waitlist alerts). Answer with what's true now.",
    );
    await sendOptIn(ctx, fresh);
    return;
  }
  if (data === "idle:share") {
    await sendShareMenu(ctx, session);
    return;
  }
  if (data === "idle:email") {
    await promptEmailToComputer(ctx, session);
    return;
  }
  if (data === "idle:back") {
    session.step = "idle";
    saveSession(session);
    await replyTracked(ctx, session, "What next?", {
      reply_markup: idleKeyboard(hasOpenReport(session)),
    });
    return;
  }
  if (data === "idle:more_info") {
    await handleCallback(ctx, session, "help:menu");
    return;
  }

  if (data === "idle:resend" || data === "todo:resend") {
    if (!hasOpenReport(session)) {
      await replyTracked(
        ctx,
        session,
        "There's no Application Guide right now. Share CalClaim with a friend who might need help?",
        { reply_markup: idleKeyboard(false) },
      );
      return;
    }
    await sendReportBundle(ctx, session);
    if (data === "idle:resend") {
      await replyTracked(ctx, session, "What next?", {
        reply_markup: idleKeyboard(true),
      });
    }
    return;
  }

  // Stale / unknown button – never leave the user hanging
  await ctx.reply(staleCallbackAck(session.step)).catch(() => undefined);
  const repeated = await repeatLastMessage(ctx, session).catch(() => false);
  if (!repeated) {
    await ctx
      .reply("Type help for options, or /start to begin again.")
      .catch(() => undefined);
  }
}

async function sendShareMenu(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  session.step = "help_menu";
  saveSession(session);
  if (!appConfig) {
    await replyTracked(
      ctx,
      session,
      "Sharing isn't ready yet – try again in a moment, or type help.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
  const campaigns = peerShareCampaignsOrFallback(session.telegramUserId);
  const linkUrl = shareTargetUrl(appConfig, campaigns.linkCampaignId);
  if (!linkUrl) {
    await replyTracked(
      ctx,
      session,
      "Sharing isn't ready yet (bot username still loading). Try again in a moment.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
  trackShareOut({
    telegramUserId: session.telegramUserId,
    campaignId: campaigns.linkCampaignId,
    source: "link",
  });
  // t.me/share/url is always Telegram-safe; the target may be /go or t.me deep link.
  const shareHref = telegramShareUrl(linkUrl);
  await replyTracked(ctx, session, buildShareMenuText(linkUrl), {
    reply_markup: shareKeyboard(shareHref),
    link_preview_options: { is_disabled: true },
  });
}

async function sendShareQr(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  session.step = "help_menu";
  saveSession(session);
  if (!appConfig) {
    await replyTracked(
      ctx,
      session,
      "Sharing isn't ready yet – try again in a moment, or type help.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
  const campaigns = peerShareCampaignsOrFallback(session.telegramUserId);
  const qrUrl = shareTargetUrl(appConfig, campaigns.qrCampaignId);
  const linkUrl = shareTargetUrl(appConfig, campaigns.linkCampaignId);
  if (!qrUrl) {
    await replyTracked(
      ctx,
      session,
      "Couldn't build a QR code yet. Copy the share link from Help → Share instead.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
  trackShareOut({
    telegramUserId: session.telegramUserId,
    campaignId: campaigns.qrCampaignId,
    source: "qr",
  });
  const shareHref = linkUrl ? telegramShareUrl(linkUrl) : null;
  const markup = shareKeyboard(shareHref);
  try {
    const png = await renderShareQrPng(qrUrl);
    await ctx.replyWithPhoto(new InputFile(png, "calclaim-share-qr.png"), {
      caption:
        "Have them scan this with their phone camera – it opens CalClaim.\n\nYou can also copy/text the link from the Share screen.",
      reply_markup: markup,
    });
  } catch (err) {
    console.error("sendShareQr failed:", err);
    await replyTracked(
      ctx,
      session,
      "Couldn't generate the QR image just now. Copy/text the share link instead – or try Show QR code again.",
      { reply_markup: markup, link_preview_options: { is_disabled: true } },
    );
    return;
  }
  // Remember the share menu (text) so alpha-feedback repeat stays useful.
  session.lastBotMessage = {
    text: buildShareMenuText(linkUrl ?? qrUrl),
    replyMarkup: { inline_keyboard: markup.inline_keyboard },
  };
  saveSession(session);
}

export function resetSession(telegramUserId: number): SessionState {
  clearImmigrationAnswer(telegramUserId);
  eraseUserFeedbackTodos(telegramUserId);
  const s = emptySession(telegramUserId);
  clearUndoStack(s);
  saveSession(s);
  return s;
}

/** Record /start with optional campaign payload from QR / share links. */
export function trackBotStart(telegramUserId: number, campaignId: string | null): void {
  const campaign = campaignId ? getCampaign(campaignId) : undefined;
  const pin = fromCampaignPin({
    lat: campaign?.lat ?? null,
    lng: campaign?.lng ?? null,
    label: campaign?.label ?? campaign?.name ?? null,
  });
  recordEvent({
    eventType: "bot_start",
    source: campaign ? (campaign.kind === "qr" ? "qr" : "link") : "bot",
    campaignId,
    telegramUserId,
    lat: pin.lat,
    lng: pin.lng,
    label: pin.label,
  });
}
