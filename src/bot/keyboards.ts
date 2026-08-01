import { InlineKeyboard } from "grammy";
import { incomeBandLabels } from "../corpus/load.js";

export function optInKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Start", "opt:start");
}

export function gateKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "gate:yes")
    .text("No", "gate:no")
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}

export function householdKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let n = 1; n <= 8; n++) {
    kb.text(String(n), `hh:${n}`);
    if (n % 4 === 0) kb.row();
  }
  return kb.row().text("Help", "help:menu").text("STOP", "stop:ask");
}

export function incomeKeyboard(householdSize: number): InlineKeyboard {
  const labels = incomeBandLabels(householdSize);
  return new InlineKeyboard()
    .text(labels.careBand, "income:careBand")
    .row()
    .text(labels.feraBand, "income:feraBand")
    .row()
    .text(labels.aboveFera, "income:aboveFera")
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}

export function pastDueKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes — past due", "pastdue:yes")
    .text("No / not sure", "pastdue:no")
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}

export function offerKeyboardWithUrl(programId: string, applyUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("Open apply page", applyUrl)
    .row()
    .text("I opened it — add to list", `offer:signup:${programId}`)
    .row()
    .text("Already enrolled", `offer:already:${programId}`)
    .text("Remind me later", `offer:remind:${programId}`)
    .row()
    .text("Skip", `offer:skip:${programId}`)
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}

export function careSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Not my bill", "care_skip:not_my_bill")
    .row()
    .text("Not interested", "care_skip:not_interested")
    .row()
    .text("Remind me later", "care_skip:remind_later")
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Privacy policy", "help:privacy")
    .row()
    .text("Erase all my data", "help:erase_ask")
    .row()
    .text("About", "help:about")
    .row()
    .text("STOP", "stop:ask")
    .text("Back", "help:back");
}

export function confirmKeyboard(kind: "stop" | "erase"): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes — erase and exit", `${kind}:yes`)
    .text("No — keep going", `${kind}:no`);
}

export function idleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Send my next-steps file again", "idle:resend")
    .row()
    .text("Help", "help:menu")
    .text("STOP", "stop:ask");
}
