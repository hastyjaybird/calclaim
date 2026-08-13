# Funder impact dashboard

**URL (local):** `http://localhost:3000/impact`  
**Partner signup:** `http://localhost:3000/partners/signup`  
**API:** `GET /api/stats` · `GET /api/partners` · `GET /api/partners/:slug` · `POST /api/partners/signup` · `GET /api/partners/:slug/banner`  
**Nav:** Impact · Partners · [Developer](developer-library-watch.md) (`/dev`)

## What funders see

1. **Banner** – CalClaim + one-line demo framing  
2. **People reached** – QR scans + shared-link clicks (`/go/:campaign`)  
3. **How it spreads** – organization QR / event codes vs friend-to-friend shares (anonymous per-person links); people who shared, friend-link clicks, clicks per sharer  
4. **Programs accessed** – clicks from chat → official apply sites via `/r/:programId`  
5. **Follow-throughs** – “Add to My Application Guide” taps  
6. **Est. aid unlocked** – sum of library `estAnnualUsd` × follow-throughs  
7. **Map** – QR placement pins + coarse city-level IP (never street address)  
8. **Community partners leaderboard** – orgs ranked by people reached via their unique QR; #1 gets a subtle trophy; each row links to a partner stats slide  
9. **Charts** – users/day and cumulative people reached  
10. **Program table** – opens, follow-throughs, estimated $  

Pipeline fall-off (CX tree funnel) lives behind [developer login](developer-library-watch.md).

### Partner slides

**URL:** `/partners/:slug` (e.g. `/partners/fresno-food-bank`)  
**QR PNG:** `GET /api/qr/partner/:slug` → tracked `/go/<campaignId>`

Each partner page is a standalone “deck slide” for funders:

- CalClaim logo × partner logo lockup  
- That partner’s unique printable QR  
- KPIs (people reached, bot starts, follow-throughs, est. aid)  
- Map + users/day + cumulative charts for their campaign  

Demo partners live in [`library/partners.json`](../library/partners.json) (linked to [`library/campaigns.json`](../library/campaigns.json)). Live signups are stored in SQLite (`partner_signups`) via `/partners/signup` – each gets a unique ID, status page, QR, welcome email, and printable booth banner PDF. Framing is **community outreach partners** – not official agency affiliation.

**Ranking:** people reached (`awareness` events on the partner’s `campaignId`). Secondary stats: bot starts and follow-throughs (session-attributed via sticky `campaignId` from `/start`).

### Funnel stages (instrumented)

| Stage | Source |
|---|---|
| Found CalClaim | `awareness` |
| Opened bot | `bot_start` |
| Tapped Start | `funnel` / `started` |
| Completed gate | `funnel` / `gate_done` |
| Completed triage | `funnel` / `triage_done` |
| Saw first offer | `funnel` / `first_offer` |
| Opened apply page | `program_open` |
| Added to list | `follow_through` |
| Finished queue | `funnel` / `finished` |

## Tracking routes

| Route | Event | Then |
|---|---|---|
| `GET /go/:campaignId` | `awareness` (qr or link) | 302 → `t.me/<bot>?start=<campaignId>` |
| Help / finish-line **Share** | `share_out` + unique `sl_` / `sq_` campaign | Friend gets `/go/sl_…` or `/go/sq_…` |
| `GET /r/:programId` | `program_open` | 302 → official `applyUrl` |
| Telegram `/start <payload>` | `bot_start` + session `campaignId` | opt-in flow |
| Offer “Add to My Application Guide” | `follow_through` (with session campaign) | next-steps PDF |

Campaign pins live in [`library/campaigns.json`](../library/campaigns.json). Print partner QRs from `/api/qr/partner/:slug` or point posters at `/go/<id>`.

## Location policy

- Cell-tower data is **not** available.  
- IP geolocation is **city-level**, rounded (~3–4 miles).  
- Preferred map story: **QR poster sites** (known lat/lng).  
- Never store typed street addresses on the impact map.

## Demo vs live stats

The public site (`/impact`, `/partners/…`) can show either:

| Mode | What you see | Env / code |
|---|---|---|
| **demo** (default) | Staged ~90-day “fully running” metrics, map, charts, program table, partner leaderboard | `IMPACT_STATS_MODE=demo` or default in `DEFAULT_IMPACT_STATS_MODE` |
| **live** | Real `analytics_events` (operator Telegram ids excluded) | `IMPACT_STATS_MODE=live` |

**Recording always continues** – QR landings (`/go/…`), Telegram funnel steps, and apply redirects (`/r/…`) keep writing to SQLite regardless of display mode. Flip the site by setting `IMPACT_STATS_MODE=live` (or ask to “switch website to live data”).

Exclude your own phone from live rollups:

```bash
OPERATOR_TELEGRAM_USER_IDS=123456789
# optional alias – private chat id equals user id
# DEVELOPER_TELEGRAM_CHAT_ID=123456789
```

API payloads include `statsSource: "demo" | "live"` and always attach `usersPerDayLive` so a flip is one config change.

### Seed into the live DB (local only)

```bash
npm run seed-impact
```

Writes fake rows into `analytics_events` (clears prior events). Prefer the **demo display mode** for funder screenshots; `/dev` always reads live SQLite via `/api/dev/stats` (never the demo dataset).

## Env

- `PUBLIC_BASE_URL` – required in production so Telegram buttons hit *your* redirects  
- `TELEGRAM_BOT_USERNAME` – optional; resolved via `getMe()` at boot  
- `PORT` – web + (webhook) Telegram share the same listener  
- `IMPACT_STATS_MODE` – `demo` (default) or `live` for public dashboards  
- `OPERATOR_TELEGRAM_USER_IDS` – comma-separated Telegram user ids omitted from live rollups  
