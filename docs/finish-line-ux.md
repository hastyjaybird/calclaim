# Finish-line UX — v2 living checklist + apply handoff

**Status:** Settled **v2** product contract (2026-07-31)  
**Product version:** CalClaim v2 — California financial aid / benefits navigator  
**Applies to:** Completion after offer cards (all program categories).  
**Design persona:** Someone distracted, tired, wrangling kids, or low working memory. If they cannot see what to do next without re-reading the whole chat, the UX failed.

**Supersedes (retired v1):** In-chat utility form field coach (READY_CHECK → FORM_GUIDE PDF → Question N of M copy-paste for PG&E ESA/CARE). That pattern may return later as an optional deep path for **one** program; it is **not** the v2 finish line.

---

## Job

Get the user from “you might qualify for several kinds of help” to “I have a clear todo list with links and deadlines — and I’ll get nudged” with **almost no thinking**.

We do **not** auto-submit to agencies. We do **not** make energy/PG&E the only finish path.

---

## Hard rules (non-negotiable)

1. **One job per screen** in chat — usually one offer card or one confirm.  
2. **The file is the durable finish line** — next-steps PDF is updated and re-sent after meaningful actions.  
3. **Same button shapes** on every offer: Sign up · Already enrolled · Remind me later · Skip.  
4. **Official apply happens on the official site** — Sign up opens/copies the real URL from corpus.  
5. **No auto-submit** (v2).  
6. **Forgiving STOP / erase** — user can wipe everything.  
7. **Reminders never invent deadlines** — only corpus/session dates.  
8. **Multi-category** — a “finished” demo must not look like a PG&E-only checklist.

---

## Interaction model (canonical v2)

### Phase 1 — Offer → action

User sees one program card (any category). They tap Sign up / Already / Remind / Skip.

### Phase 2 — Living next-steps file

Immediately regenerate and send `calclaim-next-steps.pdf`:

1. Header + timestamp  
2. Already on  
3. To-do list (program, action, link, deadline, status)  
4. Closest deadline callout  
5. Documents to gather (deduped)  
6. Footer: disclaimer + Help / erase / STOP  

Chat stays short; **the file** holds the checklist.

### Phase 3 — End-of-queue report

When no offers remain, send a fuller **benefits report PDF** (qualify / max $ / apply steps / docs) in addition to the latest next-steps file.

### Phase 4 — Reminders

| Trigger | When (America/Los_Angeles) |
|---|---|
| Weekly closest | Tuesday 12:00 |
| T-3 | 3 days before any dated todo at 12:00 |
| T-1 | 1 day before at 12:00 |

Reminder message: closest/due item + deep link or “open your latest next-steps file” + Mark done · Snooze · Help · STOP.

---

## Cognitive-load constraints

| Do | Don’t |
|---|---|
| One offer at a time | Dump 12 programs in one bubble |
| Re-send the file after changes | Expect them to scroll chat history |
| Plain program names + one benefit line | Eligibility essays on the card |
| Same four actions every time | Different CTAs per category |
| Show energy programs as peers | “Now the important PG&E part…” framing |

---

## Sign up handoff

```text
Open the official page (keep Telegram open):
→ {applyUrl from corpus}

We’ve added this to your next-steps file ↓
```

Optional: “Copy link” if needed. Do not dump eligibility prose on this step.

---

## Stuck recovery

Triggers: Help, “I’m lost”, idle re-entry.

```text
No problem. Your latest next-steps file has the list.
Closest deadline: {item} — {date}
Official link: {url}

[ Send my next-steps file again ]
[ Help ]
[ STOP ]
```

Never invent a portal path.

---

## Future (not v2 must-ship): deep field coach

A later version may add, **for a single chosen program**, the retired pattern: open official form → pre-filled answer → Next question. If added:

- It must be **opt-in from a next-steps item**, not the default for all programs.  
- It must not re-center the whole product on PG&E.  
- Contract for that mode would live in a future doc revision.

---

## Demo success for this module

A reviewer who is **not** carefully reading:

1. Completes gate + at least two offer actions across **different categories** (e.g. LifeLine + CARE, or CalFresh + CARE).  
2. Receives an updated next-steps PDF they can open on phone.  
3. Sees deadlines (or honest “check site”) without hunting.  
4. Can STOP and erase.

If the finish-line still feels like “only PG&E links,” it fails the v2 bar in [`guidelines.md`](guidelines.md).

---

## Implementation notes

- `NextSteps` model in DB is source of truth; PDF is the user-facing view.  
- Email is **not** required for v2 finish (Telegram `sendDocument` is enough).  
- Track: file opens; Sign up taps by category; reminder engagement.

---

## Related

- [`customer-experience.md`](customer-experience.md) — v2 tree  
- [`guidelines.md`](guidelines.md) — framing  
- [`../PROMPT.md`](../PROMPT.md) — build kickoff  
