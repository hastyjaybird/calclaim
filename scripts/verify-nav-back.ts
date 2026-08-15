/**
 * Verify Back undoes Application Guide add/skip decisions.
 * Run: npx tsx scripts/verify-nav-back.ts
 */
import { emptySession } from "../src/db/session.js";
import { simulateTreeReview } from "../src/dev/treeReview.js";
import { upsertItem, openTodos } from "../src/nextsteps/model.js";
import { applySkipCascade } from "../src/queue/ranker.js";
import { getProgram, loadPrograms } from "../src/library/load.js";
import { popUndoFrame, pushUndoFrame } from "../src/bot/navBack.js";

function guideIds(session: { items: { programId: string; status: string }[] }) {
  return openTodos(session as never).map((i) => i.programId).sort();
}

function itemStatus(
  session: { items: { programId: string; status: string }[] },
  id: string,
) {
  return session.items.find((i) => i.programId === id)?.status ?? null;
}

function pickNextAction(snap: Awaited<ReturnType<typeof simulateTreeReview>>): string | null {
  const step = snap.screen.step;
  if (step === "household_size") return "hh:1";
  if (step === "income_band") return "income:careBand";
  if (step === "past_due") return "pastdue:no";
  if (step === "has_utility_bills") {
    if (!snap.facts.billsInMyName.length) return "bills:toggle:pge";
    return "bills:done";
  }
  if (step === "has_shared_meter") return "meter:own";
  if (step === "has_shutoff_zone") return "shutoff:no";
  if (step === "has_ca_residency") return "home:ca";
  if (step === "has_buying_ev") return "buyingev:no";
  if (step === "has_first_time_zev") return "firstzev:no";
  if (step === "has_buying_ebike") return "buyingebike:no";
  if (step === "has_retire_vehicle") return "retirecar:no";
  if (step === "has_child") return "child:yes";
  if (step === "has_foster_youth") return "foster:no";
  if (step === "has_refugee_status") return "refugee:no";
  if (step === "has_medical_need") return "medneed:no";
  if (step === "has_abd") return "abd:no";
  if (step === "has_work_disruption") return "work:none";
  if (step === "has_disaster_area") return "disaster:no";
  if (step === "has_disaster_zip") return "disasterzip:skip";
  if (step === "has_zip") return "zip:skip";
  if (step === "has_immigration_status") return "status:eligible";
  if (step === "has_reopen_notify") return "reopen:no";

  const prefer = snap.screen.buttons.find(
    (b) =>
      b.action &&
      b.action !== "nav:back" &&
      (b.action.endsWith(":no") ||
        b.action.includes("aboveFera") ||
        b.action === "meter:own" ||
        b.action.endsWith(":skip") ||
        b.action === "work:none"),
  );
  if (prefer?.action) return prefer.action;
  const any = snap.screen.buttons.find(
    (b) => b.kind === "callback" && b.action && b.action !== "nav:back",
  );
  return any?.action ?? null;
}

async function reachOffer(): Promise<string[]> {
  const explore = ["opt:start", "gate:toggle:none", "gate:done"];
  let snap = await simulateTreeReview(explore);
  for (let i = 0; i < 50 && snap.screen.step !== "offer"; i++) {
    const action = pickNextAction(snap);
    if (!action) {
      throw new Error(
        `Stuck at ${snap.screen.step} buttons=${snap.screen.buttons.map((b) => b.action).join(",")}`,
      );
    }
    explore.push(action);
    snap = await simulateTreeReview(explore);
  }
  if (snap.screen.step !== "offer") {
    throw new Error(`Could not reach offer (ended at ${snap.screen.step})`);
  }
  return explore;
}

async function verifyTreeReplay() {
  loadPrograms();
  const explore = await reachOffer();
  const snap = await simulateTreeReview(explore);
  const programId = snap.queue.current;
  if (!programId) throw new Error("No current offer program id");

  const afterAdd = await simulateTreeReview([
    ...explore,
    `offer:signup:${programId}`,
  ]);
  if (
    afterAdd.programs.find((p) => p.id === programId)?.status !==
    "added_to_guide"
  ) {
    throw new Error("Expected added_to_guide after signup");
  }

  // In-screen Back pops last action
  const afterBack = await simulateTreeReview(explore);
  if (
    afterBack.programs.find((p) => p.id === programId)?.status ===
    "added_to_guide"
  ) {
    throw new Error("Back did not remove program from Application Guide");
  }
  if (afterBack.screen.step !== "offer") {
    throw new Error(`After Back expected offer, got ${afterBack.screen.step}`);
  }
  if (!afterBack.screen.buttons.some((b) => b.action === "nav:back")) {
    throw new Error("Offer screen missing Back button");
  }

  const afterSkip = await simulateTreeReview([
    ...explore,
    `offer:skip:${programId}`,
  ]);
  if (
    afterSkip.programs.find((p) => p.id === programId)?.status !== "skipped"
  ) {
    throw new Error("Skip did not mark skipped");
  }
  const afterSkipBack = await simulateTreeReview(explore);
  const addAgain = await simulateTreeReview([
    ...afterSkipBack.actions,
    `offer:signup:${programId}`,
  ]);
  if (
    addAgain.programs.find((p) => p.id === programId)?.status !==
    "added_to_guide"
  ) {
    throw new Error("After skip→Back→Add, program not on Application Guide");
  }

  console.log(
    `tree OK: ${getProgram(programId)?.name ?? programId} add→Back removes; skip→Back→Add includes`,
  );
}

function verifyBotUndoStack() {
  loadPrograms();
  const session = emptySession(42);
  session.step = "offer";
  session.branch = "no";
  session.queue = ["lifeline", "care"];
  session.queueIndex = 0;
  session.docsInHand = ["photoId", "utilityBill"];
  session.undoStack = [];

  pushUndoFrame(session);
  upsertItem(session, "lifeline", "in_progress");
  session.queueIndex = 1;
  if (itemStatus(session, "lifeline") !== "in_progress") {
    throw new Error("signup did not add lifeline");
  }
  if (!guideIds(session).includes("lifeline")) {
    throw new Error("lifeline missing from open guide");
  }

  if (!popUndoFrame(session)) throw new Error("pop failed");
  if (itemStatus(session, "lifeline") !== null) {
    throw new Error("Back did not erase lifeline from items");
  }
  if (session.queueIndex !== 0) {
    throw new Error(`Back should restore queueIndex 0, got ${session.queueIndex}`);
  }

  pushUndoFrame(session);
  const dropped = applySkipCascade(session, "lifeline");
  for (const id of dropped) {
    upsertItem(session, id, "skipped");
  }
  session.queueIndex = 1;
  if (itemStatus(session, "lifeline") !== "skipped") {
    throw new Error("skip failed");
  }

  popUndoFrame(session);
  if (itemStatus(session, "lifeline") !== null) {
    throw new Error("Back after skip left skipped item");
  }
  upsertItem(session, "lifeline", "in_progress");
  if (!guideIds(session).includes("lifeline")) {
    throw new Error("Add after skip→Back did not include lifeline");
  }

  console.log(
    "bot undo stack OK: add→Back clears guide; skip→Back→Add includes",
  );
}

async function main() {
  verifyBotUndoStack();
  await verifyTreeReplay();
  console.log("All nav-back checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
