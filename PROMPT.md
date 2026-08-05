# CalClaim v2 — Project Kickoff Prompt

Copy everything below the line into a new agent/chat when building the demo.

Also read before building:
- `docs/guidelines.md` (**v2**)
- `docs/customer-experience.md` (**required** — gate, YES/NO queues, next-steps)
- `docs/finish-line-ux.md` (**required** — living file + apply handoff)
- `docs/origin-and-reasoning.md` (includes v1 → v2 pivot)
- `docs/bd-design-patterns.md`
- `docs/expansion-watchlist.md` (do not expand geography/language without reassessment)

**Ignore retired v1 framing:** CalClaim is **not** a PG&E-only or energy-only product. Utility bill programs are one cluster in a broader California financial-aid list.

---

## Project

Build **CalClaim v2**: a **Telegram** chatbot that helps California people find **financial aid and benefit programs** across categories (health, food, cash assistance, telecom, energy bill help, tax credits, and more), maintain a **living next-steps file** with deadlines, and get nudged until they act — not just browse links.

This is a **portfolio demo**, not a production government product. Goal: show forward-deployed, last-mile AI for underserved users — constrained grounded knowledge + messaging channel + completion (files + reminders). Strong enough for Beneficial Deployments / nonprofit AI / economic mobility conversations.

**One-line job:** User texts CalClaim → ranked aid offers → living checklist PDF → reminders → ready to apply on official sites.

---

## V2 scope (hard)

1. **Geography:** California (statewide benefits library).  
2. **Channel:** Telegram bot (`grammy`), hosted (e.g. Railway).  
3. **Language (ship):** English. Spanish = expansion, not required for first demo.  
4. **Programs:** Multi-category financial aid. **Energy / PG&E programs (CARE, FERA, ESA, LIHEAP, AMP, …) are normal rows in the library** — never the sole product story and never auto-ranked above other aid solely because they are “energy.”  
5. **Puerto Rico energy locale / PR Spanish mode:** **Out of v2 ship.** Track on expansion watchlist.

Do **not** rebuild the retired v1 “PG&E finish-line field coach only” product as the main demo.

---

## Problem

Households leave money and help on the table across **many** programs: Medi-Cal, CalFresh, WIC, LifeLine, CARE/FERA, ESA, LIHEAP, tax credits, CalWORKs, etc. Calculators and agency sites hand off into mazes; people quit. Failure mode: **info → maze → quit**. CalClaim owns the **queue + checklist + reminder** layer: stay in chat until the next-steps file is clear.

Differentiator = **channel + living completion artifact**, not “another benefits directory.”

---

## Demo success criteria (“80% done”)

A reviewer runs this end-to-end in under 10 minutes:

1. Live Telegram bot (opt-in, Help, STOP).  
2. Gate: family already on Medi-Cal / CalFresh / SSI / CalWORKs / CAPI / GA/GR / CMSP / WIC? → YES or NO arm.  
3. YES arm: doc-reuse-ranked offer queue (CARE, LifeLine, CalFresh, ESA, … as library defines).  
4. NO arm: income × household band → FERA-only / CARE-band queue / tax-only as library defines.  
5. Every offer card: Sign up · Already enrolled · Remind me later · Skip (+ Help / STOP).  
6. After each meaningful action: regenerate and **send** living To Do List PDF (todos + deadlines).  
7. End of queue: re-send the **same** To Do List / benefits report PDF (not a second document).  
8. Reminders armed: Tue noon closest deadline; T-3 and T-1 (America/Los_Angeles).  
9. Free-form/gibberish → quiet QC log + thanks/redirect; no state advance.  
10. README + demo script + sample To Do List PDF.  

**Out of scope v2:** National coverage, auto-submit to agencies, live scraping as source of truth, legal/tax advice claims, document uploads, in-chat multi-field utility form coach (future), PR locale.

---

## Initial product requirements

### Channel & UX
- Telegram: inline / reply keyboards; short messages.  
- Multi-turn session memory.  
- Every actionable turn ends with a clear next control.  
- Tone: dignified, plain language; not salesy; no shame about income or bills.  
- Always-on: **Help** (privacy / erase / about / STOP), **STOP** (confirm → wipe).

### Core flows
Follow [`docs/customer-experience.md`](docs/customer-experience.md) exactly.

1. **Opt-in** — disclaimer + start.  
2. **Gate** — categorical programs already in household?  
3. **YES queue / NO queue** — rank by newDocs ASC → timeToMoney ASC; Skip cascades per library.  
4. **Living To Do List / benefits report** — one PDF; update + re-send after Sign up / Already / Remind / Skip / income selection.  
5. **Same PDF** re-sent when queue empties (no second report).  
6. **Reminders** — Tue noon + T-3 / T-1.  
7. **Stuck / Help** — privacy, erase, about, STOP.

### Knowledge (frozen library)
Version JSON/markdown in-repo. Demo answers must not depend on live web browse.

Minimum program rows (each with docs, deadlines, apply URL/steps, skip cascades, sources) — **energy is not privileged**:

- Categorical / health-food-cash: Medi-Cal, CMSP, WIC, CalFresh, Disaster CalFresh, SSI, CalWORKs, CAPI, GA/GR (as gate feeders and/or offers; BenefitsCal HCPRD coverage)  
- Telecom: LifeLine  
- Energy / bill (subset): CARE, FERA, ESA, LIHEAP, AMP *(if past-due rules in library)*  
- Tax credits (info / high-friction offers)  

Cite library docs internally; document sources in README. Never invent $ or deadlines outside library.

### Safety
- Disclaimers: estimates; not affiliated with agencies or utilities; not tax/legal/benefits advice.  
- No invented eligibility/dollars/deadlines.  
- No sensitive doc uploads in v2.  
- Opt-in first message; STOP/erase clears session + reminders + QC rows.

### Tech preferences
- Node.js + TypeScript + `grammy`.  
- SQLite (or Redis) for sessions/todos; `data/responses.jsonl` for QC.  
- PDF generator → `sendDocument`.  
- Railway webhook + cron.  
- Optional Claude later; **deterministic ranker over library is required** for demo reliability.

---

## Suggested milestones

**Slice 1:** Scaffold + library schema + CARE/LifeLine/CalFresh seeds + /start + gate + Help/STOP  
**Slice 2:** One YES card path + next-steps PDF send + free-form QC  
**Slice 3:** Full YES + NO queues + CARE Skip cascades + income band  
**Slice 4:** Reminder worker + erase/privacy + Railway deploy  
**Slice 5:** Sample files + demo script + polish  

---

## Deliverables checklist

- [ ] Working Telegram bot  
- [ ] Frozen multi-category library with sources  
- [ ] Living To Do List PDF after actions (= benefits report; one file)  
- [ ] Reminders (Tue + T-3/T-1 PT)  
- [ ] Help / STOP / erase (+ QC wipe)  
- [ ] Free-form QC log behavior  
- [ ] README: problem, architecture, limitations, demo script  
- [ ] In-product non-affiliation / not-advice  

---

## Voice examples

**Opt-in:** “CalClaim helps you find California benefits and bill help you may qualify for — food, health, phone, energy discounts, and more. Estimates only. Not affiliated with any agency. [ Start ]”

**Gate:** “Is anyone in your household already on Medi-Cal, CalFresh, SSI, CalWORKs, CAPI, GA/GR, CMSP, or WIC?” (multiselect + Done / None)

**Offer card (example — not energy-special):** “CalFresh — grocery help. Est. up to ~$X/mo (~$Y/person) if eligible. [ Sign up ] [ Already enrolled ] [ Remind me later ] [ Skip ]”

**Offer card (energy as peer):** “CARE — PG&E bill discount if you’re a PG&E customer. Est. ~30–35% off electric. [ Sign up ] …”

**After action:** “Updated your To Do List (benefits report) ↓” + document.

---

## Instruction to the implementing agent

Implement a thin vertical slice that is **demo-reliable** over feature-complete. Optimize for: underserved household → Telegram → multi-program aid queue → living checklist → reminders. Prefer boring, correct program guidance over clever agents. When tradeoffs appear: fewer programs, better completion, clearer files. Treat `docs/customer-experience.md` + the Telegram benefits plan as law. **Do not center the product on PG&E or energy.** Do not expand beyond CA English without an updated expansion assessment.
