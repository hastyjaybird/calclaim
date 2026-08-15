import { InlineKeyboard, Keyboard } from "grammy";
import { incomeBandLabels } from "../library/load.js";
import {
  UTILITY_BILL_NONE_ID,
  UTILITY_BILL_OPTIONS,
} from "../library/utilityBills.js";
import { PRIVACY_POLICY_URL } from "../privacy/copy.js";

/** Gate-feeder programs shown as multiselect options.
 *  Telegram inline-button text max is 64 characters – keep labels under that. */
export const GATE_OPTIONS = [
  { id: "medi_cal", label: "Medi-Cal" },
  { id: "calfresh", label: "CalFresh" },
  { id: "ssi", label: "Supplemental Security Income (SSI)" },
  { id: "calworks", label: "CalWORKs" },
  { id: "capi", label: "Cash Assistance Program for Immigrants (CAPI)" },
  { id: "ga_gr", label: "General Assistance / General Relief (GA/GR)" },
  { id: "cmsp", label: "County Medical Services Program (CMSP)" },
  { id: "wic", label: "Women, Infants, and Children (WIC)" },
] as const;

/** Sentinel in `alreadyOn` while on the gate step: "none of these programs". */
export const GATE_NONE_ID = "none";

export function optInKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Start", "opt:start")
    .row()
    .text("Share CalClaim with friends", "opt:share");
}

export function gateKeyboard(selected: string[] = []): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of GATE_OPTIONS) {
    const mark = selected.includes(opt.id) ? "✓ " : "";
    kb.text(`${mark}${opt.label}`, `gate:toggle:${opt.id}`).row();
  }
  const noneMark = selected.includes(GATE_NONE_ID) ? "✓ " : "";
  kb.text(`${noneMark}None`, `gate:toggle:${GATE_NONE_ID}`).row();
  return kb.text("— Done —", "gate:done");
}

export function householdKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let n = 1; n <= 8; n++) {
    kb.text(String(n), `hh:${n}`);
    if (n % 4 === 0) kb.row();
  }
  return kb.text("More", "hh:more");
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
    .text("No", "pastdue:no");
}

/** Which utility bills are in the user's name – multiselect + None + Done. */
export function utilityBillsKeyboard(selected: string[] = []): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of UTILITY_BILL_OPTIONS) {
    const mark = selected.includes(opt.id) ? "✓ " : "";
    kb.text(`${mark}${opt.label}`, `bills:toggle:${opt.id}`).row();
  }
  const noneMark = selected.includes(UTILITY_BILL_NONE_ID) ? "✓ " : "";
  kb.text(`${noneMark}None`, `bills:toggle:${UTILITY_BILL_NONE_ID}`).row();
  return kb.text("— Done —", "bills:done");
}

export function shutoffZoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – I'm in a shut-off zone", "shutoff:yes")
    .row()
    .text("No / I don't think so", "shutoff:no")
    .row()
    .text("Use my location", "shutoff:locate")
    .row()
    .text("Not sure – check my address", "shutoff:unsure");
}

export const SHUTOFF_LOCATION_BUTTON = "Use my location";
export const SHUTOFF_ADDRESS_SKIP_LABEL = "Skip – don't check";

/** Reply keyboard so Telegram can request GPS (inline buttons cannot). */
export function shutoffAddressReplyKeyboard(): Keyboard {
  return new Keyboard()
    .requestLocation(SHUTOFF_LOCATION_BUTTON)
    .row()
    .text(SHUTOFF_ADDRESS_SKIP_LABEL)
    .resized()
    .oneTime()
    .placeholder("Or type street and city");
}

export function shutoffAddressSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(SHUTOFF_ADDRESS_SKIP_LABEL, "shutoffaddr:skip");
}

export const REMOVE_REPLY_KEYBOARD = { remove_keyboard: true as const };

export function caResidencyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("In California", "home:ca")
    .row()
    .text("In another state", "home:other")
    .row()
    .text("Just visiting / neither", "home:visit");
}

export function caWorkKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – I work in California", "cawork:yes")
    .row()
    .text("No", "cawork:no");
}

export function buyingEvKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "buyingev:yes")
    .text("No", "buyingev:no");
}

export function firstTimeZevKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – first ZEV", "firstzev:yes")
    .text("No", "firstzev:no");
}

export function buyingEbikeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "buyingebike:yes")
    .text("No", "buyingebike:no");
}

export function retireVehicleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – I could scrap one", "retirecar:yes")
    .row()
    .text("No", "retirecar:no");
}

export function childHouseholdKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "child:yes")
    .text("No", "child:no");
}

export function fosterYouthKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "foster:yes")
    .text("No", "foster:no");
}

export function refugeeStatusKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "refugee:yes")
    .text("No", "refugee:no");
}

export function medicalNeedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "medneed:yes")
    .text("No", "medneed:no");
}

export function sharedMeterKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("No, just us", "meter:own")
    .text("Yes, we share it", "meter:shared")
    .row()
    .text("Landlord bills me", "meter:landlord");
}

export function abdHouseholdKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "abd:yes")
    .text("No", "abd:no");
}

export function disasterAreaKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes", "disaster:yes")
    .text("No", "disaster:no")
    .row()
    .text("Not sure", "disaster:unsure");
}

export function disasterZipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Skip – not sure", "disasterzip:skip");
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
export function offerKeyboard(
  programId: string,
  opts: { canExitGuide?: boolean } = {},
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Add to My Application Guide", `offer:signup:${programId}`)
    .row()
    .text("I'm already enrolled", `offer:already:${programId}`)
    .row()
    .text("Skip program", `offer:skip:${programId}`);
  // Once the guide has something to print, let them leave the queue early.
  if (opts.canExitGuide) {
    kb.row().text(
      "Exit & print My Application Guide now",
      "offer:exit_guide",
    );
  }
  return kb;
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

/** Opt-in to be texted when waitlisted / paused programs reopen. */
export function reopenNotifyKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yes – notify me", "reopen:yes")
    .row()
    .text("No thanks", "reopen:no");
}

/** End-of-flow actions. Email only when there is an open Application Guide. */
export function idleKeyboard(hasReport = true): InlineKeyboard {
  const kb = new InlineKeyboard();
  // No guide → lead with share (primary nudge when nothing to apply for).
  if (!hasReport) {
    kb.text("Share CalClaim with friends", "idle:share")
      .row()
      .text("Update my answers", "idle:restart")
      .row()
      .text("More info", "idle:more_info");
    return kb;
  }
  // Guide ready → email-to-computer is the primary next job.
  return kb
    .text("Email Application Guide to my computer", "idle:email")
    .row()
    .text("Share CalClaim with friends", "idle:share")
    .row()
    .text("Update my answers", "idle:restart")
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
