import { InlineKeyboard } from "grammy";
import { incomeBandLabels } from "../corpus/load.js";
import { PRIVACY_POLICY_URL } from "../privacy/copy.js";

/** Gate-feeder programs shown as multiselect options. */
export const GATE_OPTIONS = [
  { id: "medi_cal", label: "Medi-Cal" },
  { id: "calfresh", label: "CalFresh" },
  { id: "ssi", label: "SSI" },
  { id: "calworks", label: "CalWORKs" },
  { id: "wic", label: "WIC" },
] as const;

export function optInKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Start", "opt:start");
}

export function gateKeyboard(selected: string[] = []): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of GATE_OPTIONS) {
    const mark = selected.includes(opt.id) ? "✓ " : "";
    kb.text(`${mark}${opt.label}`, `gate:toggle:${opt.id}`).row();
  }
  return kb.text("Done", "gate:done").text("None", "gate:none");
}

export function householdKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let n = 1; n <= 8; n++) {
    kb.text(String(n), `hh:${n}`);
    if (n % 4 === 0) kb.row();
  }
  return kb;
}

export function incomeKeyboard(householdSize: number): InlineKeyboard {
  const labels = incomeBandLabels(householdSize);
  return new InlineKeyboard()
    .text(labels.careBand, "income:careBand")
    .row()
    .text(labels.feraBand, "income:feraBand")
    .row()
    .text(labels.aboveFera, "income:aboveFera");
}

export function pastDueKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes — past due", "pastdue:yes")
    .text("No", "pastdue:no")
    .row()
    .text("The PG&E bill is not in my name", "pastdue:not_my_name");
}

export function childHouseholdKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "child:yes")
    .text("No", "child:no");
}

export function offerKeyboardWithUrl(programId: string, applyUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("Open apply page now", applyUrl)
    .row()
    .text("Save to my to do list", `offer:signup:${programId}`)
    .row()
    .text("Already enrolled", `offer:already:${programId}`)
    .text("Skip", `offer:skip:${programId}`);
}

export function careSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Not my bill", "care_skip:not_my_bill")
    .row()
    .text("Not interested", "care_skip:not_interested")
    .row()
    .text("Remind me later", "care_skip:remind_later");
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url("Privacy policy", PRIVACY_POLICY_URL)
    .row()
    .text("Erase all my data", "help:erase_ask")
    .row()
    .text("About", "help:about")
    .row()
    .text("Back", "help:back");
}

export function confirmKeyboard(kind: "stop" | "erase"): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes — erase and exit", `${kind}:yes`)
    .text("No — keep going", `${kind}:no`);
}

export function idleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(
    "Send my 'next steps' file again",
    "idle:resend",
  );
}
