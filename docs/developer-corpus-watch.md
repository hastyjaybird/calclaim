# Developer corpus watch

**URL (local):** `http://localhost:3000/dev`  
**Nav:** Impact · Developer  
**Access:** Password + CAPTCHA + human attestation (humans only — see PRIVACY.md)

Advisory tooling so developers can refresh the **frozen** program corpus (`corpus/programs.json`, `corpus/income-bands.json`) without inventing eligibility at runtime.

The agent **never writes** to the corpus. Humans review findings and edit JSON, then redeploy.

### Login policy

The Developer area is for **authorized human operators only**. Robots, crawlers, scrapers, automated scripts, AI agents, bots, and other non-human systems may not log in or call `/api/dev/*` (except the public captcha/login endpoints). Set `DEVELOPER_PASSWORD` in `.env`.

## What the scan checks

For each program (apply URL + `sources[]`):

| Check | How |
|---|---|
| Link health | HEAD/GET — 4xx/5xx, timeouts, redirects |
| Funding / closed | Heuristic phrases (“funds exhausted”, “applications closed”, …) |
| Deadlines / windows | Date-window language vs corpus `deadlines` |
| Eligibility | Income / eligibility update language |
| Apply process | Portal / document / interview change language |
| Max amounts | `$` / `%` benefit language vs `maxBenefit` / `estAnnualUsd` |
| Branding | Program name missing from fetched page text |
| CARE/FERA bands | Separate fetch of the CARE/FERA guidelines page vs `income-bands.json` |
| Deeper review | Optional LLM compare (corpus snapshot ↔ live page text) |

## API

Auth cookie required for all routes below except captcha/login/logout/session.

| Route | Method | Purpose |
|---|---|---|
| `/api/dev/captcha` | GET | CAPTCHA challenge (public) |
| `/api/dev/login` | POST | `{ password, captchaId, captchaAnswer, humanAttestation: true }` |
| `/api/dev/logout` | POST | Clear session |
| `/api/dev/session` | GET | `{ authenticated }` |
| `/api/dev/status` | GET | Corpus overview, open findings, recent scans, LLM on/off |
| `/api/dev/scan` | POST | Start a scan (202; 409 if already running) |
| `/api/dev/scan/:id` | GET | Scan progress + findings for that run |
| `/api/dev/findings?status=` | GET | `open` (default), `all`, `acknowledged`, `dismissed`, `fixed` |
| `/api/dev/findings/:id` | PATCH | `{ "status": "acknowledged" \| "dismissed" \| "fixed" \| "open" }` |

## Env

| Variable | Purpose |
|---|---|
| `DEVELOPER_PASSWORD` | Required for `/dev` login |
| `DEVELOPER_SESSION_SECRET` | Optional; falls back to `WEBHOOK_SECRET` |
| `OPENROUTER_API_KEY` | Enable LLM findings via OpenRouter |
| `OPENROUTER_MODEL` | Default `openai/gpt-4o-mini` |
| `OPENAI_API_KEY` | Alternative OpenAI-compatible key |
| `OPENAI_MODEL` | Default `gpt-4o-mini` |

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

Aging rule (same as [`expansion-watchlist.md`](expansion-watchlist.md)): if corpus `version` is **>90 days** old, or a major benefits announcement lands, re-run assessment before further engineering.

## Suggested workflow

1. Open `/dev` → **Run corpus check**.  
2. Triage critical/high findings; open evidence URLs.  
3. Edit `corpus/programs.json` / `income-bands.json`; bump `version` to today’s date.  
4. Mark findings **fixed** (or dismiss false positives).  
5. `npm run typecheck` / redeploy; spot-check offer cards + apply redirects.

## Safety alignment

- Deterministic ranker still reads only the frozen corpus.  
- Watcher findings are **not** eligibility truth for chat users.  
- Agency sites may block scrapes — treat empty/blocked pages as “verify manually,” not “program gone.”
