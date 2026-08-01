import type { Context } from "grammy";
import { InputFile } from "grammy";
import { recordEvent } from "../analytics/db.js";
import { getCampaign } from "../analytics/campaigns.js";
import { trackFunnel } from "../analytics/funnel.js";
import { fromCampaignPin } from "../analytics/geo.js";
import { formatMaxBenefitEstimate } from "../corpus/benefitEstimate.js";
import { HIGH_FRICTION_TIME_DAYS, docLabel } from "../corpus/docs.js";
import { formatFormFillEstimate } from "../corpus/formFill.js";
import type { IncomeBand, Program, SessionState } from "../corpus/types.js";
import {
  deleteSession,
  emptySession,
  saveSession,
} from "../db/session.js";
import { trackedApplyUrl, type AppConfig } from "../config.js";
import { markGateAlreadyOn, upsertItem } from "../nextsteps/model.js";
import {
  renderBenefitsReportPdf,
  renderNextStepsPdf,
} from "../nextsteps/pdf.js";
import { eraseUserFeedbackTodos } from "../feedback/todos.js";
import { ABOUT_TEXT, HELP_MENU_TEXT, PRIVACY_SHORT } from "../privacy/copy.js";
import { eraseUserQc } from "../qc/responses.js";
import {
  applySkipCascade,
  buildQueue,
  currentProgram,
  queueNeedsChildGate,
} from "../queue/ranker.js";
import {
  GATE_OPTIONS,
  careSkipKeyboard,
  childHouseholdKeyboard,
  confirmKeyboard,
  gateKeyboard,
  helpKeyboard,
  householdKeyboard,
  idleKeyboard,
  incomeKeyboard,
  offerKeyboardWithUrl,
  optInKeyboard,
  pastDueKeyboard,
} from "./keyboards.js";
import { replyTracked } from "./reply.js";

let appConfig: AppConfig | null = null;

export function setFlowConfig(config: AppConfig): void {
  appConfig = config;
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

function applyTrackingUrl(programId: string, fallbackUrl: string): string {
  if (!appConfig?.publicBaseUrl) return fallbackUrl;
  const tracked = trackedApplyUrl(appConfig.publicBaseUrl, programId);
  return telegramSafeUrl(tracked) ? tracked : fallbackUrl;
}

export async function sendOptIn(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  await replyTracked(
    ctx,
    session,
    `CalClaim helps you find California benefits and bill help — food, health, phone discounts, energy bill programs, tax credits, and more.

Estimates only. Not affiliated with any agency.
Type 'help' for more options.

(Hi alpha user! Thank you for testing this app. At any time, you can text or send a voice message describing any issue that comes up or suggest an improvement.)`,
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
    `Is anyone in your household on any of the following? (Household = people who share finances or depend on each other — not roommates who keep separate money.) Tap all that apply, then Done — or None.`,
    { reply_markup: gateKeyboard([]) },
  );
}

async function continueAfterGateYes(ctx: Context, session: SessionState): Promise<void> {
  session.branch = "yes";
  session.docsInHand = ["categoricalProof", "photoId", "utilityBill"];
  session.queue = [];
  session.queueIndex = 0;
  markGateAlreadyOn(session);
  session.step = "past_due";
  saveSession(session);
  await replyTracked(
    ctx,
    session,
    "Is your utility bill past due? (only affects one optional program)",
    { reply_markup: pastDueKeyboard() },
  );
}

async function continueAfterGateNo(ctx: Context, session: SessionState): Promise<void> {
  session.branch = "no";
  session.docsInHand = ["photoId", "utilityBill"];
  session.alreadyOn = [];
  session.step = "household_size";
  saveSession(session);
  await replyTracked(
    ctx,
    session,
    "How many people live in your home?\n\nCount people who share finances or depend on each other — not roommates who keep separate money.",
    { reply_markup: householdKeyboard() },
  );
}

async function sendNextStepsFile(ctx: Context, session: SessionState): Promise<void> {
  const buf = await renderNextStepsPdf(session);
  await ctx.replyWithDocument(
    new InputFile(buf, "calclaim-next-steps.pdf"),
    { caption: "Updated your 'next steps' file ↓" },
  );
}

async function sendFinalReport(ctx: Context, session: SessionState): Promise<void> {
  const buf = await renderBenefitsReportPdf(session);
  await ctx.replyWithDocument(
    new InputFile(buf, "calclaim-benefits-report.pdf"),
    { caption: "Your benefits report — keep this with your 'next steps' file." },
  );
}

export async function presentOffer(ctx: Context, session: SessionState): Promise<void> {
  if (session.queueIndex >= session.queue.length) {
    session.step = "idle";
    session.remindersEnabled = true;
    saveSession(session);
    trackFunnel("finished", session.telegramUserId);
    await sendNextStepsFile(ctx, session);
    await sendFinalReport(ctx, session);
    await replyTracked(
      ctx,
      session,
      "You're through the list. We'll nudge you about deadlines (Tue noon + 3 days / 1 day before). Say 'to do' anytime for your 'next steps' file.",
      { reply_markup: idleKeyboard() },
    );
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
    trackFunnel("first_offer", session.telegramUserId, { programId: program.id });
  }

  session.step = "offer";
  saveSession(session);

  const lines = [
    `${program.name} — ${program.oneLiner}`,
    formatFormFillEstimate(program, session.docsInHand),
    "",
    formatMaxBenefitEstimate(program, session.householdSize),
  ];
  const deadlineLabel = program.deadlines[0]?.label;
  if (deadlineLabel) {
    lines.push(`Deadline: ${deadlineLabel}`);
  }
  const frictionDocs = highFrictionDocsNeeded(program, session);
  if (frictionDocs.length > 0) {
    lines.push("", "You'll likely need:");
    for (const d of frictionDocs) {
      lines.push(`• ${docLabel(d)}`);
    }
  }

  await replyTracked(ctx, session, lines.join("\n"), {
    reply_markup: offerKeyboardWithUrl(
      program.id,
      applyTrackingUrl(program.id, program.applyUrl),
    ),
  });
}

/** Docs still needed for slower programs (time-to-money ≥ 21 days). */
function highFrictionDocsNeeded(
  program: Program,
  session: SessionState,
): Program["docsNeeded"] {
  if (program.timeToMoneyDays < HIGH_FRICTION_TIME_DAYS) return [];
  return program.docsNeeded.filter((d) => !session.docsInHand.includes(d));
}

/** After triage: ask child gate if needed, else build queue and show first offer. */
async function beginOfferQueue(
  ctx: Context,
  session: SessionState,
): Promise<void> {
  if (queueNeedsChildGate(session)) {
    session.step = "has_child";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      "Any kids under 18 (or a pregnancy) in the household?",
      { reply_markup: childHouseholdKeyboard() },
    );
    return;
  }
  if (session.branch === "no" || session.branch === "yes") {
    session.queue = buildQueue(session);
    session.queueIndex = 0;
  }
  saveSession(session);
  trackFunnel("triage_done", session.telegramUserId);
  await presentOffer(ctx, session);
}

function advanceQueue(session: SessionState): void {
  session.queueIndex += 1;
}

export async function handleCallback(
  ctx: Context,
  session: SessionState,
  data: string,
): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);

  if (data === "opt:start") {
    trackFunnel("started", session.telegramUserId);
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
        reply_markup: idleKeyboard(),
      });
    } else {
      await sendGate(ctx, session);
    }
    return;
  }

  if (data === "stop:ask") {
    session.awaitingConfirm = "stop";
    session.step = "confirm_stop";
    saveSession(session);
    await replyTracked(ctx, session, "Exit CalClaim and erase your data?", {
      reply_markup: confirmKeyboard("stop"),
    });
    return;
  }
  if (data === "stop:yes" || data === "erase:yes") {
    const uid = session.telegramUserId;
    eraseUserQc(uid);
    eraseUserFeedbackTodos(uid);
    deleteSession(uid);
    await ctx.reply("Your data is erased. Goodbye — message /start anytime to begin again.");
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
    if (!GATE_OPTIONS.some((o) => o.id === id)) return;
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

  if (data === "gate:done") {
    if (session.alreadyOn.length === 0) {
      await ctx.reply("Pick at least one, or tap None.");
      return;
    }
    trackFunnel("gate_done", session.telegramUserId);
    await continueAfterGateYes(ctx, session);
    return;
  }

  if (data === "gate:none") {
    trackFunnel("gate_done", session.telegramUserId);
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
      "About how much is that household's total yearly income before taxes? (Combined for everyone you counted.)",
      { reply_markup: incomeKeyboard(n) },
    );
    return;
  }

  if (data.startsWith("income:")) {
    const band = data.slice("income:".length) as IncomeBand;
    session.incomeBand = band;
    if (band === "aboveFera") {
      session.branch = "tax_only";
      session.queue = buildQueue(session);
      session.queueIndex = 0;
      saveSession(session);
      trackFunnel("triage_done", session.telegramUserId);
      await presentOffer(ctx, session);
      return;
    }
    if (band === "feraBand") {
      // FERA → tax (short path); still multi-category via tax credits
      session.branch = "no";
      session.pastDue = false;
      session.queue = ["fera", "tax_credits"];
      session.queueIndex = 0;
      saveSession(session);
      trackFunnel("triage_done", session.telegramUserId);
      await presentOffer(ctx, session);
      return;
    }
    session.branch = "no";
    session.step = "past_due";
    saveSession(session);
    await replyTracked(
      ctx,
      session,
      "Is your utility bill past due? (only affects one optional program)",
      { reply_markup: pastDueKeyboard() },
    );
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

  if (data.startsWith("offer:signup:")) {
    const id = data.split(":")[2]!;
    recordEvent({
      eventType: "follow_through",
      source: "bot",
      programId: id,
      telegramUserId: session.telegramUserId,
    });
    upsertItem(session, id, "in_progress");
    advanceQueue(session);
    saveSession(session);
    await ctx.reply(
      "Saved to your to do list. Say 'to do' anytime and I'll send your 'next steps' file.",
    );
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
    if (id === "care") {
      session.step = "care_skip";
      saveSession(session);
      await replyTracked(ctx, session, "Why skip CARE?", {
        reply_markup: careSkipKeyboard(),
      });
      return;
    }
    upsertItem(session, id, "skipped");
    applySkipCascade(session, id);
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }

  if (data.startsWith("care_skip:")) {
    const reason = data.slice("care_skip:".length);
    if (reason === "remind_later") {
      upsertItem(session, "care", "snoozed");
      advanceQueue(session);
      saveSession(session);
      await presentOffer(ctx, session);
      return;
    }
    upsertItem(session, "care", "skipped", `Skipped CARE (${reason})`);
    applySkipCascade(session, "care", reason);
    advanceQueue(session);
    saveSession(session);
    await presentOffer(ctx, session);
    return;
  }

  if (data === "idle:resend") {
    await sendNextStepsFile(ctx, session);
    await replyTracked(ctx, session, "Anything else?", {
      reply_markup: idleKeyboard(),
    });
    return;
  }

  if (data === "todo:resend") {
    await sendNextStepsFile(ctx, session);
    return;
  }
}

export function resetSession(telegramUserId: number): SessionState {
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
