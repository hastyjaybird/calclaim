# Origin and reasoning — how we arrived at CalClaim v2

**Date locked (v1 concept):** 2026-07-30  
**Date pivoted (v2):** 2026-07-31  
**Context:** Jay exploring demo projects toward Anthropic **Beneficial Deployments (BD)** / Claude for Nonprofits–adjacent work — last-mile AI for underserved populations.

---

## Product version (read first)

| Version | What it was | Status |
|---|---|---|
| **v1** | Energy-efficiency + PG&E incentives navigator; CARE/ESA finish-line field coach; CA + PR Spanish | **Retired as product center** — kept as history |
| **v2 (current)** | **California financial aid / benefits navigator** on Telegram; multi-category offer queue; living next-steps PDF + reminders; energy/PG&E programs = **one cluster among many** | **Build this** |

---

## 1. Starting question

Review what Anthropic BD, Gates Foundation, partner host orgs, and nonprofits are building; study their **user-facing tech mechanisms** (beyond SMS); propose ~10 demos loosely similar in structure that leverage Jay’s career (energy, rural deployment, PR, tribal, grants, ClimateDash).

---

## 2. What BD / partners are actually shipping

Full pattern map: [`bd-design-patterns.md`](bd-design-patterns.md). Design thesis:

**Trusted knowledge base + constrained model + channel people already use + human escalation / finish-line.**

Named examples that shaped CalClaim:

| Partner / program | Design detail we copied |
|---|---|
| **MyFriendBen** | Screener → $ value / time-to-apply → results; rules-as-code |
| **GetCalFresh** | Mobile-first; nudges; stay until submit-ready |
| **Epilepsy Foundation Sage** | Grounded RAG; refuse when out of corpus |
| **IRC Signpost AI** | Messaging; HITL; verified local content |
| **Farmer.Chat / Gates agri** | WhatsApp/Telegram; meet-them-where-they-are |
| **Code for America** | Plain language; CBO-assisted completion |

**Hiring psychology:** BD patterns-match people who pointed a powerful platform at an underserved population *inside someone else’s risk envelope*. CalClaim v2 manufactures a visible version of that motion via **benefits completion**, not “another energy calculator.”

---

## 3. Ten demo ideas considered (short list)

Candidates included energy navigator, field tech companion, cooperative guide, outage assistant, tribal energy explainer, rate-case helper, agri×energy advisor, grant-match agent, policy PDF actions, skills passport.

Jay **leaned toward** household EE + incentives (became **v1 CalClaim**) and parked “LegalZoom for renewable finance stacking.”

---

## 4. v1 concept (energy + PG&E) — why it existed

### Kept briefly as A
- Real household $ and underenrollment on CARE/FERA/ESA.  
- Lived friction: Rewiring America → lost on PG&E.  
- Wedge: messaging channel + finish-line + Spanish/PR mode.

### Limits that drove the pivot
- Competing with Rewiring America on *energy discovery* is the wrong fight.  
- BD / MyFriendBen / GetCalFresh DNA is **multi-benefit economic mobility**, not utility-silo tools.  
- A PG&E-centered product under-tells the portfolio story and under-serves households who need food/health/phone help *and* bill discounts.

---

## 5. v2 pivot (2026-07-31) — financial aid services

**Decision:** Rebrand and rebuild the product around **all financial aid / incentive programs** a CA household might use. Utility bill programs (CARE, FERA, ESA, LIHEAP, AMP, …) remain in the corpus as **normal offers**, not the brand or the ranking privilege.

| Dimension | v2 choice |
|---|---|
| Scope | Multi-category CA benefits + bill help |
| Channel | Telegram |
| Completion | Living next-steps PDF + reminders |
| Language (ship) | English first |
| Geography (ship) | California |
| Energy/PG&E | One cluster in the list |
| PR / ES / field coach | Expansion / future |

Build contract: [`customer-experience.md`](customer-experience.md) + Telegram benefits plan.

---

## 6. Naming

| Name | Notes |
|---|---|
| PasoWatt / DoneWatt | Early energy-era candidates |
| NowWatt | v1 → early v2 working name (energy pun); retired with PG&E-centered framing |
| **CalClaim** | **Locked (2026-07-31)** — California + claim what’s yours; multi-category benefits, not energy-only |

---

## 7. Markets

### v2 committed
- **California** — Medi-Cal, CalFresh, WIC, LifeLine, CARE/FERA/ESA, LIHEAP, tax credits, CalWORKs, etc. (corpus-defined).

### Deferred (expansion watchlist)
- Puerto Rico locale / PR Spanish  
- Other states’ benefit stacks  
- Spanish conversation mode  
- Deep in-chat form field coach for a single program  

### Explicitly not “energy underspend chase”
- TX/FL unlaunched IRA pots remain interesting for a *future energy module*, not the v2 product definition.

---

## 8. Feasibility

Demo-80% in weeks is realistic if scoped to: Telegram + frozen CA multi-program corpus + next-steps PDF + reminders — **not** national live DB, auto-submit, or full bilingual PR field coach.

---

## 9. Resume / BD story (v2 north star)

> I pointed a constrained assistant at underserved California households on Telegram, grounded it in public benefits rules across food, health, telecom, and bill assistance, and stayed with them via a living next-steps file and reminders until they were ready to apply — the same last-mile pattern BD partners use for benefits and crisis info.

Scope cuts prefer that sentence over energy nostalgia.
