import type { SessionState, StepId } from "../library/types.js";
import { THANKS_FEEDBACK } from "../privacy/copy.js";
import { GATE_OPTIONS } from "./keyboards.js";

/** What we believe the user meant after normalization + fuzzy matching. */
export type TextIntent =
  | { kind: "command"; command: CommandName }
  | { kind: "greeting" }
  | { kind: "step_answer"; callback: string }
  | { kind: "suggest"; suggestion: CommandName; display: string }
  | { kind: "unknown" };

export type CommandName =
  | "help"
  | "stop"
  | "erase"
  | "start"
  | "restart"
  | "todo"
  | "share"
  | "email";

const COMMAND_ALIASES: Record<CommandName, string[]> = {
  help: [
    "help",
    "hlp",
    "hep",
    "halp",
    "menu",
    "info",
    "options",
    "commands",
    "what",
    "?",
    "more info",
    "moreinfo",
  ],
  stop: [
    "stop",
    "stp",
    "stpo",
    "stopp",
    "quit",
    "cancel",
    "pause",
    "unsubscribe",
    "end",
    "enough",
  ],
  erase: [
    "erase",
    "eras",
    "delete",
    "delet",
    "remove",
    "forget",
    "forget me",
    "clear",
    "clear data",
    "wipe",
  ],
  start: ["start", "strat", "begin", "begin again"],
  restart: [
    "restart",
    "restrat",
    "restar",
    "reset",
    "start over",
    "startover",
    "again",
    "redo",
    "from scratch",
  ],
  share: [
    "share",
    "shar",
    "invite",
    "refer",
    "send link",
    "qr",
    "qr code",
    "share link",
  ],
  email: [
    "email",
    "email me",
    "email report",
    "email my report",
    "mail",
    "send email",
  ],
  todo: [
    "todo",
    "to do",
    "to-do",
    "todoo",
    "list",
    "my list",
    "report",
    "pdf",
    "my todo",
    "my to do",
    "send list",
    "resend",
  ],
};

const YES = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "yup",
  "yea",
  "ya",
  "sure",
  "ok",
  "okay",
  "k",
  "affirmative",
  "true",
  "correct",
  "right",
]);

const NO = new Set([
  "no",
  "n",
  "nope",
  "nah",
  "na",
  "noo",
  "negative",
  "false",
  "wrong",
]);

const GREETINGS = new Set([
  "hi",
  "hello",
  "hey",
  "howdy",
  "yo",
  "hiya",
  "sup",
  "good morning",
  "good afternoon",
  "good evening",
  "morning",
  "afternoon",
  "evening",
  "hola",
  "helo",
  "helllo",
  "hii",
  "hiii",
]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function maxDistanceFor(target: string): number {
  if (target.length <= 3) return 1;
  if (target.length <= 6) return 1;
  return 2;
}

/** Lowercase, strip bot-command suffixes/punctuation, collapse spaces. */
export function normalizeText(raw: string): string {
  let t = raw.trim().toLowerCase();
  // /help@MyBot foo → help foo
  t = t.replace(/^\/([a-z0-9_]+)(?:@\w+)?/i, "$1");
  t = t.replace(/['']/g, "'");
  t = t.replace(/[––]/g, "-");
  // Keep letters, numbers, spaces, apostrophes, hyphens
  t = t.replace(/[^\p{L}\p{N}\s'-]+/gu, " ");
  t = t.replace(/-/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function exactAliasMatch(normalized: string): CommandName | null {
  for (const [command, aliases] of Object.entries(COMMAND_ALIASES) as [
    CommandName,
    string[],
  ][]) {
    for (const alias of aliases) {
      if (normalized === alias) return command;
    }
  }
  return null;
}

function fuzzyAliasMatch(
  normalized: string,
): { command: CommandName; distance: number } | null {
  let best: { command: CommandName; distance: number } | null = null;
  for (const [command, aliases] of Object.entries(COMMAND_ALIASES) as [
    CommandName,
    string[],
  ][]) {
    for (const alias of aliases) {
      // Skip tiny aliases for fuzzy – too many false positives (e.g. "y" vs "n")
      if (alias.length < 3) continue;
      const dist = editDistance(normalized, alias);
      if (dist > maxDistanceFor(alias)) continue;
      if (!best || dist < best.distance) {
        best = { command, distance: dist };
      }
    }
  }
  return best;
}

/** Phrase contains a clear command word (e.g. "please stop", "send my todo"). */
function containsCommand(normalized: string): CommandName | null {
  const words = normalized.split(" ");
  const joined = normalized;

  if (
    /\b(stop|quit|cancel|unsubscribe|pause)\b/.test(joined) &&
    !/\b(don't|dont|do not|never)\b/.test(joined)
  ) {
    return "stop";
  }
  if (/\b(erase|delete|forget|wipe)\b/.test(joined)) return "erase";
  if (/\b(restart|reset|start over)\b/.test(joined)) return "restart";
  if (
    /\b(to do|todo|to-do)\b/.test(joined) ||
    (words.includes("list") &&
      (words.includes("my") || words.includes("send") || words.includes("resend")))
  ) {
    return "todo";
  }
  if (/\b(help|menu|options|commands)\b/.test(joined)) return "help";
  if (
    /\b(share (this|link|calclaim)|invite (a )?(friend|someone)|qr code)\b/.test(
      joined,
    )
  ) {
    return "share";
  }
  if (/\b(email (me|report|my report)|send (by )?email)\b/.test(joined)) {
    return "email";
  }
  if (joined === "start" || /^(please )?start$/.test(joined)) return "start";
  return null;
}

function parseYesNo(normalized: string): "yes" | "no" | null {
  if (YES.has(normalized)) return "yes";
  if (NO.has(normalized)) return "no";
  // "yes please", "no thanks"
  const first = normalized.split(" ")[0] ?? "";
  if (YES.has(first)) return "yes";
  if (NO.has(first)) return "no";
  if (editDistance(normalized, "yes") <= 1 && normalized.length >= 2) return "yes";
  if (editDistance(normalized, "no") <= 0) return "no";
  if (editDistance(normalized, "nope") <= 1) return "no";
  if (editDistance(normalized, "yeah") <= 1) return "yes";
  return null;
}

function parseHouseholdSize(normalized: string): number | null {
  if (/^\d+$/.test(normalized)) {
    const n = Number(normalized);
    if (n >= 1 && n <= 8) return n;
    return null;
  }
  if (WORD_NUMBERS[normalized] != null) return WORD_NUMBERS[normalized]!;
  // "4 people", "family of 3"
  const m = normalized.match(/\b([1-8])\b/);
  if (m) return Number(m[1]);
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (normalized.includes(word)) return n;
  }
  return null;
}

function matchGateProgram(normalized: string): string | null {
  const aliases: Record<string, string[]> = {
    medi_cal: ["medi cal", "medical", "medi-cal", "medicaid", "medi"],
    calfresh: ["calfresh", "cal fresh", "food stamps", "snap", "ebt"],
    ssi: ["ssi", "supplemental security"],
    calworks: ["calworks", "cal works", "tanf", "welfare"],
    capi: [
      "capi",
      "cash assistance program for immigrants",
      "cash assistance for immigrants",
    ],
    ga_gr: [
      "ga/gr",
      "ga gr",
      "general assistance",
      "general relief",
      "general aid",
    ],
    cmsp: [
      "cmsp",
      "county medical services",
      "county medical services program",
    ],
    wic: ["wic"],
  };
  for (const opt of GATE_OPTIONS) {
    const list = aliases[opt.id] ?? [opt.label.toLowerCase()];
    for (const a of list) {
      if (normalized === a || normalized.includes(a)) return opt.id;
      if (a.length >= 3 && editDistance(normalized, a) <= 1) return opt.id;
    }
  }
  return null;
}

function interpretStepAnswer(
  normalized: string,
  session: SessionState,
): TextIntent | null {
  const step: StepId = session.step;
  const yn = parseYesNo(normalized);

  if (step === "opt_in") {
    if (
      yn === "yes" ||
      ["start", "begin", "go", "ready", "ok", "okay", "lets go", "let's go"].includes(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "opt:start" };
    }
  }

  if (step === "confirm_stop" || session.awaitingConfirm === "stop") {
    if (yn === "yes") return { kind: "step_answer", callback: "stop:yes" };
    if (yn === "no") return { kind: "step_answer", callback: "stop:no" };
  }

  if (step === "confirm_erase" || session.awaitingConfirm === "erase") {
    if (yn === "yes") return { kind: "step_answer", callback: "erase:yes" };
    if (yn === "no") return { kind: "step_answer", callback: "erase:no" };
  }

  if (step === "gate") {
    if (["done", "finish", "finished", "next", "continue"].includes(normalized)) {
      return { kind: "step_answer", callback: "gate:done" };
    }
    if (
      ["none", "no", "nope", "nothing", "none of these", "neither"].includes(
        normalized,
      ) ||
      yn === "no"
    ) {
      return { kind: "step_answer", callback: "gate:none" };
    }
    const prog = matchGateProgram(normalized);
    if (prog) return { kind: "step_answer", callback: `gate:toggle:${prog}` };
  }

  if (step === "household_size") {
    const n = parseHouseholdSize(normalized);
    if (n != null) return { kind: "step_answer", callback: `hh:${n}` };
  }

  if (step === "income_band") {
    if (
      /\b(care|low|lowest|less|under|below)\b/.test(normalized) ||
      normalized === "1" ||
      normalized === "a"
    ) {
      return { kind: "step_answer", callback: "income:careBand" };
    }
    if (
      /\b(fera|middle|mid|medium)\b/.test(normalized) ||
      normalized === "2" ||
      normalized === "b"
    ) {
      return { kind: "step_answer", callback: "income:feraBand" };
    }
    if (
      /\b(above|high|higher|more|over)\b/.test(normalized) ||
      normalized === "3" ||
      normalized === "c"
    ) {
      return { kind: "step_answer", callback: "income:aboveFera" };
    }
  }

  if (step === "past_due") {
    if (
      /\b(not (in )?my name|someone else|roommate|landlord)\b/.test(normalized)
    ) {
      return { kind: "step_answer", callback: "pastdue:not_my_name" };
    }
    if (yn === "yes" || /\bpast due\b/.test(normalized)) {
      return { kind: "step_answer", callback: "pastdue:yes" };
    }
    if (yn === "no") return { kind: "step_answer", callback: "pastdue:no" };
  }

  if (step === "has_child") {
    if (yn === "yes" || /\b(kid|kids|child|children|pregnant|pregnancy)\b/.test(normalized)) {
      return { kind: "step_answer", callback: "child:yes" };
    }
    if (yn === "no") return { kind: "step_answer", callback: "child:no" };
  }

  if (step === "has_abd") {
    if (
      yn === "yes" ||
      /\b(65|elderly|senior|disabled|disability|blind|ssi)\b/.test(normalized)
    ) {
      return { kind: "step_answer", callback: "abd:yes" };
    }
    if (yn === "no") return { kind: "step_answer", callback: "abd:no" };
  }

  if (step === "has_work_disruption") {
    if (
      /\b(lost|laid off|layoff|fired|unemployed|job loss|no job)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "work:job_loss" };
    }
    if (
      /\b(sick|ill|illness|injury|injured|pregnant|pregnancy|disability|disabled|can't work|cant work)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "work:health" };
    }
    if (
      /\b(caring|caregiver|caregiving|family care|new baby|bonding|take care)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "work:family_care" };
    }
    if (
      yn === "no" ||
      ["none", "nothing", "none of these", "no change"].includes(normalized)
    ) {
      return { kind: "step_answer", callback: "work:none" };
    }
  }

  if (step === "has_disaster_area") {
    if (
      yn === "yes" ||
      /\b(lived|live|lives|worked|work|works|both|evacuated|my job|my house|my home)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "disaster:yes" };
    }
    if (
      yn === "no" ||
      ["none", "nope", "nothing", "neither", "none of these"].includes(normalized)
    ) {
      return { kind: "step_answer", callback: "disaster:no" };
    }
  }

  if (step === "has_immigration_status") {
    if (
      yn === "yes" ||
      /\b(citizen|citizenship|eligible immigrant|green card|permanent resident|lpr)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "status:eligible" };
    }
    if (
      yn === "no" ||
      /\b(undocumented|not a citizen|non-?citizen|no status)\b/.test(normalized)
    ) {
      return { kind: "step_answer", callback: "status:ineligible" };
    }
    if (
      /\b(prefer not|rather not|skip|private|decline|dont want|don't want|no thanks)\b/.test(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "status:declined" };
    }
  }

  if (step === "has_zip") {
    if (
      ["skip", "not sure", "unsure", "dont know", "don't know", "idk"].includes(
        normalized,
      )
    ) {
      return { kind: "step_answer", callback: "zip:skip" };
    }
    // Digits may still have spaces/dashes before normalize – use raw-ish digits.
    const digits = normalized.replace(/\D/g, "");
    if (digits.length === 5 || digits.length === 9) {
      return { kind: "step_answer", callback: `zip:${digits.slice(0, 5)}` };
    }
  }

  if (step === "offer") {
    const programId = session.queue[session.queueIndex];
    if (!programId) return null;
    if (
      /\b(skip|pass|no thanks|not now|next)\b/.test(normalized) ||
      yn === "no"
    ) {
      return { kind: "step_answer", callback: `offer:skip:${programId}` };
    }
    if (
      /\b(save|sign up|signup|add|todo|to do|interested)\b/.test(normalized) ||
      yn === "yes"
    ) {
      return { kind: "step_answer", callback: `offer:signup:${programId}` };
    }
    if (/\b(already|enrolled|have it|got it|on it)\b/.test(normalized)) {
      return { kind: "step_answer", callback: `offer:already:${programId}` };
    }
    if (/\b(remind|later|snooze)\b/.test(normalized)) {
      return { kind: "step_answer", callback: `offer:remind:${programId}` };
    }
  }

  if (step === "idle") {
    if (/\b(restart|start over|reset)\b/.test(normalized)) {
      return { kind: "step_answer", callback: "idle:restart" };
    }
    if (/\b(share|invite|friend)\b/.test(normalized)) {
      return { kind: "step_answer", callback: "idle:share" };
    }
    if (/\b(email|mail)\b/.test(normalized)) {
      return { kind: "step_answer", callback: "idle:email" };
    }
    if (/\b(more info|help|info|menu)\b/.test(normalized)) {
      return { kind: "step_answer", callback: "idle:more_info" };
    }
    if (
      /\b(list|todo|to do|report|pdf|again|resend|send)\b/.test(normalized)
    ) {
      return { kind: "step_answer", callback: "idle:resend" };
    }
  }

  return null;
}

const COMMAND_DISPLAY: Record<CommandName, string> = {
  help: "help",
  stop: "stop",
  erase: "erase",
  start: "start",
  restart: "restart",
  todo: "to do",
  share: "share",
  email: "email",
};

/**
 * Best-effort intent from free text. Case-insensitive, typo-tolerant,
 * and willing to guess common step answers (yes/no, 1–8, etc.).
 */
export function interpretMessage(
  raw: string,
  session: SessionState,
): TextIntent {
  const normalized = normalizeText(raw);
  if (!normalized) return { kind: "unknown" };

  // On the Start screen, "start"/"begin" means tap Start – not /restart.
  if (session.step === "opt_in") {
    const optInStart = interpretStepAnswer(normalized, session);
    if (optInStart) return optInStart;
  }

  // Exact / alias commands first (including multi-word)
  const exact = exactAliasMatch(normalized);
  if (exact) return { kind: "command", command: exact };

  // Phrase-level command ("please stop reminders")
  const contained = containsCommand(normalized);
  if (contained) return { kind: "command", command: contained };

  // Greetings
  if (GREETINGS.has(normalized) || /^(hi|hey|hello)\b/.test(normalized)) {
    return { kind: "greeting" };
  }

  // Step-aware answers (buttons people might type instead)
  const stepAnswer = interpretStepAnswer(normalized, session);
  if (stepAnswer) return stepAnswer;

  // Fuzzy single-token / short phrase → strong match as command, weak as suggest
  const fuzzy = fuzzyAliasMatch(normalized);
  if (fuzzy) {
    if (fuzzy.distance === 0) {
      return { kind: "command", command: fuzzy.command };
    }
    if (fuzzy.distance === 1 && normalized.length >= 3) {
      return { kind: "command", command: fuzzy.command };
    }
    if (fuzzy.distance === 2 && normalized.length >= 6) {
      return {
        kind: "suggest",
        suggestion: fuzzy.command,
        display: COMMAND_DISPLAY[fuzzy.command],
      };
    }
  }

  return { kind: "unknown" };
}

/** Short, human nudge for the current screen when we didn't understand. */
export function stepNudge(step: StepId): string {
  switch (step) {
    case "opt_in":
      return "Whenever you're ready, tap Start below – or type help for options.";
    case "gate":
      return "Tap any programs you're already on, then Done – or None if none of those.";
    case "household_size":
      return "Tap a number for how many people share money with you (not separate roommates).";
    case "income_band":
      return "Pick the income range that fits best – rough is fine.";
    case "past_due":
      return "Quick yes/no on whether the utility bill is past due (or say the bill isn't in your name).";
    case "has_child":
      return "Tap Yes or No – kids under 18 or pregnancy in the household.";
    case "has_abd":
      return "Tap Yes or No – anyone 65+, blind, or disabled in the household.";
    case "has_work_disruption":
      return "Tap the option that fits – lost a job, can't work for health reasons, caring for family, or none of these.";
    case "has_disaster_area":
      return "Tap Yes or No – did anyone in the household live or work in the disaster area?";
    case "has_immigration_status":
      return "Tap Yes (citizen or eligible immigrant), No, or Prefer not to say – your answer is not stored.";
    case "has_zip":
      return "Type your 5-digit home ZIP code, or tap Skip if you're not sure.";
    case "offer":
      return "Use the buttons – add to your To Do List, say you're already enrolled, or skip.";
    case "idle":
      return "You're all set for now. Restart, share with a friend, email your report to a computer, or more info.";
    case "confirm_stop":
      return "Want me to pause reminders? Tap Yes or No below.";
    case "confirm_erase":
      return "This would delete your CalClaim data. Tap Yes or No below.";
    case "help_menu":
      return "Pick a button below, or type stop, to do, share, restart, or erase.";
    default:
      return "Tap a button below to keep going – or type help if you're stuck.";
  }
}

export function unknownAck(_step: StepId): string {
  return THANKS_FEEDBACK;
}

export function greetingAck(step: StepId): string {
  return `Hey! ${stepNudge(step)}`;
}

export function suggestAck(display: string, step: StepId): string {
  return `Hmm, did you mean "${display}"? You can type that, or: ${stepNudge(step)}`;
}

export function mediaAck(step: StepId): string {
  return `Got that – thanks. I work best with the buttons below. ${stepNudge(step)}`;
}

export function errorAck(): string {
  return "Something hiccuped on my side – sorry about that. Try tapping a button again, or type help.";
}

export function staleCallbackAck(step: StepId): string {
  return `That button looks out of date – no worries. ${stepNudge(step)}`;
}
