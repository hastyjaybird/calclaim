# Customer experience — v2 benefits queue (complete tree)

**Status:** Settled **v2** build contract (2026-07-31)  
**Product version:** CalClaim v2 — California financial aid / benefits navigator (Telegram)  
**Applies before code:** Implement this tree. Do not invent a PG&E-only funnel.  
**Companion law:** [`finish-line-ux.md`](finish-line-ux.md) for living next-steps file + reminders.  
**Supersedes:** Retired v1 energy-only triage (language → PG&E zip → CARE-first field coach).

---

## Job

Household opens CalClaim on Telegram → short gate → ranked **financial-aid offers across categories** → each action updates a **living next-steps file** (todos + deadlines) → end-of-queue benefits report → reminders until they act or STOP.

Energy / utility programs (CARE, FERA, ESA, LIHEAP, AMP, …) are **offers in the queue**, not the product center.

---

## Information effort model

| Bin | When we ask | Examples |
|---|---|---|
| **Memorized / known** | Gate + income band (NO arm) | Already on Medi-Cal/CalFresh/…; rough income × HH band |
| **Look up / official** | Inside next-steps file + offer “Sign up” | Account #, award letters, pay stubs — listed in **file**, not a mega triage quiz |
| **Apply** | Official site via Sign up URL | User applies; we do not auto-submit |

**Rules:**
- Triage stays short (opt-in → gate → optional income).  
- Never a mega-checklist of all programs in chat.  
- Docs to gather live in the **next-steps file** (deduped union of open todos).

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
| Gate feeders / categorical | `medi_cal`, `calfresh`, `ssi`, `calworks`, `wic` |
| Telecom | `lifeline` |
| Energy / bill help | `care`, `fera`, `esa`, `liheap`, `amp`, `medical_baseline` |
| Tax | `tax_credits` |
| Other cash/food | Additional rows only with frozen rules |

**Rule:** Ranking never hard-codes “CARE first because energy.” Order = `newDocsCount ASC` → `timeToMoney ASC` → Skip `elimProgramCount DESC` (see plan).

---

## Friction budget (target demo path)

| Metric | Target |
|---|---|
| Taps to first offer card | **2–4** (opt-in → gate → [income if NO] → card) |
| Buttons per offer card | Fixed set: Sign up · Already · Remind later · Skip |
| Docs uploaded in chat | **0** |
| Next-steps PDF | Re-sent after each meaningful action |
| Final report PDF | Once when queue empties |

---

## Canonical flow (state machine)

```text
START (/start or first message)
  → OPT_IN (disclaimer)
  → GATE (household on Medi-Cal / CalFresh / SSI / CalWORKs / WIC?)
       ├─ Yes → YES_SEED docsInHand → YES_QUEUE
       └─ No  → NO_SEED docsInHand → INCOME_BAND → NO_QUEUE or tax-only
  → OFFER_CARD (loop)
       Sign up | Already enrolled | Remind me later | Skip (| CARE Skip sub-branch)
       → UPDATE next-steps file + sendDocument
       → more offers? → next card : FINAL_REPORT PDF → ARM_REMINDERS → IDLE
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

[ Start ]
```

| Control | Logic |
|---|---|
| Start | → GATE |
| Gibberish | QC log + thanks; no advance |

### GATE

```text
Is anyone in your household already on Medi-Cal, CalFresh, SSI, CalWORKs, or WIC?

[ Yes ]
[ No ]
```

| Control | Logic |
|---|---|
| Yes | `docsInHand`: categoricalProof + photoId + utilityBill → YES_QUEUE |
| No | `docsInHand`: photoId + utilityBill → INCOME_BAND |

### INCOME_BAND (NO arm only)

Bands from frozen CARE/FERA-style tables × household size (corpus). Purpose: eliminate / route offers — **not** to center the product on CARE.

| Answer | Next |
|---|---|
| Above FERA | Tax-credits card only → files |
| FERA band (per corpus HH rules) | FERA → tax → files |
| CARE band | Full NO offer queue |

### OFFER_CARD (every program)

```text
{Program name} — {one-line plain benefit}
Est. {maxBenefit} (estimate). Deadline: {deadline or “check site”}.

[ Sign up ]
[ Already enrolled ]
[ Remind me later ]
[ Skip ]
```

| Control | Logic |
|---|---|
| Sign up | Open/apply URL + mark `in_progress` → update+send next-steps |
| Already enrolled | Mark done → update+send |
| Remind me later | Snooze → update+send |
| Skip | Apply skip cascade if any → update+send → next offer |
| Help / STOP | Global handlers |

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
| 3 | CalFresh | Food |
| 4 | ESA | Energy upgrades |
| 5 | LIHEAP | Energy bill help |
| 6 | AMP | If past due |
| 7 | Tax credits | Higher friction |
| 8 | CalWORKs | Higher friction |

### NO offer order (CARE-band illustrative)

CARE → FERA (if band) → LifeLine → ESA → LIHEAP → CalFresh → AMP? → tax → CalWORKs.

---

## Living next-steps file (required after actions)

Regenerate + `sendDocument` after: Sign up, Already enrolled, Remind later, Skip (+ CARE reason), income-band selection, and when queue completes (also send full report).

Contents: header · already on · todo list (program, action, link, deadline, status) · closest deadline · docs to gather · disclaimer footer.  
Filename: `calclaim-next-steps.pdf`.

---

## Completeness verification checklist (must pass before ship)

- [ ] Opt-in names **multiple aid categories**, not “PG&E upgrades” alone  
- [ ] Gate is categorical benefits, not zip→PG&E  
- [ ] Queue includes **non-energy** programs (e.g. LifeLine and/or CalFresh) in the demo path  
- [ ] CARE/ESA appear as normal cards, not a separate product mode  
- [ ] Ranking uses corpus scores (doc reuse / time-to-money), not hard-coded energy-first  
- [ ] Next-steps PDF sent after an action  
- [ ] Help / STOP / free-form QC behave per guidelines  
- [ ] Every button on OPT_IN, GATE, INCOME, OFFER maps to a transition above  

---

## Demo path scripts (build QA)

### Path A — YES arm (categorical)

Start → Yes → CARE card → Sign up → next-steps PDF → LifeLine → … → final report → reminders armed.

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
- Analytics (demo): taps to first Sign up; category mix of completed todos; reminder open rate.

---

## Related

- [`finish-line-ux.md`](finish-line-ux.md) — files + reminders  
- [`guidelines.md`](guidelines.md) — v2 safety + framing  
- [`../PROMPT.md`](../PROMPT.md) — build kickoff  
- Cursor plan: Telegram PDF benefits bot  
