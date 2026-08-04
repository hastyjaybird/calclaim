# Customer experience — v2 benefits queue (complete tree)

**Status:** Settled **v2** build contract (2026-07-31)  
**Product version:** CalClaim v2 — California financial aid / benefits navigator (Telegram)  
**Applies before code:** Implement this tree. Do not invent a PG&E-only funnel.  
**Companion law:** [`finish-line-ux.md`](finish-line-ux.md) for living To Do List / benefits report + reminders.  
**Supersedes:** Retired v1 energy-only triage (language → PG&E zip → CARE-first field coach).

---

## Job

Household opens CalClaim on Telegram → short gate → ranked **financial-aid offers across categories** → each action updates a **living To Do List / benefits report** (one PDF) → end-of-queue re-sends that same file → reminders until they act or STOP.

Energy / utility programs (CARE, FERA, ESA, LIHEAP, AMP, …) are **offers in the queue**, not the product center.

---

## Information effort model

| Bin | When we ask | Examples |
|---|---|---|
| **Memorized / known** | Gate + income band (NO arm) | Already on Medi-Cal/CalFresh/…; rough income × HH band |
| **Look up / official** | Inside To Do List PDF + offer “Sign up” | Account #, award letters, pay stubs — listed in **file**, not a mega triage quiz |
| **Apply** | Official site via Sign up URL | User applies; we do not auto-submit |

**Rules:**
- Triage stays short (opt-in → gate → first offer as soon as possible).  
- Ask income / past-due / child / ABD / work / disaster / ZIP **only when needed to unlock the next offer wave** — never front-load the full quiz.  
- Rank offer waves by fewest remaining triage questions, then `newDocs` → `timeToMoney` inside a wave.  
- Report / PDF lists open programs **easiest → hardest** (requirements-matrix difficulty).  
- Never a mega-checklist of all programs in chat.  
- Docs to gather live in the **To Do List PDF** (deduped union of open todos) as Step 1.

---

## Programs in the v2 tree (multi-category — none silent once offered)

Corpus is source of truth. Every program that enters a user’s queue must resolve to a session status:

| Status | Meaning |
|---|---|
| `QUALIFIED_OFFERED` | Shown as a card (may still Skip) |
| `SIGN_UP` / `IN_PROGRESS` | User tapped Sign up |
| `ALREADY_ENROLLED` | User says they’re on it |
| `SNOOZED` | Remind me later |
| `SKIPPED` | User skipped (plus any cascade) |
| `NOT_IN_QUEUE` | Eliminated by gate/income/cascades — not shown |

### Illustrative corpus clusters (not energy-privileged)

| Cluster | Program IDs (examples) |
|---|---|
| Gate feeders / categorical | `medi_cal`, `calfresh`, `ssi`, `calworks`, `capi`, `ga_gr`, `cmsp`, `wic` |
| BenefitsCal food/health/cash | `calfresh`, `disaster_calfresh`, `medi_cal`, `cmsp`, `calworks`, `ga_gr`, `capi` |
| Telecom | `lifeline` |
| Energy / bill help | `care`, `fera`, `esa`, `liheap`, `amp`, `medical_baseline` |
| Wage-replacement insurance (EDD, gated by `workDisruption`) | `unemployment` (job loss), `sdi` (illness/injury/pregnancy), `pfl` (family care/bonding) |
| Cash aid, ABD-gated | `ihss` (paid caregiver hours, alongside SSI/CAPI) |
| Tax | `tax_credits` (info-only, never enters queue), `caleitc`, `young_child_tax_credit` |
| Nested employment (not separate offer cards) | CalWORKs → WtW; LA GA/GR → GROW (noted in apply steps) |

**BenefitsCal coverage:** Corpus rows cover every program on [BenefitsCal program descriptions](https://benefitscal.com/Help/program-descriptions/HCPRD?lang=en). `excludeIfAlreadyOn` drops Disaster CalFresh if already on CalFresh, CMSP if already on Medi-Cal, CAPI if already on SSI, and GA/GR if already on CalWORKs/SSI/CAPI.

**Rule:** Ranking never hard-codes “CARE first because energy.” Offer waves = fewest remaining triage questions first; inside a wave = `newDocsCount ASC` → `timeToMoney ASC` → Skip `elimProgramCount DESC`. Report order = difficulty tier / score ASC.

---

## Friction budget (target demo path)

| Metric | Target |
|---|---|
| Taps to first offer card | **2–3** (opt-in → gate → card; income/past-due deferred) |
| Buttons per offer card | Fixed set: Sign up · Already · Remind later · Skip |
| Docs uploaded in chat | **0** |
| To Do List PDF (= benefits report) | Re-sent after each meaningful action and when queue empties |

---

## Canonical flow (state machine)

```text
START (/start or first message)
  → OPT_IN (disclaimer)
  → GATE (household on Medi-Cal / CalFresh / SSI / CalWORKs / CAPI / GA / CMSP / WIC?)
       ├─ Yes → YES_SEED docsInHand → OFFER waves (0-question programs first)
       └─ No  → NO_SEED docsInHand → OFFER waves (0-question programs first; income later)
  → OFFER_CARD (loop)
       Sign up | Already enrolled | Remind me later | Skip (| CARE Skip sub-branch)
       → UPDATE To Do List PDF + sendDocument
       → more in this wave? → next card
       → else ask next cheapest gate (income / past_due / child / ABD / work / disaster / ZIP) if it unlocks more → new wave
       → else re-send To Do List PDF → ARM_REMINDERS → IDLE
  → IDLE: Help | STOP | reminder callbacks | /start (confirm if active)

GLOBAL anytime: Help | STOP | free-form QC fallback
```

### Dropped from retired v1 (on purpose)

| Former v1 input | Disposition |
|---|---|
| Language → CA-ES / PR-ES must-ship | **Deferred** (v2 English) |
| PG&E zip / pueblo locale as first gate | **Removed as product center**; territory may appear later inside energy offer copy if needed |
| Household size / tenure / urgency as long triage | **Only as needed** for income bands / corpus rules |
| CARE-first RESULTS screen | **Replaced** by doc-reuse offer queue |
| READY_CHECK → FORM_GUIDE → field coach | **Replaced** by living next-steps file + Sign up URL (field coach = future) |

---

## Screens (each control has logic)

### OPT_IN

```text
CalClaim helps you find California benefits and bill help —
food, health, phone discounts, energy bill programs, tax credits, and more.
Estimates only. Not affiliated with any agency or utility.

At any time, you can text or send a voice message describing any issue
that comes up or suggest an improvement ✨

Type 'help' for more options.

[ Start ]
```

| Control | Logic |
|---|---|
| Start | → GATE |
| Free-form text / voice | Store as developer feedback todo (+ QC log; voice transcribed when configured) → “Thanks for your feedback!” → repeat last prompt; no advance |

### GATE

```text
Is anyone in your household already on any of these?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

[ tap programs… ] [ Done ] / [ None ]
```

| Control | Logic |
|---|---|
| Yes (any program) | `docsInHand`: categoricalProof + photoId + utilityBill → offer wave (0-question programs) |
| None | `docsInHand`: photoId + utilityBill → offer wave (0-question programs; household/income when needed) |

### HOUSEHOLD_SIZE (NO arm, only when income-gated programs are next)

```text
How many people are in your household?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

Tap a number:
```

### INCOME_BAND (NO arm, after household size when needed)

```text
About how much is your household's total yearly income before taxes?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

Add up income for everyone you just counted.
```

Bands from frozen CARE/FERA-style tables × household size (corpus). Purpose: eliminate / route offers — **not** to center the product on CARE.

| Answer | Next |
|---|---|
| Above FERA | Drop income-gated offers; continue other waves / gates |
| FERA band (per corpus HH rules) | Append newly eligible programs; continue waves |
| CARE band | Append newly eligible programs; continue waves |

Asked only when the next unlockable programs need an income band (NO arm) — after any zero-question offers (LifeLine, LIHEAP, …) so a dropout still heard about at least one program.

### PAST_DUE (when AMP would be the next unlock)

```text
Is your utility bill past due?

[ Yes ] [ No ] / bill not in my name
```

Gates AMP only — asked in the offer loop when past-due is the cheapest remaining gate, not right after the gate.

### HAS_CHILD (only if a `requiresChildInHousehold` program would enter the queue)

```text
Any kids under 18 (or a pregnancy) in the household?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

[ Yes ] [ No ]
```

| Control | Logic |
|---|---|
| Yes | `hasChildInHousehold=true` → include CalWORKs / WIC (if otherwise eligible) |
| No | Drop programs with `requiresChildInHousehold` (`NOT_IN_QUEUE`) |

Same pattern as past-due for AMP: ask once, only when it gates an optional offer — not as a global early quiz.

### HAS_ABD (only if a `requiresAgedBlindOrDisabled` program would enter the queue)

```text
Is anyone in the household 65 or older, blind, or disabled?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

[ Yes ] [ No ]
```

| Control | Logic |
|---|---|
| Yes | `hasAgedBlindOrDisabled=true` → include SSI / CAPI (if otherwise eligible and not already on) |
| No | Drop programs with `requiresAgedBlindOrDisabled` (`NOT_IN_QUEUE`) |

Asked after HAS_CHILD when needed. Gate feeders the household is **not** already on must still be assessable via these optional gates + the ranked offer queue (never silently omitted).

### HAS_WORK_DISRUPTION (only if `unemployment` / `sdi` / `pfl` would otherwise enter the queue)

```text
Has anything affected your ability to work in the last few months?

[ Lost my job ]
[ Can't work — illness, injury, or pregnancy ]
[ Caring for a sick family member / new baby ]
[ None of these ]
```

| Control | Logic |
|---|---|
| Lost my job | `workDisruption="job_loss"` → include `unemployment` (if otherwise eligible) |
| Illness/injury/pregnancy | `workDisruption="health"` → include `sdi` |
| Family care/bonding | `workDisruption="family_care"` → include `pfl` |
| None of these | `workDisruption="none"` → drop all three (`NOT_IN_QUEUE`) |

Single-select — `unemployment`/`sdi`/`pfl` are mutually exclusive by construction (each requires a different answer), matching how EDD itself treats these as separate claim types. Asked after HAS_ABD, same "only when it gates an offer" pattern as past-due/child/ABD.

### HAS_ZIP (only if a `requiresCmspCounty` program would enter the queue)

```text
What's your home ZIP code? (5 digits — used only to check county-specific programs.)

[ Skip — not sure ]
```

| Control | Logic |
|---|---|
| 5-digit CA ZIP | Resolve county → include CMSP only if county is one of the 35 participating CMSP counties |
| Skip / unknown ZIP | Drop CMSP (`NOT_IN_QUEUE`) |

Asked in the offer loop when it is the cheapest remaining gate for still-unlockable programs (same pattern as past-due / child / ABD — not an early quiz).

### OFFER_CARD (every program)

```text
You may qualify for {Program name}.

{Program name} — {one-line plain benefit}
Est. ~{formFillMinutes, discounted if docs already in hand} min to fill out form.
Est. up to ~${max from maxBenefitUsd for this household} (~$/person when size>1). Deadline: {label (YYYY-MM-DD) or label-only / “check site”}.
[If timeToMoneyDays ≥ 21:] Docs / numbers you'll likely need: • …

[ I'm already enrolled ]
[ Add to my To Do List ]
[ Skip program ]
```

| Control | Logic |
|---|---|
| Add to my To Do List | Mark `in_progress` → next offer (apply URL lives in the finish summary + PDF only) |
| Already enrolled | Mark done → next offer |
| Skip program | Apply skip cascade if any → next offer |
| Help / STOP | Global handlers |

**No “Open apply page now” on the card** — outbound links during the queue caused drop-off.

**CARE Skip sub-branch** (when user Skips CARE — CARE is still just one program):

| Reason | Effect (corpus-defined) |
|---|---|
| Not my bill | Drop CARE + related bill programs per cascade |
| Not interested | Drop CARE only; keep ESA if in queue |
| Remind me later | Snooze CARE |

### Offer waves (fewest triage questions first)

| Wave | Examples | Extra questions before this wave |
|---|---|---|
| 0 | LifeLine, LIHEAP, Medical Baseline, CalEITC; on YES also CARE/ESA/unsigned gate feeders (income skipped) | None after gate |
| 1 | AMP; unemployment / SDI / PFL; disaster CalFresh; CMSP (ZIP) | One of: past-due, work, disaster, ZIP |
| 2+ | NO-arm Medi-Cal / CalFresh / CARE / FERA (household + income); then WIC / CalWORKs (child); SSI / CAPI / IHSS (ABD) | Income block, then child / ABD as needed |

Inside a wave: `newDocs ASC` → `timeToMoney ASC` → corpus order.  
On the report / PDF: open programs sorted **easy → hard** via `programDifficulty`.

**Rule:** Every gate feeder the user did **not** mark at GATE must remain eligible to enter a later wave (subject to income / child / ABD / excludeIfAlreadyOn). Never drop unsigned gate programs by hardcoding a short queue.

### NO arm note

Zero-question programs (LifeLine, LIHEAP, …) are offered **before** household/income so a dropout still heard about at least one match. Income-gated programs wait for the income wave.

---

## Finish (end of offer queue)

**If open to-do items exist:**
1. Abbreviated text summary — total $ this year · docs that unlock $ · program list with signup URLs  
2. Send `calclaim-todo-list.pdf`  
3. Auto-prompt email-to-computer (Mail app + 7-day download link). Idle: Email · Share · Restart · More info

**If no open to-do items:** do **not** generate a report. Push share-with-a-friend. Idle without Email.

PDF contents: first line total (“You may qualify for a total of ~$X this year”) · **Step 1 find your docs** · **Step 2 open applications** (program, est. minutes, clickable link, deadline, status) · closest deadline · already on · disclaimer.  
Filename: `calclaim-todo-list.pdf`.

---

## Completeness verification checklist (must pass before ship)

- [ ] Opt-in names **multiple aid categories**, not “PG&E upgrades” alone  
- [ ] Gate is categorical benefits, not zip→PG&E  
- [ ] Queue includes **non-energy** programs (e.g. LifeLine and/or CalFresh) in the demo path  
- [ ] CARE/ESA appear as normal cards, not a separate product mode  
- [ ] Ranking uses corpus scores (doc reuse / time-to-money), not hard-coded energy-first  
- [ ] To Do List PDF (benefits report) sent after an action  
- [ ] Help / STOP / free-form QC behave per guidelines  
- [ ] Every button on OPT_IN, GATE, INCOME, OFFER maps to a transition above  

---

## Demo path scripts (build QA)

### Path A — YES arm (categorical)

Start → Yes → CARE card → Sign up → To Do List PDF → LifeLine → … → same To Do List PDF at end → reminders armed.

### Path B — NO arm, CARE band

Start → No → CARE-band income → CARE → … → includes at least one non-energy offer before end.

### Path C — STOP

Any screen → STOP → confirm → wipe → goodbye.

### Path D — Free-form

On GATE type “asdf” → thanks/redirect; still on GATE; row in `data/responses.jsonl`.

---

## Implementation notes

- Session: user id, branch (YES/NO), answers, offer queue cursor, `NextSteps` items, reminder flags.  
- Frozen corpus holds programs across categories + FPL/band tables + cascades + sources.  
- Unlock/$ copy is estimate / upper bound only.  
- Analytics: public funder dashboard at `/impact` — see [`funder-dashboard.md`](funder-dashboard.md).

---

## Related

- [`finish-line-ux.md`](finish-line-ux.md) — files + reminders  
- [`guidelines.md`](guidelines.md) — v2 safety + framing  
- [`../PROMPT.md`](../PROMPT.md) — build kickoff  
- Cursor plan: Telegram PDF benefits bot  
