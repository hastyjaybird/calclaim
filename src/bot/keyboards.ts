import { InlineKeyboard } from "grammy";
import { incomeBandLabels } from "../library/load.js";
import { PRIVACY_POLICY_URL } from "../privacy/copy.js";

/** Gate-feeder programs shown as multiselect options. */
export const GATE_OPTIONS = [
  { id: "medi_cal", label: "Medi-Cal" },
  { id: "calfresh", label: "CalFresh" },
  { id: "ssi", label: "SSI" },
  { id: "calworks", label: "CalWORKs" },
  { id: "capi", label: "CAPI" },
  { id: "ga_gr", label: "GA/GR" },
  { id: "cmsp", label: "CMSP" },
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
    .text("Yes – past due", "pastdue:yes")
    .text("No", "pastdue:no")
    .row()
    .text("The PG&E bill is not in my name", "pastdue:not_my_name");
}

export function childHouseholdKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "child:yes")
    .text("No", "child:no");
}

export function abdHouseholdKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "abd:yes")
    .text("No", "abd:no");
}

export function disasterAreaKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "disaster:yes")
    .text("No", "disaster:no");
}

export function zipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Skip – not sure", "zip:skip");
}

export function workDisruptionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Lost my job", "work:job_loss")
    .row()
    .text("Can't work – illness, injury, or pregnancy", "work:health")
    .row()
    .text("Caring for a sick family member / new baby", "work:family_care")
    .row()
    .text("None of these", "work:none");
}

export function immigrationStatusKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – citizen or eligible immigrant", "status:eligible")
    .row()
    .text("No", "status:ineligible")
    .row()
    .text("Prefer not to say", "status:declined");
}

/** Offer actions stay in-chat – no outbound apply URL (reduces drop-off). */
export function offerKeyboard(programId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("I'm already enrolled", `offer:already:${programId}`)
    .row()
    .text("Add to my To Do List", `offer:signup:${programId}`)
    .row()
    .text("Skip program", `offer:skip:${programId}`);
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url("Privacy policy", PRIVACY_POLICY_URL)
    .row()
    .text("Share", "help:share")
    .row()
    .text("Erase all my data", "help:erase_ask")
    .row()
    .text("About", "help:about")
    .row()
    .text("Back", "help:back");
}

/** Share submenu: Telegram native share + QR; link is in the message text. */
export function shareKeyboard(telegramShareHref: string | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (telegramShareHref) {
    kb.url("Share link in Telegram", telegramShareHref).row();
  }
  return kb
    .text("Show QR code", "help:share_qr")
    .row()
    .text("Back", "help:menu");
}

export function confirmKeyboard(kind: "stop" | "erase"): InlineKeyboard {
  if (kind === "stop") {
    return new InlineKeyboard()
      .text("Yes – stop reminders", "stop:yes")
      .text("No – keep going", "stop:no");
  }
  return new InlineKeyboard()
    .text("Yes – erase and exit", "erase:yes")
    .text("No – keep going", "erase:no");
}

/** End-of-flow actions. Email only when there is an open to-do report. */
export function idleKeyboard(hasReport = true): InlineKeyboard {
  const kb = new InlineKeyboard();
  // No report → lead with share (primary nudge when nothing to apply for).
  if (!hasReport) {
    kb.text("Share CalClaim with friends", "idle:share")
      .row()
      .text("Restart", "idle:restart")
      .row()
      .text("More info", "idle:more_info");
    return kb;
  }
  // Report ready → email-to-computer is the primary next job.
  return kb
    .text("Email report to my computer", "idle:email")
    .row()
    .text("Share CalClaim with friends", "idle:share")
    .row()
    .text("Restart", "idle:restart")
    .row()
    .text("More info", "idle:more_info");
}

/** Opens share page that auto-launches Mail with a download link. */
export function emailReportKeyboard(sharePageUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("Send link to my email", sharePageUrl)
    .row()
    .text("Not now", "idle:back");
}

/** Finish-line apply handoff: one URL button per open to-do program. */
export function programSitesKeyboard(
  sites: { label: string; url: string }[],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const site of sites) {
    const label =
      site.label.length > 64 ? `${site.label.slice(0, 61)}...` : site.label;
    kb.url(label, site.url).row();
  }
  return kb;
}
