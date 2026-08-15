# CalClaim (v2)

**California financial aid / benefits navigator** on Telegram.  
Food, health, cash, telecom, energy bill help, and more – **not** a PG&E-only app. Utility programs are one cluster in the library.

**Status:** Runnable demo (long polling locally; webhook-ready for Railway)

## One-line job

User opens CalClaim → short gate → ranked multi-category offers → living Application Guide PDF + reminders → apply on official sites.

## Quick start

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.  
2. Install and configure:

```bash
cd ~/jayprograms/calclaim
npm install
cp .env.example .env
# put TELEGRAM_BOT_TOKEN=... in .env
```

3. Run:

```bash
npm run dev
```

For local `/dev` only (no Telegram polling), use the durable web daemon so the port survives agent shell cleanup:

```bash
./scripts/dev-web.sh ensure
# → http://localhost:3000/dev#tree
```

4. Open Telegram, tap your bot, send `/start`.  
5. Open the funder dashboard: [http://localhost:3000/impact](http://localhost:3000/impact)  
6. Open the developer review dashboard: [http://localhost:3000/dev](http://localhost:3000/dev)

Optional demo numbers:

```bash
npm run seed-impact
```

### Env

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Required |
| `TELEGRAM_BOT_USERNAME` | Optional; auto from Telegram at boot |
| `PUBLIC_BASE_URL` | Origin for QR landings + apply redirects (default `http://localhost:3000`) |
| `IMPACT_STATS_MODE` | `live` (default) or `demo` – what `/impact` and partner pages display |
| `OPERATOR_TELEGRAM_USER_IDS` | Optional – your Telegram id(s), excluded from live stats rollups |
| `BOT_MODE` | `long_polling` (default) or `webhook` |
| `WEBHOOK_URL` / `WEBHOOK_SECRET` / `PORT` | Webhook deploy |
| `DATABASE_PATH` | SQLite file (default `./data/calclaim.sqlite`) |
| `SMTP_HOST` / `SMTP_FROM` (+ optional `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) | Optional – partner signup welcome emails; otherwise kits go to `data/mail-outbox/` |
| `TZ` | `America/Los_Angeles` |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` | Optional – deeper LLM review on `/dev` library scans |
| `CLOUDFLARE_API_TOKEN` | Required for cloud deploy DNS ensure (`calclaim.jayhasty.com` A record) |

`.env` is loaded automatically on start (existing shell env wins).

## Funder impact site

Public page at `/impact` shows people reached (QR + links), program apply-page opens, follow-throughs, estimated aid unlocked, a coarse map, and charts. By default it serves **live** collected Telegram/QR events (operator ids excluded); set `IMPACT_STATS_MODE=demo` for staged at-scale numbers. Details: [`docs/funder-dashboard.md`](docs/funder-dashboard.md).

Partner signup at `/partners/signup` creates a unique partner ID, status page, QR, and printable booth banner; a welcome email delivers the kit (or `data/mail-outbox/` when SMTP is unset). Owners sign in from the `/impact` leaderboard to manage event QR codes and their account.

Print QR codes to `/go/<campaignId>` (see `library/campaigns.json`). Apply buttons in Telegram go through `/r/<programId>` so clicks are countable.

## Developer review dashboard

Page at `/dev` (password + CAPTCHA; **humans only**) runs an advisory agent over each program’s apply URL and source citations: link health, deadlines, eligibility language, apply-process changes, funding/closed signals, max amounts, and CARE/FERA income bands. Optional LLM analysis if an API key is set. Findings never edit the frozen library – developers update `library/programs.json` by hand. Set `DEVELOPER_PASSWORD` in `.env`. Details: [`docs/developer-library-watch.md`](docs/developer-library-watch.md).

## What the bot does

1. **Opt-in** – multi-category disclaimer  
2. **Gate** – already on Medi-Cal / CalFresh / SSI / CalWORKs / WIC?  
3. **YES / NO queues** – ranked by new docs + time-to-money (CARE is not hard-coded first for “energy” reasons)  
4. **Offer cards** – Add to My Application Guide · I'm already enrolled · Skip program · Exit & print My Application Guide now once the guide has an item (apply links stay in the report, not on the card)  
5. **Finish** – abbreviated text summary + Application Guide PDF when there are open tasks; if none, nudge to share with a friend  
6. **Finish** – summary + PDF, then email-to-computer (Mail app auto-opens with a download link). Idle: Email · Share · Restart · More info  
7. **Reminders** – daily 12:00 PT scan (Tue closest + T-3 + T-1)  
8. **Help / Share / STOP / erase** + alpha feedback (text/voice → QC log + `/dev` To Do List; voice transcribed with Whisper when `OPENAI_API_KEY` is set)

## Demo script (~5 min)

1. `/start` → Start  
2. **Yes** on gate → past due **No**  
3. Walk CARE (energy) → **Skip** or Sign up; then LifeLine (telecom) and CalFresh (food) – show multi-category  
4. Open the PDF; confirm food + telecom + energy can all appear  
5. Type `asdf` (or send a voice note) → “Thanks for your feedback!” + last prompt repeated (no advance); item appears on `/dev` feedback to-do  
6. Help → Share (link / QR) → About → STOP → erase  

Sample PDF: `npm run sample-pdf` → `docs/samples/calclaim-application-guide-sample.pdf`

## Repo layout

```
library/           Frozen programs, income bands, QR campaigns
public/impact/    Funder dashboard (HTML/CSS/JS)
src/analytics/    Event log + impact aggregates
src/web/          HTTP: dashboard, /go, /r redirects
src/bot/          Grammy handlers + keyboards
src/queue/        Deterministic ranker + CARE skip cascades
src/nextsteps/    Todo model + PDF render
src/reminders/    Cron
src/privacy/      Copy
src/qc/           responses.jsonl
src/db/           SQLite sessions, analytics, telegram_users / telegram_messages
docs/             Product specs (v2)
PRIVACY.md
```

## Docs

| Doc | Contents |
|---|---|
| [`docs/guidelines.md`](docs/guidelines.md) | v2 product rules |
| [`docs/customer-experience.md`](docs/customer-experience.md) | CX tree |
| [`docs/finish-line-ux.md`](docs/finish-line-ux.md) | Living file + reminders |
| [`docs/funder-dashboard.md`](docs/funder-dashboard.md) | Impact site + tracking |
| [`PROMPT.md`](PROMPT.md) | Build kickoff |

## Non-affiliation

Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or Anthropic. Estimates only; not tax, legal, or benefits advice.

## Deploy (Vultr)

```bash
# .env needs TELEGRAM_BOT_TOKEN and CLOUDFLARE_API_TOKEN (Zone DNS Edit on jayhasty.com)
CLOUD_HOST=root@144.202.105.150 ./scripts/sync-to-cloud.sh
```

That syncs the app, rebuilds the container, **upserts** the Cloudflare `A` record for `calclaim.jayhasty.com`, and fails if public DNS/HTTPS still look broken. The hostname going NXDOMAIN after a deploy was never the container dying — the DNS record was missing from Cloudflare (often deleted while toggling proxy status). Do not use `SKIP_DNS=1` unless you are intentionally bypassing that check.

## Deploy (Railway sketch)

1. Set `BOT_MODE=webhook`, `WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, volume for `/data`.  
2. Start command: `npm start`  
3. Health: `GET /health` · Impact: `GET /impact`
