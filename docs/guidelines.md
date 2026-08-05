# CalClaim product guidelines (v2)

**Last updated:** 2026-07-31  
**Product version:** **v2 – California financial aid / benefits navigator**  
These are standing rules for design and build. If a build tradeoff appears, prefer: fewer programs → better completion → clearer next-steps file.

---

## Mission

Reduce **last-mile friction** so eligible households actually **start and track** applications for financial aid and benefits – food, health, cash, telecom, energy bill help, tax credits, and related programs – especially people who get lost after directories and agency websites.

---

## V2 markets (committed)

1. **California** – statewide benefits + bill-assistance programs grounded in a frozen public library.  
2. **Channel:** Telegram.  
3. **Language (ship):** English. Spanish and Puerto Rico locales are **expansion**, not v2 must-ship.

Utility / PG&E programs are **in scope as library rows**, not as the product identity.

---

## Must ship (demo 80%)

1. Telegram bot UX: opt-in, short turns, buttons, Help, STOP.  
2. Triage + offer queues per [`customer-experience.md`](customer-experience.md): gate → YES or NO arm → ranked cards → living next-steps updates.  
3. **Multi-category library** – never ship a demo that only lists energy programs.  
4. Rank by **document reuse** and **time-to-money** (library scores), not “energy first.”  
5. Living Application Guide PDF (one file) re-sent after meaningful actions and at queue end.  
6. Deadline reminders (Tue noon closest; T-3 / T-1 Pacific).  
7. Refuse / escalate when unknown; never invent rules.  
8. Free-form / gibberish QC log behavior (below).  
9. README + demo script + sample Application Guide PDF.

---

## Program framing (critical)

| Correct | Incorrect |
|---|---|
| “Programs you may qualify for” across aid types | “Your PG&E upgrade path” as the whole product |
| CARE / ESA appear beside LifeLine / CalFresh | CARE always primary CTA because it’s energy |
| Official names stay accurate | Claiming partnership with any agency or utility |

Energy bill discounts and free home upgrades are **valuable offers**, not the brand story.

---

## Language rules (v2)

- Ship in **English**.  
- Do not mix in Spanish copy until an ES locale is explicitly built.  
- Keep official program names accurate.

*(Retired v1 rule: full EN + CA-ES + PR-ES as must-ship – deferred to expansion.)*

---

## Safety & honesty

- Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, LUMA, PREPA, Rewiring America, DOE, Anthropic, or other agencies.  
- Not tax, legal, or benefits advice. Estimates only. Agencies decide eligibility.  
- Never invent eligibility, dollar amounts, or deadlines.  
- No sensitive document uploads in v2.  
- Opt-in first message; STOP / erase clears data and reminders.

---

## Free-form / gibberish (developer QC)

If the user types anything that is not a valid control or expected answer for the current step:

1. **Quietly log** to `data/responses.jsonl` and append a row to the developer feedback To Do List (SQLite): timestamp, user id, **step**, raw text (voice transcribed when Whisper is configured), session snapshot. Do not announce the log.  
2. **Reply:** `Thanks for your feedback!` then **repeat the last bot prompt** (same text + buttons).  
3. **Do not** advance conversation state.  
4. Erase/STOP clears that user’s responses-file rows with the rest of their data. Restart/`/start` also clears that user’s next-steps list and developer feedback to-do rows.

---

## Uniqueness bar

| Layer | Typical directory / calculator | CalClaim v2 |
|---|---|---|
| Channel | Web form / static list | **Telegram** thread |
| Job | Eligibility browse | **Queue + living checklist + reminders** |
| Handoff | Link out → maze | Stay in-thread; **file is the durable finish line** |
| Scope | Single silo (e.g. only energy) | **Multi-category financial aid** |

A demo that only lists PG&E links **fails** the v2 bar.

---

## Completion friction bar

The Application Guide PDF and offer cards must work for someone **distracted, tired, or low working memory**:

- One job per screen.  
- Same button shapes on every offer card.  
- Deadlines visible in the file, not buried in chat history.  
- Full contract: [`finish-line-ux.md`](finish-line-ux.md).

*(Retired v1: in-chat utility form field coach as must-ship – **future**, not v2.)*

---

## Non-goals / do not build (v2)

- PG&E-only or energy-only product identity  
- LegalZoom-style auto-filing to agencies  
- National live benefits database maintenance  
- Contractor marketplace  
- Claiming partnership with utilities or Anthropic  
- Open-ended ungrounded Claude inventing eligibility  
- Puerto Rico locale as a v2 ship requirement  
- In-chat multi-field form coach for every agency site  

---

## Tech preferences

- Deterministic ranker over frozen library (required).  
- Claude optional for copy polish later – not required for eligibility truth.  
- Simple stack: Node/TS + grammy + SQLite + PDF + Railway.  

---

## Definition of demo success

A reviewer runs the Telegram path in &lt;10 minutes and ends with a **Application Guide PDF + reminders armed** across **more than one program category** – not a list of utility homepage URLs.
