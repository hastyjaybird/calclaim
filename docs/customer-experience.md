# Customer experience — v2 benefits queue (complete tree)

**Status:** Settled **v2** build contract (2026-07-31)  
**Product version:** CalClaim v2 — California financial aid / benefits navigator (Telegram)  
**Applies before code:** Implement this tree. Do not invent a PG&E-only funnel.  
**Companion law:** [`finish-line-ux.md`](finish-line-ux.md) for living to-do list / benefits report + reminders.  
**Supersedes:** Retired v1 energy-only triage (language → PG&E zip → CARE-first field coach).

---

## Job

Household opens CalClaim on Telegram → short gate → ranked **financial-aid offers across categories** → each action updates a **living to-do list / benefits report** (one PDF) → end-of-queue re-sends that same file → reminders until they act or STOP.

Energy / utility programs (CARE, FERA, ESA, LIHEAP, AMP, …) are **offers in the queue**, not the product center.

---

## Information effort model

| Bin | When we ask | Examples |
|---|---|---|
| **Memorized / known** | Gate + income band (NO arm) | Already on Medi-Cal/CalFresh/…; rough income × HH band |
| **Look up / official** | Inside to-do list PDF + offer “Sign up” | Account #, award letters, pay stubs — listed in **file**, not a mega triage quiz |
| **Apply** | Official site via Sign up URL | User applies; we do not auto-submit |

**Rules:**
- Triage stays short (opt-in → gate → optional income).  
- Never a mega-checklist of all programs in chat.  
- Docs to gather live in the **to-do list PDF** (deduped union of open todos) as Step 1.

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
| Tax | `tax_credits` |
| Nested employment (not separate offer cards) | CalWORKs → WtW; LA GA/GR → GROW (noted in apply steps) |

**BenefitsCal coverage:** Corpus rows cover every program on [BenefitsCal program descriptions](https://benefitscal.com/Help/program-descriptions/HCPRD?lang=en). `excludeIfAlreadyOn` drops Disaster CalFresh if already on CalFresh, CMSP if already on Medi-Cal, CAPI if already on SSI, and GA/GR if already on CalWORKs/SSI/CAPI.

**Rule:** Ranking never hard-codes “CARE first because energy.” Order = `newDocsCount ASC` → `timeToMoney ASC` → Skip `elimProgramCount DESC` (see plan).

---

## Friction budget (target demo path)

| Metric | Target |
|---|---|
| Taps to first offer card | **2–4** (opt-in → gate → [income if NO] → card) |
| Buttons per offer card | Fixed set: Sign up · Already · Remind later · Skip |
| Docs uploaded in chat | **0** |
| To-do list PDF (= benefits report) | Re-sent after each meaningful action and when queue empties |

---

## Canonical flow (state machine)

```text
START (/start or first message)
  → OPT_IN (disclaimer)
  → GATE (household on Medi-Cal / CalFresh / SSI / CalWORKs / CAPI / GA/GR / CMSP / WIC?)
       ├─ Yes → YES_SEED docsInHand → PAST_DUE → [HAS_CHILD / HAS_ABD if needed] → YES_QUEUE
       └─ No  → NO_SEED docsInHand → INCOME_BAND → PAST_DUE (CARE/FERA band) → [HAS_CHILD / HAS_ABD if needed] → NO_QUEUE
  → OFFER_CARD (loop)
       Sign up | Already enrolled | Remind me later | Skip (| CARE Skip sub-branch)
       → UPDATE to-do list PDF + sendDocument
       → more offers? → next card : re-send same to-do list PDF → ARM_REMINDERS → IDLE
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

Thanks for testing this app! At any time, you can
text or send a voice message describing any issue that comes up or suggest
an improvement ✨

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
| Yes (any program) | `docsInHand`: categoricalProof + photoId + utilityBill → YES_QUEUE |
| None | `docsInHand`: photoId + utilityBill → HOUSEHOLD_SIZE → INCOME_BAND |

### HOUSEHOLD_SIZE (NO arm only)

```text
How many people are in your household?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

Tap a number:
```

### INCOME_BAND (NO arm only)

```text
About how much is your household's total yearly income before taxes?

Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.

Add up income for everyone you just counted.
```

Bands from frozen CARE/FERA-style tables × household size (corpus). Purpose: eliminate / route offers — **not** to center the product on CARE.

| Answer | Next |
|---|---|
| Above FERA | No offer cards → share-with-friend idle (tax card removed) |
| FERA band (per corpus HH rules) | PAST_DUE → [HAS_CHILD / HAS_ABD if needed] → ranked NO queue (FERA + unsigned gate feeders + peers) |
| CARE band | PAST_DUE → [HAS_CHILD / HAS_ABD if needed] → full NO offer queue |

### PAST_DUE (YES arm after gate; NO arm on CARE income band)

```text
Is your utility bill past due?

[ Yes ] [ No ] / bill not in my name
```

Gates AMP only — no parenthetical about “optional program” in the prompt.

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

### OFFER_CARD (every program)

```text
You may qualify for {Program name}.

{Program name} — {one-line plain benefit}
Est. ~{formFillMinutes, discounted if docs already in hand} min to fill out form.
Est. up to ~${max from maxBenefitUsd for household} (max; estimate). Deadline: {label (YYYY-MM-DD) or label-only / “check site”}.
[If timeToMoneyDays ≥ 21:] Docs / numbers you'll likely need: • …

[ I'm already enrolled ]
[ Add to my to do list ]
[ Skip program ]
```

| Control | Logic |
|---|---|
| Add to my to do list | Mark `in_progress` → next offer (apply URL lives in the finish summary + PDF only) |
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

### YES offer order (illustrative — corpus may adjust scores)

| # | Offer | Notes |
|---|---|---|
| 1 | CARE | 0 new docs if categorical — **peer**, not brand |
| 2 | LifeLine | Telecom |
| 3 | CalFresh | Food — if not already on at gate |
| 4 | ESA | Energy upgrades |
| 5 | LIHEAP | Energy bill help |
| 6 | AMP | If past due |
| 7 | Medi-Cal | If not already on at gate |
| 8 | CalWORKs | If kids under 18 / pregnancy |
| … | WIC | If kids under 18 / pregnancy |
| … | SSI / CAPI | If ABD gate yes; CAPI excluded if already on SSI |
| … | GA/GR / CMSP | If not excluded by `excludeIfAlreadyOn` |

**Rule:** Every gate feeder the user did **not** mark at GATE must remain eligible to enter the queue (subject to income / child / ABD / excludeIfAlreadyOn). Ranking = `newDocs ASC` → `timeToMoney ASC` → corpus order — never drop unsigned gate programs by hardcoding a short queue.

### NO offer order (CARE / FERA-band illustrative)

CARE (CARE band) or FERA (FERA band) → LifeLine → ESA → LIHEAP → CalFresh → other unsigned gate feeders (Medi-Cal, GA/GR, CMSP, …) → AMP? → CalWORKs / WIC (if kids) → SSI / CAPI (if ABD).

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
- [ ] To-do list PDF (benefits report) sent after an action  
- [ ] Help / STOP / free-form QC behave per guidelines  
- [ ] Every button on OPT_IN, GATE, INCOME, OFFER maps to a transition above  

---

## Demo path scripts (build QA)

### Path A — YES arm (categorical)

Start → Yes → CARE card → Sign up → to-do list PDF → LifeLine → … → same to-do list PDF at end → reminders armed.

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
