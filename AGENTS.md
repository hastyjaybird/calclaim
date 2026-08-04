# AGENTS.md

## Cursor Cloud specific instructions

CalClaim v2 is a single Node/TypeScript process (ESM, `tsx`) that runs **two surfaces together**:

- **HTTP web server** — funder impact dashboard `/impact`, partner signup `/partners/signup`, developer corpus watch `/dev`, tracking redirects `/go/*` and `/r/*`, `/health`. Served by `src/web/server.ts`.
- **Telegram bot** — grammY handlers in `src/bot/`, long polling by default. Reminder cron runs on a schedule.

Standard commands live in `README.md` and `package.json` scripts; don't duplicate them. Notes below are the non-obvious gotchas.

### Running
- `npm run dev` (watch) / `npm start` are the real run commands. **Startup calls `bot.api.getMe()` before the web server starts**, so an empty or invalid `TELEGRAM_BOT_TOKEN` makes the whole process exit with `401 Unauthorized` and the web server never comes up. A real token from [@BotFather](https://t.me/BotFather) is required to run the app the normal way (and to exercise the bot at all — that also needs a Telegram account to chat with).
- To develop/test **web-only** features without a bot token, start just the HTTP layer by calling `startWebServer(loadConfig())` (with `initDb`/`setFlowConfig` first, mirroring `src/index.ts`) — `loadConfig()` still needs *some* `TELEGRAM_BOT_TOKEN` value set, but the token is never validated in this path.
- `/go/<campaign>` returns HTTP 503 ("Bot username not ready") until the bot username resolves; that only happens after a successful `getMe()`, i.e. with a real token. Expected behavior in web-only mode.

### Lint / test / build
- There is **no separate linter and no automated test suite**. `npm run build` == `npm run typecheck` == `tsc --noEmit` — treat that as the lint/build gate.

### Data & config
- SQLite lives under `./data/` (gitignored, default `./data/calclaim.sqlite`). `better-sqlite3` ships prebuilt binaries; no native compile is needed on Node 22.
- `/dev` needs `DEVELOPER_PASSWORD` set plus a CAPTCHA + human-attestation checkbox at login (default demo password `caldev1234` is in `.env.example`). Findings never edit the frozen `corpus/*.json`.
- SMTP is optional. Without `SMTP_*`, partner welcome kits (email HTML, banner PDF, QR PNG) are written to `data/mail-outbox/` instead of being emailed.
- Helper scripts run **without** a token: `npm run seed-impact` populates the dashboard with demo analytics; `npm run sample-pdf` writes a sample to-do PDF to `docs/samples/`.
- `.env` is loaded at startup and does **not** override values already in the shell env.
