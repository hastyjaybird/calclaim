# Session log — CalClaim planning

**Session date:** 2026-07-30 · **v2 pivot:** 2026-07-31 · **brand lock:** 2026-07-31  
**Workspace context:** Portfolio Anthropic BD research + new project bootstrap  
**Working name evolution:** DoneWatt → NowWatt → **CalClaim**  
**Product version:** **v2 — California financial aid / benefits navigator** (Telegram). v1 energy/PG&E-centered concept is retired as the product center.

This log captures the planning conversation so future agents/chats do not re-litigate settled decisions without new evidence.

---

## Turn 1 — Landscape + 10 demos

**User asked:**  
1) Review BD / Gates / partner / nonprofit projects.  
2) Study tech platforms from a user POV (SMS + other mechanisms).  
3) Propose 10 demos inspired by Jay’s work for BD nonprofits resume.

**Outcome:**  
Mapped BD verticals, Claude for Nonprofits, Claude Corps, Gates $200M, MyFriendBen, Sage, Signpost, CfA, Farmer.Chat-style agri, MCP connectors, etc. Proposed 10 demos. Recommended starting with MyFriendBen-shaped + Signpost HITL patterns; avoid another ClimateDash-style research agent.

---

## Turn 2 — Critique of two lean-ins

**User leaned:**  
1) EE equipment assess + incentives / savings; utilities/PUC engagement?  
2) Finance-stacking LegalZoom for renewables; money left on table?

**Also asked:** Pain significant? Public data available? 80% in &lt;2 months given prior app velocity?

**Outcome:**  
- EE path: real pain + engagement gap; Rewiring America incumbent; public data partial (Rewiring API / ENERGY STAR / fragile stacking).  
- Finance stacking: not largest RE bottleneck (interconnection is); LegalZoom submit out of scope; many “unspent” narratives are launch lag or oversubscription.  
- Velocity: Dashbird ~5 days to stable personal app; ClimateDash months; 2-month demo OK if narrowly scoped.  
- Recommendation: hybrid later; for uniqueness, lean finish-line over calculator.

---

## Turn 3 — WhatsApp/text + Spanish uniqueness

**User:** Would WhatsApp/text + form help + Spanish be unique enough? Got lost from Rewiring America → PG&E. Is friction reduction enough for a demo?

**Outcome:**  
Yes for a demo if the path ends in a filled packet. Spanish alone insufficient (RA/PG&E have ES pages). Wedge = **channel + completion**. No auto-submit to PG&E in v1.

---

## Turn 4 — Naming

**Suggestions:** PasoWatt → DoneWatt → user asked English memorable → DoneWatt; later working name set to **CalClaim**.

---

## Turn 5 — Build prompt

**User:** Create a kickoff prompt; include Spanish/English and Puerto Rican Spanish.

**Outcome:** Prompt written (originally under portfolio `products/demos/donewatt/PROMPT.md`). Requirements: bilingual, PR Spanish mode, frozen corpus, finish-line, demo bar.

---

## Turn 6 — 50-state / territory prioritization

**User:** Where would awareness + reduced friction make biggest impact? Which programs most underspent?

**Outcome:**  
- Split underspend vs friction impact.  
- Largest idle IRA $: TX, FL, OH, etc. (often unlaunched).  
- Best friction markets now: CA, NY, AZ/NM/CO, and PR.  
- Program types: utility LI EE + bill discounts first; IRA when live; WAP partial; LIHEAP companion.

---

## Turn 7 — Commit CA + PR; create CalClaim project

**User:** Do California and Puerto Rico; keep expansion watchlist with aging/reassess rule; create top-level `jayprograms/calclaim`; save sessions, guidelines, reasoning, suggestions, Anthropic/BD design rationale.

**Outcome:** This repo. Settled decisions below.

---

## Turn 8 — Competitive UX research (parked)

**User:** Preliminary research on competitive projects (UX + success); walk CX before implementation; then later 500-user / security — one step at a time. Then: save as a plan; merge multiple ideas before build.

**Outcome:** Step 1 research written to [`competitive-ux-research.md`](competitive-ux-research.md). Parked — not signed off as final, not proceeding to scale/security or build until ideas are merged.

---

## Turn 9 — Zero-friction enrollment UX

**User:** Make the enrollment / form-fill trigger as easy as possible — “click this link → for each question review/fill this info → Next questions.” Design for people who are drinking, high, distracted with kids, or hungry. Serious about zero friction.

**Outcome:** Settled finish-line contract in [`finish-line-ux.md`](finish-line-ux.md). Pattern: open official form once → one pre-filled answer card at a time → same **Next question** CTA → docs checklist → done. No re-interview mid-form. Wired into `PROMPT.md`, `guidelines.md`, competitive research, README.

---

## Turn 10 — Use my location

**User:** Use my location as long as it saves one click.

**Outcome:** Offer share-location for **zip/locale triage only** when it replaces typing. Never GPS→bill street address. Ambiguous reverse-geocode falls back to type-in — no confirm step that eats the saved click. Wired into `guidelines.md`, `PROMPT.md`, `finish-line-ux.md`.

---

## Turn 11 — Free-form / gibberish QC log

**User:** If they type gibberish or any free-form response, quietly log it in a responses file (question they were on + their data) for developer QC; reply “thanks for your feedback, please select above or type Help.”

**Outcome:** Settled. Unrecognized text → append `data/responses.jsonl` (step + session snapshot) without announcing the log; reply `Thanks for your feedback. Please select above or type Help.`; do not advance state. Erase/STOP clears that user’s rows. Wired into `guidelines.md` and Telegram bot plan.

---

## Turn 12 — End-to-end CX audit + optimize (2026-07-31)

**User:** Walk entire customer experience; fix what doesn’t make sense; count clicks/docs/elimination; reorder for least friction / fastest wins; ensure complete tree with terminal per program; re-review; check every button has logic; check nothing is missed without user input; say when ready to build.

**Outcome:** Spec-only repo had no runnable tree. Wrote [`customer-experience.md`](customer-experience.md) as build contract after two optimization passes:

1. **Dropped** urgency (no branching). **Added** household size + gated already-enrolled.  
2. **CARE + FERA** enter the must-ship tree (shared PG&E form = one finish-line).  
3. **Auto-EVAL** every in-locale program → `QUALIFIED` / `NOT_QUALIFIED` / `SKIPPED` / `ALREADY_ENROLLED` — nothing silent.  
4. **Rank** CARE/FERA before ESA before rebate before 25C.  
5. Fold recommend+match into RESULTS (0 ack taps). Target **7–8 taps to form open**; docs checklist 2–3 per active path only.  
6. Button-transition table + QA paths A–D documented.

Wired into `guidelines.md`, `PROMPT.md`, README, competitive research target path.

**Ready to build:** Yes — after this contract; implement vertical slice against `customer-experience.md` + `finish-line-ux.md`.

---

## Turn 13 — FORM_GUIDE PDF before form URL (2026-07-31)

**User:** After qualify + documents confirmed, before the form URL: give a how-to PDF (what they’ll need + how to fill). Buttons: open on mobile, or send to email (user types address → PDF emailed for laptop).

**Outcome:** Inserted **FORM_GUIDE** between READY_CHECK “I have them” and Finish Phase A. Path: READY_CHECK → FORM_GUIDE → (Open on mobile | Email me → EMAIL_CAPTURE → send) → FORM_GUIDE_DONE → Phase A form URL. Email is send-only for the guide (no marketing). Wired into `customer-experience.md`, `finish-line-ux.md`, `guidelines.md`, `PROMPT.md`. Taps to form open now **9–12**.

> **Note (v2):** Turns 9–13 describe the **retired v1 energy finish-line**. Kept for history. Do not implement as the main product.

---

## Turn 14 — v2 pivot: all financial aid, not PG&E-only (2026-07-31)

**User:** Be careful — we completely pivoted. App is for **all financial aid services**, not just PG&E. Rebrand. Go through all docs and the plan; PG&E/energy should be **one program cluster in the list**. Make clear we are on **version 2**.

**Outcome:** Full docs rebrand to **CalClaim v2**:

- Product = CA multi-category benefits navigator on **Telegram** (gate → YES/NO queues → living next-steps PDF → reminders).  
- CARE / FERA / ESA / LIHEAP / AMP = **peer offers**, not product center or hard-coded rank privilege.  
- Retired as must-ship: PG&E-first triage, CARE-first RESULTS, in-chat field coach, PR Spanish locale.  
- Rewrote README, PROMPT, guidelines, customer-experience, finish-line-ux, origin, BD patterns, competitive research, expansion watchlist; aligned Telegram plan as v2 build plan.

---

## Settled decisions — **v2** (do not reopen without new evidence)

| Decision | Choice |
|---|---|
| Working name | **CalClaim** |
| Product version | **v2 — financial aid / benefits navigator** |
| V2 market | **California** (English ship) |
| Channel | **Telegram** |
| Differentiator | Living next-steps file + reminders + multi-category queue — not a calculator or PG&E silo |
| CX tree | [`customer-experience.md`](customer-experience.md) — gate, YES/NO queues |
| Finish-line UX | Next-steps PDF + Sign up URLs + reminders ([`finish-line-ux.md`](finish-line-ux.md)) |
| Energy / PG&E programs | **One cluster among many** in corpus |
| Ranking | Doc reuse → time-to-money (not energy-first) |
| Free-form / gibberish | Quiet log + thanks/redirect; no state advance |
| Languages (ship) | **English**; Spanish = expansion |
| PR locale / field coach | **Expansion / future** |
| Auto-submit to agencies | **No** |
| Expansion | Watchlist only; reassess if &gt;90 days old |
| Career intent | BD / Claude-for-nonprofits–shaped portfolio demo |

---

## Turn 15 — Build v2 Telegram bot (2026-07-31)

**User:** build

**Outcome:** Implemented runnable CalClaim v2 in-repo:

- Node/TS + grammy + SQLite + PDFKit + node-cron  
- Multi-category corpus (`corpus/programs.json`)  
- Gate → YES/NO queues → offer cards → one to-do list / benefits report PDF → reminders  
- Help / STOP / erase + free-form QC log  
- `npm run dev` after `.env` with `TELEGRAM_BOT_TOKEN`  
- Sample PDF at `docs/samples/calclaim-todo-list-sample.pdf`

---

## Turn 16 — Brand lock: CalClaim (2026-07-31)

**User:** Pivoted from PG&E app to CA financial assistance/incentives; NowWatt was a pun — find a new name. Then: **lets call it CalClaim**.

**Outcome:** Locked product name **CalClaim**. Renamed user-facing copy, package/identifiers, PDF filenames, and docs from NowWatt; project directory `nowwatt` → `calclaim`. Naming table and settled decisions updated.

---

### Retired v1 decisions (historical only)

| Decision | Was | Status |
|---|---|---|
| Markets | CA PG&E + Puerto Rico | Superseded for v2 ship |
| Core UX | WhatsApp/SMS + energy field coach | Superseded |
| CARE-first ranking | Hard product rule | Superseded by doc-reuse ranker |
| Languages must-ship | EN + CA-ES + PR-ES | Deferred |

---

## Portfolio paths referenced during session

- `portfolio/products/applications/anthropic/beneficial-deployments/`  
- `portfolio/products/applications/anthropic/STRATEGY.md`  
- `portfolio/products/applications/anthropic/beneficial-deployments/research/bd-hiring-psychology.md`  
- `portfolio/products/applications/anthropic/beneficial-deployments/research/bd-operations-partnerships-channels-2026-07-30.md`  
- `portfolio/experiences/climatedash/README.md`  
- `portfolio/content/master-profile.md`

---

## Turn — Alpha UX feedback (2026-08-01)

**User feedback:** Roommate vs household still confusing; remove tax card; no report if no tasks (push share); finish with restart / share / email report / more info; “You may qualify for X” on cards; buttons I’m already enrolled / Add to my to do list / Skip program; remove Open apply page (drop-off); finish = abbreviated text summary (docs→$, total, program URLs) then PDF; email PDF; report first line total $ this year + form-fill minutes; drop “open programs total” row.

**Outcome:** Wired into bot + PDF + CX/finish-line docs. Email via optional `SMTP_*` env (nodemailer).

---

## Turn — Process alpha QC feedback (2026-08-01)

**User feedback (Telegram 8795740677 / responses.jsonl):**
1. Put sparkle after “improvement” (opt-in)
2. Say “Thanks for your feedback!”
3. Take out “(only affects one optional program)” (past_due)
4. Copy the same household explanation to other household cards

**Outcome:** Applied in `flow.ts` / `interpret.ts` / `privacy/copy.ts` + CX docs. Shared `HOUSEHOLD_EXPLAIN` on gate, household size, income, and has-child. Open feedback todo marked done.

---

## Turn — BenefitsCal program coverage (2026-08-01)

**User:** Ensure we address all programs on BenefitsCal program descriptions (HCPRD); research quals and put in the tree per guidelines.

**Gap:** Corpus had Medi-Cal, CalFresh, CalWORKs only from BenefitsCal’s set. Missing CAPI, GA/GR, CMSP, Disaster CalFresh. GROW / WtW are nested employment services (noted under GA/GR + CalWORKs apply steps, not separate offer cards).

**Outcome:** Added corpus rows + gate toggles for CAPI / GA/GR / CMSP; Disaster CalFresh as seasonal offer; `excludeIfAlreadyOn` in ranker; CX / expansion-watchlist updated.
