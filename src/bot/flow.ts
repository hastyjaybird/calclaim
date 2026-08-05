import type { Context } from "grammy";
import { InputFile } from "grammy";
import { recordEvent } from "../analytics/db.js";
import { getCampaign } from "../analytics/campaigns.js";
import { trackFunnel } from "../analytics/funnel.js";
import { fromCampaignPin } from "../analytics/geo.js";
import { countyFromZip, parseZipCode } from "../library/geo.js";
import {
  formatMaxBenefitEstimate,
  formatUsd,
} from "../library/benefitEstimate.js";
import { HIGH_FRICTION_TIME_DAYS, docLabel, missingDocs } from "../library/docs.js";
import { formatFormFillEstimate } from "../library/formFill.js";
import { getProgram } from "../library/load.js";
import type { IncomeBand, Program, SessionState } from "../library/types.js";
import {
  deleteSession,
  emptySession,
  saveSession,
} from "../db/session.js";
import {
  docsSavingsTable,
  markGateAlreadyOn,
  openProgramsAnnualUsd,
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
  PRIVACY_SHORT,
} from "../privacy/copy.js";
import { eraseUserQc } from "../qc/responses.js";
import {
  applySkipCascade,
  currentProgram,
  extendOfferQueue,
  pickNextTriageGate,
  queueNeedsStatusGate,
  type ImmigrationAnswer,
  type TriageGateId,
} from "../queue/ranker.js";
import type { DisasterWindow } from "../disaster/db.js";
import {
  describeArea,
  formatApplyChannel,
  formatCounties,
  formatIncidentRange,
  formatWindowTiming,
} from "../disaster/format.js";
import {
  isOpenToday,
  offerableDisasterWindows,
  windowForProgram,
} from "../disaster/liveWindow.js";
import { trackedApplyUrl, type AppConfig } from "../config.js";
import {
  clearImmigrationAnswer,
  markAwaitingImmigrationPrompt,
  setImmigrationAnswer,
} from "../queue/immigrationMemory.js";
import { staleCallbackAck } from "./interpret.js";
import {
  GATE_OPTIONS,
  abdHouseholdKeyboard,
  childHouseholdKeyboard,
  disasterAreaKeyboard,
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
  shareKeyboard,
} from "./keyboards.js";
import { replyTracked, repeatLastMessage } from "./reply.js";
import {
  SHARE_LINK_CAMPAIGN,
  SHARE_QR_CAMPAIGN,
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

/** Public site shown first in the opt-in message (Telegram auto-linkifies https). */
const CALCLAIM_SITE_FALLBACK = "https://calclaim.jayhasty.com";

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
    `${siteUrl}

CalClaim helps you find California benefits and bill help – food, health, phone discounts, energy bill programs, and more.

Estimates only. Not affiliated with any agency.
Type 'help' for more options.

At any time, you can text or send a voice message describing any issue that comes up or suggest an improvement ✨`,
    { reply_markup: optInKeyboard() },
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

Tap all that apply, then Done – or None.`,
    { reply_markup: gateKeyboard([]) },
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
    new InputFile(buf, "calclaim-todo-list.pdf"),
    { caption: "Your To Do List (benefits report) ↓" },
  );
}

/** Resolve Telegram-safe apply URLs (prefer tracked /r/:id when public base is https). */
function programSiteButtons(
  session: SessionState,
): { label: string; url: string }[] {
  const sites: { label: string; url: string }[] = [];
  for (const item of openTodos(session)) {
    const tracked =
      appConfig?.publicBaseUrl &&
      trackedApplyUrl(appConfig.publicBaseUrl, item.programId);
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

/** Abbreviated chat summary before the PDF (docs → $, total, program names). */
function formatReportSummary(session: SessionState): string {
  const total = openProgramsAnnualUsd(session);
  const totalLabel = formatUsd(total);
  const docs = docsSavingsTable(session);
  const todos = openTodos(session);

  const lines = [
    "You're through the list.",
    "",
    `You may qualify for a total of ~${totalLabel} this year (estimates only).`,
  ];

  if (docs.length > 0) {
    lines.push("", "Documents that unlock aid:");
    for (const d of docs) {
      lines.push(`• ${d.label} – up to ~${formatUsd(d.annualUsd)}/yr`);
    }
  }

  if (todos.length > 0) {
    lines.push("", "Programs on your To Do List:");
    for (const item of todos) {
      lines.push(`• ${item.programName}`);
    }
  }

  lines.push(
    "",
    "Full report PDF coming next ↓",
    "",
    "We'd really appreciate any feedback – just send a text or voice message anytime.",
    "",
    "For more help, visit BenefitsCal at https://benefitscal.com/",
  );
  return lines.join("\n");
}

function formatEmptyQueueMessage(): string {
  return `You're through the list – nothing to add to a To Do List right now.

Know someone who might need benefits help? Share CalClaim with a friend.

We'd really appreciate any feedback – just send a text or voice message anytime.`;
}

/** Pause deadline reminders only – keeps session, todos, and data. */
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
    "Reminders stopped. Your To Do List and data stay. Message me anytime to turn reminders back on – or say 'to do' for your report, help for more info.",
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

async function finishQueue(ctx: Context, session: SessionState): Promise<void> {
  clearImmigrationAnswer(session.telegramUserId);
  session.step = "idle";
  session.remindersEnabled = true;
  saveSession(session);
  trackFunnel("finished", session.telegramUserId, {
    campaignId: session.campaignId,
  });

  const open = openTodos(session);
  if (open.length === 0) {
    await replyTracked(ctx, session, formatEmptyQueueMessage(), {
      reply_markup: idleKeyboard(false),
    });
    return;
  }

  await sendReportBundle(ctx, session);
  // Primary job after apply links: get the PDF onto a computer (nobody has Telegram Desktop).
  await promptEmailToComputer(ctx, session);
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

  const window = windowForProgram(program);
  const openToday = window ? isOpenToday(window) : false;
  const supplement = isDisasterSupplement(program, session);

  const lines = [
    window && !openToday
      ? `${program.name} is coming to your area.`
      : `You may qualify for ${program.name}.`,
    "",
    window
      ? `${program.name} – ${disasterOneLiner(window, supplement)}`
      : `${program.name} – ${program.oneLiner}`,
    formatFormFillEstimate(program, session.docsInHand),
    "",
    supplement
      ? "Est. a one-time top-up to the maximum food benefit for your household size"
      : formatMaxBenefitEstimate(program, session.householdSize),
  ];

  if (window) {
    // Dates and apply channel are per event and per county – the library deadline
    // and apply URL are both wrong during a real window.
    const timing = formatWindowTiming(window.applyPeriods, openToday);
    if (timing) lines.push(timing);
    const channel = formatApplyChannel(window);
    if (channel) lines.push(channel);
    else if (!openToday) {
      lines.push("Your county publishes the phone number when the window opens.");
    }
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

  const frictionDocs = highFrictionDocsNeeded(program, session);
  if (frictionDocs.length > 0) {
    lines.push("", "You'll likely need:");
    for (const d of frictionDocs) {
      lines.push(`• ${docLabel(d)}`);
    }
  }

  await replyTracked(ctx, session, lines.join("\n"), {
    reply_markup: offerKeyboard(program.id),
  });
}

/** Docs still needed for slower programs (time-to-money ≥ 21 days). */
function highFrictionDocsNeeded(
  program: Program,
  session: SessionState,
): Program["docsNeeded"] {
  if (program.timeToMoneyDays < HIGH_FRICTION_TIME_DAYS) return [];
  return missingDocs(program.docsNeeded, session.docsInHand);
}

/**
 * Households already on CalFresh are not excluded – CDSS gives them a
 * supplemental payment up to the maximum allotment instead of a full month.
 */
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

/**
 * The legal test is home *or* work location, for any household member, so one
 * yes/no over the named areas fits it exactly – and nothing about the user's
 * location needs storing.
 */
function disasterAreaQuestion(windows: DisasterWindow[]): string {
  const single = windows.length === 1 ? windows[0]! : null;
  const singleRange = single
    ? formatIncidentRange(single.incidentBegin, single.incidentEnd)
    : null;
  const lines = [
    singleRange
      ? `Did you live or work in any of these areas during ${singleRange}?`
      : "Did you live or work in any of these disaster areas?",
  ];

  for (const window of windows) {
    lines.push("");
    if (!single) {
      const range = formatIncidentRange(window.incidentBegin, window.incidentEnd);
      lines.push(range ? `${window.label} (${range})` : window.label);
    }
    for (const line of describeArea(window)) lines.push(line);
  }

  lines.push(
    "",
    "Say yes if anyone in your household lived or worked there – a job in the area counts even if you live somewhere else.",
  );
  return lines.join("\n");
}

/**
 * Offer programs eligible with answers so far (fewest extra questions first via
 * wave order). When the current wave is empty, ask the next gate that unlocks
 * the cheapest remaining programs – never front-load the full quiz.
 */
async function beginOfferQueue(
  ctx: Context,
  session: SessionState,
): Promise<void> {
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
    `A few more programs check immigration status.

Are you (or the person applying) a U.S. citizen or an eligible immigrant?

Your answer is not stored and is not connected to your phone number – it is completely private. We only use it once to decide which programs to show next.`,
    { reply_markup: immigrationStatusKeyboard() },
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

Tap a number:`,
          { reply_markup: householdKeyboard() },
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
        { reply_markup: incomeKeyboard(session.householdSize) },
      );
      return;
    case "past_due":
      session.step = "past_due";
      saveSession(session);
      await replyTracked(ctx, session, "Is your utility bill past due?", {
        reply_markup: pastDueKeyboard(),
      });
      return;
    case "child":
      session.step = "has_child";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        `Any kids under 18 (or a pregnancy) in the household?

${HOUSEHOLD_EXPLAIN}`,
        { reply_markup: childHouseholdKeyboard() },
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
        { reply_markup: abdHouseholdKeyboard() },
      );
      return;
    case "work":
      session.step = "has_work_disruption";
      saveSession(session);
      await replyTracked(
        ctx,
        session,
        "Has anything affected your ability to work in the last few months?",
        { reply_markup: workDisruptionKeyboard() },
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
      await replyTracked(ctx, session, disasterAreaQuestion(windows), {
        reply_markup: disasterAreaKeyboard(),
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
        { reply_markup: zipKeyboard() },
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
      "There's no to-do report to email right now. Share CalClaim with a friend who might need help?",
      { reply_markup: idleKeyboard(false) },
    );
    return;
  }

  const forwardFallback =
    "To open this report on a computer: forward the PDF above to your own email (Telegram → Share), then open the attachment on your laptop.";

  const emailCopy =
    "To open this report on a computer: tap below – your email app opens with a download link. Send it to yourself, then open the link on your laptop.\n\n" +
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

  if (data === "opt:start") {
    trackFunnel("started", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    await sendGate(ctx, session);
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
    if (GATE_OPTIONS.some((o) => o.id === id)) {
      if (session.alreadyOn.includes(id)) {
        session.alreadyOn = session.alreadyOn.filter((x) => x !== id);
      } else {
        session.alreadyOn = [...session.alreadyOn, id];
      }
      saveSession(session);
      await ctx.editMessageReplyMarkup({
        reply_markup: gateKeyboard(session.alreadyOn),
      }).catch(() => undefined);
      return;
    }
    // Unknown program id – fall through to stale-button reply
  }

  if (data === "gate:done") {
    if (session.alreadyOn.length === 0) {
      await ctx.reply("Pick at least one, or tap None.");
      return;
    }
    trackFunnel("gate_done", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    await continueAfterGateYes(ctx, session);
    return;
  }

  if (data === "gate:none") {
    trackFunnel("gate_done", session.telegramUserId, {
      campaignId: session.campaignId,
    });
    await continueAfterGateNo(ctx, session);
    return;
  }

  if (data.startsWith("hh:")) {
    const n = Number(data.slice(3));
    session.householdSize = n;
    session.step = "income_band";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      `About how much is your household's total yearly income before taxes?

${HOUSEHOLD_EXPLAIN}

Add up income for everyone you just counted.`,
      { reply_markup: incomeKeyboard(n) },
    );
    return;
  }

  if (data.startsWith("income:")) {
    const band = data.slice("income:".length) as IncomeBand;
    session.incomeBand = band;
    session.branch = "no";
    // aboveFera drops income-gated programs; keep any earlier zero-question offers.
    await beginOfferQueue(ctx, session);
    return;
  }

  if (
    data === "pastdue:yes" ||
    data === "pastdue:no" ||
    data === "pastdue:not_my_name"
  ) {
    session.billNotInMyName = data === "pastdue:not_my_name";
    session.pastDue = data === "pastdue:yes";
    if (session.billNotInMyName) {
      session.docsInHand = session.docsInHand.filter((d) => d !== "utilityBill");
    }
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "child:yes" || data === "child:no") {
    session.hasChildInHousehold = data === "child:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "abd:yes" || data === "abd:no") {
    session.hasAgedBlindOrDisabled = data === "abd:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "disaster:yes" || data === "disaster:no") {
    session.inDisasterArea = data === "disaster:yes";
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data === "zip:skip") {
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
        { reply_markup: zipKeyboard() },
      );
      return;
    }
    const county = countyFromZip(zip);
    if (!county) {
      await replyTracked(
        ctx,
        session,
        "I couldn't match that to a California ZIP. Try again, or tap Skip.",
        { reply_markup: zipKeyboard() },
      );
      return;
    }
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
    setImmigrationAnswer(session.telegramUserId, answer);
    await beginOfferQueue(ctx, session);
    return;
  }

  if (data.startsWith("offer:signup:")) {
    const id = data.split(":")[2]!;
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
    await ctx.reply("Added to your To Do List.");
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:already:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "done");
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:remind:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "snoozed");
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:skip:")) {
    const id = data.split(":")[2]!;
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

  if (data === "idle:restart") {
    const uid = session.telegramUserId;
    const fresh = resetSession(uid);
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
        "There's no to-do report right now. Share CalClaim with a friend who might need help?",
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
  const linkUrl = shareTargetUrl(appConfig, SHARE_LINK_CAMPAIGN);
  if (!linkUrl) {
    await replyTracked(
      ctx,
      session,
      "Sharing isn't ready yet (bot username still loading). Try again in a moment.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
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
  const qrUrl = shareTargetUrl(appConfig, SHARE_QR_CAMPAIGN);
  const linkUrl = shareTargetUrl(appConfig, SHARE_LINK_CAMPAIGN);
  if (!qrUrl) {
    await replyTracked(
      ctx,
      session,
      "Couldn't build a QR code yet. Copy the share link from Help → Share instead.",
      { reply_markup: helpKeyboard() },
    );
    return;
  }
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
