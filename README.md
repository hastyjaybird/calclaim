# CalClaim (v2)

**California financial aid / benefits navigator** on Telegram.  
Food, health, cash, telecom, energy bill help, tax credits, and more — **not** a PG&E-only app. Utility programs are one cluster in the corpus.

**Status:** Runnable demo (long polling locally; webhook-ready for Railway)

## One-line job

User opens CalClaim → short gate → ranked multi-category offers → living next-steps PDF + reminders → apply on official sites.

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

4. Open Telegram, tap your bot, send `/start`.

### Env

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Required |
| `BOT_MODE` | `long_polling` (default) or `webhook` |
| `WEBHOOK_URL` / `WEBHOOK_SECRET` / `PORT` | Webhook deploy |
| `DATABASE_PATH` | SQLite file (default `./data/calclaim.sqlite`) |
| `TZ` | `America/Los_Angeles` |

`.env` is loaded automatically on start (existing shell env wins).

## What the bot does

1. **Opt-in** — multi-category disclaimer  
2. **Gate** — already on Medi-Cal / CalFresh / SSI / CalWORKs / WIC?  
3. **YES / NO queues** — ranked by new docs + time-to-money (CARE is not hard-coded first for “energy” reasons)  
4. **Offer cards** — Open apply page · add to list · Already · Remind · Skip  
5. **Next-steps PDF** after each action  
6. **Benefits report PDF** when the queue ends  
7. **Reminders** — daily 12:00 PT scan (Tue closest + T-3 + T-1)  
8. **Help / STOP / erase** + quiet free-form QC log (`data/responses.jsonl`)

## Demo script (~5 min)

1. `/start` → Start  
2. **Yes** on gate → past due **No**  
3. Walk CARE (energy) → **Skip** or Sign up; then LifeLine (telecom) and CalFresh (food) — show multi-category  
4. Open the PDF; confirm food + telecom + energy can all appear  
5. Type `asdf` → “Thanks for your feedback…” (no advance)  
6. Help → About → STOP → erase  

Sample PDF: `npm run sample-pdf` → `docs/samples/calclaim-next-steps-sample.pdf`

## Repo layout

```
corpus/           Frozen programs + income bands
src/bot/          Grammy handlers + keyboards
src/queue/        Deterministic ranker + CARE skip cascades
src/nextsteps/    Todo model + PDF render
src/reminders/    Cron
src/privacy/      Copy
src/qc/           responses.jsonl
src/db/           SQLite sessions
docs/             Product specs (v2)
PRIVACY.md
```

## Docs

| Doc | Contents |
|---|---|
| [`docs/guidelines.md`](docs/guidelines.md) | v2 product rules |
| [`docs/customer-experience.md`](docs/customer-experience.md) | CX tree |
| [`docs/finish-line-ux.md`](docs/finish-line-ux.md) | Living file + reminders |
| [`PROMPT.md`](PROMPT.md) | Build kickoff |

## Non-affiliation

Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or Anthropic. Estimates only; not tax, legal, or benefits advice.

## Deploy (Railway sketch)

1. Set `BOT_MODE=webhook`, `WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, volume for `/data`.  
2. Start command: `npm start`  
3. Health: `GET /health`
