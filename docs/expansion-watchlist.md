# Expansion watchlist — near-future markets & program types

**Assessment date:** 2026-07-31 (v2)  
**V2 committed:** California financial aid / benefits (English, Telegram) only.

> **Aging rule:** Benefit rules, FPL tables, and agency URLs change.  
> If this document is **>90 days old**, or a major state/federal benefits announcement lands, **re-run the assessment before committing engineering**. Do not treat this list as evergreen truth.

---

## How to re-run (checklist)

1. Which programs are **open and accepting applications**.  
2. Public eligibility + apply steps freezeable into corpus in &lt;2 weeks.  
3. Language need (Spanish, etc.) vs channel fit.  
4. Whether reminders/deadlines are knowable without inventing dates.  
5. Overlap with existing CA corpus (doc reuse across programs).

---

## Deferred from v2 (do not build until reassessment)

| Item | Why deferred | Watch for |
|---|---|---|
| **Spanish conversation mode** | Ship English first | Demand from testers / BD story need |
| **Puerto Rico locale** | Was v1 energy story; not v2 center | PR benefit stacks + dialect QA capacity |
| **In-chat field coach** (per-form Next question) | Living PDF is v2 finish line | One high-value program where coach lifts completion |
| **Other US states** | Corpus + legal surface area | Open applications + Spanish need |
| **Energy-only IRA chase (TX/FL)** | Wrong product frame for v2 | Only as *rows* inside a state benefits expansion |

---

## Tier A — best next after CA English Telegram

| Expansion | Why interesting | Watch for |
|---|---|---|
| **CA Spanish** | Same corpus; large need | Dialect/plain-language QA |
| **Additional CA programs** | Child care, housing waitlists, local city aid | Frozen public rules only |
| **Deep coach for one program** | e.g. CARE or CalFresh apply path | Must remain opt-in from next-steps |

---

## Tier B — other geographies (later)

| Market | Note |
|---|---|
| **NY / IL / etc. multi-benefit** | MyFriendBen-like stacks; rebuild corpus |
| **PR** | High need; separate Spanish register; not energy-only |
| **TX / FL** | Large future energy $ — only after benefits framing stays primary |

---

## Program types (v2 priority — multi-category)

| Priority | Program type | CalClaim fit |
|---|---|---|
| 1 | **Food / health / cash** (CalFresh, Disaster CalFresh, Medi-Cal, CMSP, WIC, CalWORKs, GA/GR, CAPI, SSI) | **Core** |
| 2 | **Telecom** (LifeLine) | Core |
| 3 | **Bill discounts / LIHEAP / AMP** | Core peers (not brand) |
| 4 | **Utility free upgrades** (ESA-like) | Peer offer |
| 5 | **Tax credits** | Info / higher-friction offers |
| 6 | **IRA home rebates** | Only when live + as optional rows |

### Framing to avoid

- “Underspent IRA” as the product story.  
- Competitive grants with 10–30× applications.  
- Utility-scale interconnection / capital markets.  
- **PG&E-only identity.**

---

## Suggested expansion trigger

Expand language, geography, or deep field coach only when **all** are true:

1. Consumer-facing applications are open.  
2. Public rules freeze into corpus.  
3. Expansion does not collapse the product back into a single silo (energy-only).  
4. Reassessment dated within 90 days.
