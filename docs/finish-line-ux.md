# Finish-line UX – v2 living checklist + apply handoff

**Status:** Settled **v2** product contract (2026-07-31)  
**Product version:** CalClaim v2 – California financial aid / benefits navigator  
**Applies to:** Completion after offer cards (all program categories).  
**Design persona:** Someone distracted, tired, wrangling kids, or low working memory. If they cannot see what to do next without re-reading the whole chat, the UX failed.

**Supersedes (retired v1):** In-chat utility form field coach (READY_CHECK → FORM_GUIDE PDF → Question N of M copy-paste for PG&E ESA/CARE). That pattern may return later as an optional deep path for **one** program; it is **not** the v2 finish line.

---

## Job

Get the user from “you might qualify for several kinds of help” to “I have a clear Application Guide with links and deadlines – and I’ll get nudged” with **almost no thinking**.

We do **not** auto-submit to agencies. We do **not** make energy/PG&E the only finish path.

---

## Hard rules (non-negotiable)

1. **One job per screen** in chat – usually one offer card or one confirm.  
2. **The file is the durable finish line** – one Application Guide PDF is updated and re-sent after meaningful actions.  
3. **Same button shapes** on every offer: Add to My Application Guide · I'm already enrolled · Skip program · and, once the Application Guide has at least one open item, **Exit & print My Application Guide now**.  
4. **Official apply links and documents needed live in the Application Guide PDF** (clickable URLs, e.g. “Apply via PG&E”) – not on offer cards (keeps people in chat until they are through the list).  
5. **No auto-submit** (v2).  
6. **Forgiving STOP / erase** – user can wipe everything.  
7. **Reminders never invent deadlines** – only library/session dates.  
8. **Multi-category** – a “finished” demo must not look like a PG&E-only checklist.
9. **Early exit** – tapping exit-and-print ends the offer queue and runs the same finish path as end-of-queue.

---

## Interaction model (canonical v2)

### Phase 1 – Offer → action

User sees one program card (any category). They tap Add to My Application Guide / Already enrolled / Skip program. Once the guide has an open item, later cards also offer **Exit & print My Application Guide now** to leave early and get the PDF.

### Phase 2 – Finish summary + living Application Guide

When the queue ends **and** there is at least one open to-do:

1. Abbreviated chat summary (total $, docs → $, apply-now programs, and a short pointer at the PDF’s tax-preparer box when tax-season credits are on the guide)  
2. Send `calclaim-application-guide.pdf` (caption: “Click to download your Application Guide”):
   - Header + “You may qualify for a total of ~$X this year”  
   - **Step 1 – Find your documents** (deduped, with est. $ unlocked)  
   - **Step 2 – Apply now** (programs you can submit today; full official URL, clickable)  
   - **For your tax preparer** (boxed handout, only when the guide has tax-season credits – print and give to VITA, a paid preparer, or software; claim on the return, not applications to submit today. Premium Tax Credit / Covered CA stays in Step 2.)  
   - Closest deadline · Already on · disclaimer  

If there are **no** open to-dos: skip the guide; nudge share-with-a-friend.

After the PDF: auto-prompt email-to-computer (Send link to my email). Idle actions: Email Application Guide to my computer · Share · Restart · More info.

### Phase 3 – Reminders

| Trigger | When (America/Los_Angeles) |
|---|---|
| Weekly closest | Tuesday 12:00 |
| T-3 | 3 days before any dated todo at 12:00 |
| T-1 | 1 day before at 12:00 |

Reminder message: closest/due item + deep link or “open your latest Application Guide” + Mark done · Snooze · Help · STOP.

---

## Cognitive-load constraints

| Do | Don’t |
|---|---|
| One offer at a time | Dump 12 programs in one bubble |
| Re-send the same to-do / report file after changes | Expect them to scroll chat history · ship a second “final report” PDF |
| Plain program names + one benefit line | Eligibility essays on the card |
| Same four actions every time | Different CTAs per category |
| Show energy programs as peers | “Now the important PG&E part…” framing |

---

## Add-to-list handoff

Stay in chat. Ack briefly (“Added to your Application Guide.”) and advance. Official URLs appear in the Application Guide PDF after they finish the list (or exit early to print).

---

## Stuck recovery

Triggers: Help, “I’m lost”, idle re-entry / More info.

```text
[ Email Application Guide to my computer ]   ← only if open to-dos exist (primary)
[ Share CalClaim with friends ]
[ Restart ]
[ More info ]         ← help menu
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
2. Receives an updated Application Guide PDF they can open on phone.  
3. Sees deadlines (or honest “check site”) without hunting.  
4. Can STOP and erase.

If the finish-line still feels like “only PG&E links,” it fails the v2 bar in [`guidelines.md`](guidelines.md).

---

## Implementation notes

- `NextSteps` model in DB is source of truth; PDF is the user-facing Application Guide.  
- Phone → computer: finish auto-prompts email handoff. One tap opens a short-lived page that auto-launches Mail with a 7-day PDF download link (phones can’t attach files to `mailto:`; Telegram URL buttons can’t be `mailto:`). No Telegram Desktop assumption.  
- Track: file opens; Add-to-list taps by category; reminder engagement.

---

## Related

- [`customer-experience.md`](customer-experience.md) – v2 tree  
- [`guidelines.md`](guidelines.md) – framing  
- [`../PROMPT.md`](../PROMPT.md) – build kickoff  
