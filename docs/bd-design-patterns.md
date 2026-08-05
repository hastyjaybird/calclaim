# Beneficial Deployments & partner design patterns → CalClaim v2

**Compiled:** 2026-07-30 · **Updated for v2:** 2026-07-31  
**Sources:** Portfolio research under `portfolio/products/applications/anthropic/beneficial-deployments/` plus public case studies (Claude for Nonprofits, Gates partnership, Signpost, MyFriendBen, Farmer.Chat, Code for America, GetCalFresh).

CalClaim deliberately mirrors these **user-visible mechanisms**, not Anthropic’s internal org chart.

---

## 1. BD priority verticals (context)

1. Global health  
2. Life sciences  
3. Education  
4. Economic mobility (incl. agriculture + US skills/career tools)

**v2 CalClaim** sits squarely in **economic mobility**: helping households claim food, health, cash, telecom, and bill-assistance benefits. Energy bill programs are one mobility lever among many — not the sole vertical.

---

## 2. Tech mechanisms observed (beyond “SMS”)

| Mechanism | Who | User experience | CalClaim v2 mapping |
|---|---|---|---|
| Rules-as-code + AI explainer | MyFriendBen / PolicyEngine | Screener → eligibility $ + time → guidance | Deterministic ranker + offer cards + $ estimates from library |
| Grounded RAG companion | Epilepsy Sage | Refuse if not in KB | Frozen multi-program library + refusals |
| Staff / user HITL messaging | Signpost AI | Draft → human approve in high stakes | Optional later; demo auto if grounded |
| Meet-them-where-they-are | Farmer.Chat, Signpost, GetCalFresh | WhatsApp / Telegram / SMS | **Telegram primary** |
| Nudges / reminders | GetCalFresh | SMS/email → doc submission lift | Tue noon + T-3/T-1 deadline reminders |
| Living checklist | Benefits / assister tools | Durable To Do List | **To Do List PDF** (= benefits report) re-sent after actions |
| CBO / assister portals | GetCalFresh legacy | Helper completes with client | Future optional field coach — not v2 default |
| Evals / public goods | Gates, Signpost research | Benchmarks | Demo scripts + sample PDFs |

---

## 3. Structural pattern BD respects

```
trusted multi-program library
    → constrained ranker / model (no freestyle eligibility invention)
        → channel people already use (Telegram)
            → clear next step (Sign up) + living file
                → reminders → escalate / official phone when unsure
```

**Anti-pattern:** open-ended ChatGPT that invents benefit amounts and dumps a single utility’s homepage.

**Anti-pattern (v2-specific):** shipping a “PG&E bot” dressed as a benefits product.

---

## 4. Why this beats “another ClimateDash” or “another energy calculator”

ClimateDash proves multi-agent build skill. Rewiring America owns energy eligibility math. The credential gap is **platform → underserved population → completion across aid**. CalClaim v2 is intentionally **benefits last-mile**, with energy programs as peers.

---

## 5. Partner products CalClaim should *not* try to clone wholesale

| Product | Why not clone |
|---|---|
| Rewiring America calculator | Energy discovery incumbent; we are multi-aid completion |
| Full MyFriendBen / PolicyEngine | Multi-state rules engine too large for demo — steal UX, not scale |
| GetCalFresh county integration | Real submission APIs out of scope |
| Full Signpost HITL ops | Ops-heavy |
| LegalZoom filings | Liability + no agency APIs |

---

## 6. Language as a BD-shaped requirement

BD/Gates emphasize local language. **v2 ships English**; Spanish conversation and PR mode remain on the expansion watchlist — still valued, not blocking the first Telegram demo.
