import type { Context } from "grammy";
import { InputFile } from "grammy";
import { getProgram } from "../corpus/load.js";
import type { IncomeBand, SessionState } from "../corpus/types.js";
import {
  deleteSession,
  emptySession,
  saveSession,
} from "../db/session.js";
import { upsertItem } from "../nextsteps/model.js";
import {
  renderBenefitsReportPdf,
  renderNextStepsPdf,
} from "../nextsteps/pdf.js";
import { ABOUT_TEXT, PRIVACY_SHORT } from "../privacy/copy.js";
import { eraseUserQc } from "../qc/responses.js";
import { applySkipCascade, buildQueue, currentProgram } from "../queue/ranker.js";
import {
  careSkipKeyboard,
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

export async function sendOptIn(ctx: Context): Promise<void> {
  await ctx.reply(
    `CalClaim helps you find California benefits and bill help — food, health, phone discounts, energy bill programs, tax credits, and more.

Estimates only. Not affiliated with any agency or utility.

Tap Start when you're ready.`,
    { reply_markup: optInKeyboard() },
  );
}

export async function sendGate(ctx: Context, session: SessionState): Promise<void> {
  session.step = "gate";
  saveSession(session);
  await ctx.reply(
    `Is anyone in your household already on Medi-Cal, CalFresh, SSI, CalWORKs, or WIC?`,
    { reply_markup: gateKeyboard() },
  );
}

async function sendNextStepsFile(ctx: Context, session: SessionState): Promise<void> {
  const buf = await renderNextStepsPdf(session);
  await ctx.replyWithDocument(
    new InputFile(buf, "calclaim-next-steps.pdf"),
    { caption: "Updated your next-steps file ↓" },
  );
}

async function sendFinalReport(ctx: Context, session: SessionState): Promise<void> {
  const buf = await renderBenefitsReportPdf(session);
  await ctx.replyWithDocument(
    new InputFile(buf, "calclaim-benefits-report.pdf"),
    { caption: "Your benefits report — keep this with your next-steps file." },
  );
}

export async function presentOffer(ctx: Context, session: SessionState): Promise<void> {
  if (session.queueIndex >= session.queue.length) {
    session.step = "idle";
    session.remindersEnabled = true;
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await sendFinalReport(ctx, session);
    await ctx.reply(
      `You're through the offer list. We'll nudge you about deadlines (Tue noon + 3 days / 1 day before).

Help anytime. STOP to erase your data.`,
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

  session.step = "offer";
  saveSession(session);

  await ctx.reply(
    `${program.name} — ${program.oneLiner}

Est. ${program.maxBenefit}
Category: ${program.category}
Deadline: ${program.deadlines[0]?.label ?? "None listed — check site"}

Open the official page, then tap below to update your list.`,
    { reply_markup: offerKeyboardWithUrl(program.id, program.applyUrl) },
  );
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
    await sendGate(ctx, session);
    return;
  }

  if (data === "help:menu") {
    session.step = "help_menu";
    saveSession(session);
    await ctx.reply("Help — pick one:", { reply_markup: helpKeyboard() });
    return;
  }
  if (data === "help:privacy") {
    await ctx.reply(PRIVACY_SHORT, { reply_markup: helpKeyboard() });
    return;
  }
  if (data === "help:about") {
    await ctx.reply(ABOUT_TEXT, { reply_markup: helpKeyboard() });
    return;
  }
  if (data === "help:erase_ask") {
    session.awaitingConfirm = "erase";
    session.step = "confirm_erase";
    saveSession(session);
    await ctx.reply("Erase all your CalClaim data and exit?", {
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
      await ctx.reply("You're on the idle screen.", { reply_markup: idleKeyboard() });
    } else {
      await sendGate(ctx, session);
    }
    return;
  }

  if (data === "stop:ask") {
    session.awaitingConfirm = "stop";
    session.step = "confirm_stop";
    saveSession(session);
    await ctx.reply("Exit CalClaim and erase your data?", {
      reply_markup: confirmKeyboard("stop"),
    });
    return;
  }
  if (data === "stop:yes" || data === "erase:yes") {
    const uid = session.telegramUserId;
    eraseUserQc(uid);
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

  if (data === "gate:yes") {
    session.branch = "yes";
    session.docsInHand = ["categoricalProof", "photoId", "utilityBill"];
    session.alreadyOn = [];
    session.queue = [];
    session.queueIndex = 0;
    session.step = "past_due";
    saveSession(session);
    await ctx.reply(
      "Got it — we'll prioritize programs that reuse docs you likely already have (food, phone, bill help, and more).\n\nIs your utility bill past due? (only affects one optional program)",
      { reply_markup: pastDueKeyboard() },
    );
    return;
  }

  if (data === "gate:no") {
    session.branch = "no";
    session.docsInHand = ["photoId", "utilityBill"];
    session.step = "household_size";
    saveSession(session);
    await ctx.reply(
      "How many people live in your home? (used for income guidelines)",
      { reply_markup: householdKeyboard() },
    );
    return;
  }

  if (data.startsWith("hh:")) {
    const n = Number(data.slice(3));
    session.householdSize = n;
    session.step = "income_band";
    saveSession(session);
    await ctx.reply(
      "About how much is your household's total yearly income before taxes?",
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
      await ctx.reply(
        "Based on that income band, we'll show tax-credit info (other income programs may not fit). Estimates only.",
      );
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
      await ctx.reply(
        "FERA-range path: bill discount (if your utility offers FERA) plus tax-credit info. Estimates only.",
      );
      await presentOffer(ctx, session);
      return;
    }
    session.branch = "no";
    session.step = "past_due";
    saveSession(session);
    await ctx.reply(
      "Is your utility bill past due? (only affects one optional program)",
      { reply_markup: pastDueKeyboard() },
    );
    return;
  }

  if (data === "pastdue:yes" || data === "pastdue:no") {
    session.pastDue = data === "pastdue:yes";
    if (session.branch === "no" || session.branch === "yes") {
      session.queue = buildQueue(session);
      session.queueIndex = 0;
    }
    saveSession(session);
    const categories = [
      ...new Set(
        session.queue
          .map((id) => getProgram(id)?.category)
          .filter(Boolean),
      ),
    ];
    await ctx.reply(
      `Here come programs across: ${categories.join(", ") || "your list"}.\nOne at a time — energy bill help is just one category among them.`,
    );
    await presentOffer(ctx, session);
    return;
  }

  if (data.startsWith("offer:signup:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "in_progress");
    advanceQueue(session);
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:already:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "done");
    advanceQueue(session);
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:remind:")) {
    const id = data.split(":")[2]!;
    upsertItem(session, id, "snoozed");
    advanceQueue(session);
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await presentOffer(ctx, session);
    return;
  }
  if (data.startsWith("offer:skip:")) {
    const id = data.split(":")[2]!;
    if (id === "care") {
      session.step = "care_skip";
      saveSession(session);
      await ctx.reply("Why skip CARE?", { reply_markup: careSkipKeyboard() });
      return;
    }
    upsertItem(session, id, "skipped");
    applySkipCascade(session, id);
    advanceQueue(session);
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await presentOffer(ctx, session);
    return;
  }

  if (data.startsWith("care_skip:")) {
    const reason = data.slice("care_skip:".length);
    if (reason === "remind_later") {
      upsertItem(session, "care", "snoozed");
      advanceQueue(session);
      saveSession(session);
      await sendNextStepsFile(ctx, session);
      await presentOffer(ctx, session);
      return;
    }
    upsertItem(session, "care", "skipped", `Skipped CARE (${reason})`);
    applySkipCascade(session, "care", reason);
    advanceQueue(session);
    saveSession(session);
    await sendNextStepsFile(ctx, session);
    await presentOffer(ctx, session);
    return;
  }

  if (data === "idle:resend") {
    await sendNextStepsFile(ctx, session);
    await ctx.reply("Anything else?", { reply_markup: idleKeyboard() });
    return;
  }
}

export function resetSession(telegramUserId: number): SessionState {
  const s = emptySession(telegramUserId);
  saveSession(s);
  return s;
}
