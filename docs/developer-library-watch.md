# Developer library watch

**URL (local):** `http://localhost:3000/dev`  
**Nav:** Impact · Developer  
**Access:** Password + CAPTCHA + human attestation (humans only — see PRIVACY.md)

Advisory tooling so developers can refresh the **frozen** program library (`library/programs.json`, `library/income-bands.json`) without inventing eligibility at runtime.

The agent **never writes** to the library. Humans review findings and edit JSON, then redeploy.

### Login policy

The Developer area is for **authorized human operators only**. Robots, crawlers, scrapers, automated scripts, AI agents, bots, and other non-human systems may not log in or call `/api/dev/*` (except the public captcha/login endpoints). Set `DEVELOPER_PASSWORD` in `.env`.

## What the scan checks

For each program (apply URL + `sources[]`):

| Check | How |
|---|---|
| Link health | HEAD/GET — 4xx/5xx, timeouts, redirects |
| Funding / closed | Heuristic phrases (“funds exhausted”, “applications closed”, …) |
| Deadlines / windows | Date-window language vs library `deadlines` |
| Eligibility | Income / eligibility update language |
| Apply process | Portal / document / interview change language |
| Max amounts | `$` / `%` benefit language vs `maxBenefit` / `estAnnualUsd` |
| Branding | Program name missing from fetched page text |
| CARE/FERA bands | Separate fetch of the CARE/FERA guidelines page vs `income-bands.json` |
| Deeper review | Optional LLM compare (library snapshot ↔ live page text) |

## API

Auth cookie required for all routes below except captcha/login/logout/session.

| Route | Method | Purpose |
|---|---|---|
| `/api/dev/captcha` | GET | CAPTCHA challenge (public) |
| `/api/dev/login` | POST | `{ password, captchaId, captchaAnswer, humanAttestation: true }` |
| `/api/dev/logout` | POST | Clear session |
| `/api/dev/session` | GET | `{ authenticated }` |
| `/api/dev/status` | GET | Library overview, open findings, recent scans, LLM on/off |
| `/api/dev/scan` | POST | Start a scan (202; 409 if already running) |
| `/api/dev/scan/:id` | GET | Scan progress + findings for that run |
| `/api/dev/findings?status=` | GET | `open` (default), `all`, `acknowledged`, `dismissed`, `fixed` |
| `/api/dev/findings/:id` | PATCH | `{ "status": "acknowledged" \| "dismissed" \| "fixed" \| "open" }` |
| `/api/dev/disaster-windows?status=` | GET | `all` (default), `pending`, `active`, `expired`, `dismissed` |
| `/api/dev/disaster-windows/:id` | PATCH | `{ "status": "active" \| "dismissed" \| "pending" \| "expired" }` and/or `{ "applyPeriods": [{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }] }` |
| `/api/dev/program-matrix` | GET | Requirements matrix: every program with derived difficulty rank, reverse unlocks, and the editing vocabularies |
| `/api/dev/program-matrix/:programId` | PATCH | Any subset of `eligibility`, `documents`, `interview`, `unlocks`, `prerequisites`, `difficultyOverride`, `reviewStatus`, `confidencePct`, `reviewRefs`, `notes`, `reviewedBy`. Unknown tag or program ids are rejected with 400. |

## Program requirements matrix

An editable table on `/dev` (`#matrix`) that answers "how hard is this program to actually finish, and what does it open up." Data lives in **`library/program-requirements.json`**, a companion file the bot never reads — it is operational metadata, not eligibility truth. Unlike `programs.json`, this file *is* written by the dev page: each cell edit saves immediately and atomically, so changes show up as a reviewable git diff. The loader re-reads on mtime change, so hand-editing the file in an editor is still safe.

Per program:

| Column | Meaning |
|---|---|
| Open now? | Whether someone could apply today — computed, see below |
| Difficulty | Computed tier (easy / moderate / hard) + score, with an optional per-row override |
| Eligibility requirements | Multi-select from a controlled tag vocabulary, so two programs with the same rule read identically |
| Documents needed | Multi-select; third-party documents (doctor's form, award letter, landlord consent) are the expensive ones |
| Interview | None → phone-if-questions → phone required → appointment → in person → home visit |
| Also qualifies you for | Categorical-eligibility graph — enrolling here is accepted as proof for those programs, so offer them next |
| Needs first | Hard prerequisites (IHSS needs Medi-Cal, YCTC needs CalEITC, AMP needs CARE or FERA) |
| Review status | `needs_review` → `verified_online` → `signed_off_by_program`, plus a confidence % and a timestamp |
| Review references | The official pages the row was checked against, editable as `Label \| URL` lines with quick-add from the program's library `sources` |

**Open now?** is recomputed on every request rather than stored, because a hand-maintained "active" flag is exactly the thing that rots into advertising a closed program. It reads the library `deadlines` and the live disaster-window table:

| Status | When |
|---|---|
| `window_open` | A disaster-gated program has an approved county window taking applications; the detail names the counties and the last apply day |
| `dormant` | A disaster-gated program has no live window. This is the normal state most of the year and matches the offer card being hidden |
| `deadline_soon` | The next dated deadline is within 60 days |
| `deadline_passed` | Every dated deadline is in the past. Usually means the library date needs rolling to the next cycle, not that the program ended — so it doubles as a staleness alarm |
| `seasonal` | Tagged `seasonal_window` (LIHEAP), so each county's funding window decides |
| `open` | Everything else |
| `paused` / `closed` | Pinned by hand via `availabilityOverride`, with `availabilityNote` recording who said so |

Only `open`, `paused`, and `closed` can be set by hand; the rest are derived and the override is rejected if you try. The live-window list is passed into `buildProgramMatrix()` by the web layer so `src/library/` keeps no database dependency. The `Status` filter's **Needs attention** option hides everything currently applicable, leaving the rows worth chasing.

**Difficulty score** = documents (third-party counted double) + interview weight (0 / 1.5 / 3 / 3.5 / 4.5 / 5) + `formFillMinutes` ÷ 15 + 0.2 per eligibility rule + 1.5 if a prerequisite exists. Easy ≤ 6.5, moderate ≤ 10, hard above. Documents and interviews dominate on purpose: a long rule list decides *whether* you qualify, not how hard the paperwork is.

Every row shipped as a **draft marked `needs_review`** with a confidence estimate, assembled from the linked official pages. Treat it as a starting point to verify, not as verified fact. `Download CSV` exports the whole matrix with full labels for offline review; `Copy JSON` copies the file contents.

## Disaster CalFresh windows

A separate daily job (07:00 `TZ`) publishes the Disaster CalFresh card on its own — no approval step. It reads three sources, which are not interchangeable:

| Source | Role | If it fails |
|---|---|---|
| **USDA FNS** ([California disaster page](https://www.fns.usda.gov/disaster/california)) | Decides. FNS is the agency that approves D-SNAP and the only source that states the application dates. | Nothing can publish. Alerts after 2 days. |
| **OpenFEMA** | Corroborates: confirms an Individual Assistance declaration covers the county. | Falls back to the declaration date stated in the FNS notice, at lower recorded confidence. Alerts after 4 days. |
| **CDSS** | Supplies the apply phone number and a second opinion on the dates. | Card still publishes without a phone number. Alerts after 21 days. |

A window goes live only when every mechanical check passes: an application period exists, FEMA declared Individual Assistance for the county, the period starts on or after the declaration, the total is 21 open days or fewer, the dates are neither past nor implausibly far out, the county scope is unambiguous (or pinned by a published ZIP list), and CDSS does not contradict FNS. A failed check **holds** the window — the card stays hidden and an alert says which check failed. A hold means the extraction or the source looks wrong, not that someone needs to approve it.

Because FNS approves an operation roughly two weeks before applications open, a published window can be in one of two states. Before it opens the card says *"Applications open Mon, Feb 10"* and its ranking weight is pushed back by the wait, so it does not outrank programs that pay sooner. Once open it reads as a normal deadline. A window stops matching on its own after its last application day.

`/dev` is an audit view of what the scan decided, with each window's check-by-check record. You can still **publish anyway** past a hold or **pull from bot**; a manual pull is permanent and later scans will not undo it. Auto-publish receipts, holds, and staleness go to `DEVELOPER_TELEGRAM_CHAT_ID`.

## Env

| Variable | Purpose |
|---|---|
| `DEVELOPER_PASSWORD` | Required for `/dev` login |
| `DEVELOPER_SESSION_SECRET` | Optional; falls back to `WEBHOOK_SECRET` |
| `OPENROUTER_API_KEY` | Enable LLM findings via OpenRouter |
| `OPENROUTER_MODEL` | Default `openai/gpt-4o-mini` |
| `OPENAI_API_KEY` | Alternative OpenAI-compatible key |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |
| `DEVELOPER_TELEGRAM_CHAT_ID` | Optional; Telegram chat for disaster auto-publish receipts, held windows, and scan staleness. Unset = console only |

Without a key, scans still run **link + heuristic** checks.

## Watch checklist (also on `/dev`)

Your original list — **plus** fields that break ranking, PDFs, or funder math when stale:

1. Important dates / filing windows (`deadlines`)  
2. Qualifications / eligibility (`oneLiner`, `incomeGate`, `requiresPastDue`, `requiresChildInHousehold`, `applySteps`)  
3. Application process (`applySteps`)  
4. Funds exhausted / paused delivery (`deadlines`, `oneLiner`)  
5. Max amounts per person/household (`maxBenefitUsd`, `maxBenefit`, `estAnnualUsd`)  
6. Application form URLs (`applyUrl`, `sources`)  
7. **Required documents** — ranker + PDF checklist (`docsNeeded`, `docsReusableFromGate`)  
8. **CARE/FERA income thresholds** (`income-bands.json`)  
9. **Open / closed / waitlist** — no first-class status field yet; label or remove closed rows  
10. **Program name / portal branding** (CoveredCA, BenefitsCal, utility renames)  
11. **Source citation health** (`sources[]` audit trail)  
12. **Time-to-money** (`timeToMoneyDays` — second ranking key)  
13. **Skip cascades / bill-not-in-name** (`skipCascades`, `skipReasons`, `requiresPastDue`)  
14. **New or sunset programs** (expansion watchlist + agency announcements)

Aging rule (same as [`expansion-watchlist.md`](expansion-watchlist.md)): if library `version` is **>90 days** old, or a major benefits announcement lands, re-run assessment before further engineering.

## Suggested workflow

1. Open `/dev` → **Run library check**.  
2. Triage critical/high findings; open evidence URLs.  
3. Edit `library/programs.json` / `income-bands.json`; bump `version` to today’s date.  
4. Mark findings **fixed** (or dismiss false positives).  
5. `npm run typecheck` / redeploy; spot-check offer cards + apply redirects.

## Safety alignment

- Deterministic ranker still reads only the frozen library.  
- Watcher findings are **not** eligibility truth for chat users.  
- Agency sites may block scrapes — treat empty/blocked pages as “verify manually,” not “program gone.”
