# Funder impact dashboard

**URL (local):** `http://localhost:3000/impact`  
**Partner signup:** `http://localhost:3000/partners/signup`  
**API:** `GET /api/stats` · `GET /api/partners` · `GET /api/partners/:slug` · `POST /api/partners/signup` · `POST /api/partners/login` · `POST /api/partners/cancel` · `GET /api/partners/:slug/banner` · signed-in `GET /api/partners/:slug/account` · `GET /api/partners/:slug/export` · `DELETE /api/partners/:slug` (soft-cancel)  
**Nav:** Impact · Partners · [Developer](developer-library-watch.md) (`/dev`)

## What funders see

1. **Banner** – CalClaim + one-line demo framing  
2. **People reached** – QR scans + shared-link clicks (`/go/:campaign`)  
3. **Programs accessed** – clicks from chat → official apply sites via `/r/:programId`  
4. **Follow-throughs** – “Add to My Application Guide” taps  
5. **Est. aid unlocked** – sum of library `estAnnualUsd` × follow-throughs  
6. **Map** – QR placement pins + coarse city-level IP (never street address)  
7. **Community partners leaderboard** – verified organizations and individuals ranked by people reached via their unique QR; #1 gets a subtle trophy; Partner Log-in at the top takes organization owners to their private page; each row still links to that partner’s public slide  
8. **Charts** – users/day and cumulative people reached  
9. **Program table** – opens, follow-throughs, estimated $  

Pipeline fall-off, screen dropout/timing, report counts, and how CalClaim spreads live behind [developer login](developer-library-watch.md) (`GET /api/dev/stats`). Public `GET /api/stats` omits those operator fields even when `IMPACT_STATS_MODE=live`.

### Partner slides

**URL:** `/partners/:slug` (e.g. `/partners/fresno-food-bank`)  
**QR PNG:** `GET /api/qr/partner/:slug` → tracked `/go/<campaignId>`

Each partner page is a standalone “deck slide” for funders:

- CalClaim logo × partner logo lockup  
- That partner’s unique printable QR  
- KPIs (people reached, bot starts, follow-throughs, est. aid)  
- Map + users/day + cumulative charts for their campaign  
- Signed-in **organization** owners also get event QR management (create a code per booth/day, ranked by how the event did) and account tools (edit, download data, cancel listing)  
- **Individuals** (typically Gmail) appear on the public leaderboard and have a public stats page, but no private `/org` dashboard. Their welcome email includes a cancel URL that removes them from the leaderboard only; the developer partners panel still shows the signup with signed-up and canceled dates  

Demo partners live in [`library/partners.json`](../library/partners.json) (linked to [`library/campaigns.json`](../library/campaigns.json)). Live signups are stored in SQLite (`partner_signups`) via `/partners/signup` – each gets a unique ID, status page, QR, welcome email, and printable booth banner PDF. Organization owners can edit or soft-cancel the account and download a ZIP of CSVs for the data shown on that page; the export is rebuilt from current stats whenever they download. Framing is **community outreach partners** – not official agency affiliation.

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
| `GET /go/:campaignId` | `awareness` (qr or link; peer shares include referrer meta) | Bridge → `t.me/<bot>?start=<campaignId>` |
| Help / finish-line **Share** | `share_out` + unique `sl_` / `sq_` campaign (+ prompt meta) | Friend gets `/go/sl_…` or `/go/sq_…` |
| Friend `/start` via peer share | `bot_start` + `share_in` + `referral_edges` row (first touch) | opt-in flow |
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
| **live** (default) | Real `analytics_events` (operator Telegram ids excluded; library demo partners omitted from the leaderboard) | `IMPACT_STATS_MODE=live` or default in `DEFAULT_IMPACT_STATS_MODE` |
| **demo** | Staged ~90-day “fully running” metrics, map, partner leaderboard | `IMPACT_STATS_MODE=demo` |

**Recording always continues** – QR landings (`/go/…`), Telegram funnel steps, and apply redirects (`/r/…`) keep writing to SQLite regardless of display mode. Flip the site by setting `IMPACT_STATS_MODE=demo` (or ask to “switch website to demo data”).

Exclude your own Telegram traffic from live rollups (your user id, not a phone number – Telegram rarely stores phone unless the user shared a contact):

```bash
OPERATOR_TELEGRAM_USER_IDS=123456789
# optional alias – private chat id equals user id
# DEVELOPER_TELEGRAM_CHAT_ID=123456789
```

Awareness clicks that happen within a few minutes of an excluded user’s `/start` on the same campaign are also dropped (operator testing Open CalClaim → Telegram).

API payloads include `statsSource: "demo" | "live"` and always attach `usersPerDayLive` so a flip is one config change.

### Seed into the live DB (local only)

```bash
npm run seed-impact
```

Writes fake rows into `analytics_events` (clears prior events), including `screen_view` journeys and `report_created` so `/dev` Dropout / Timing panels have something to show. Prefer the **demo display mode** for funder screenshots; `/dev` always reads live SQLite via `/api/dev/stats` (never the demo dataset).

## Env

- `PUBLIC_BASE_URL` – required in production so Telegram buttons hit *your* redirects  
- `TELEGRAM_BOT_USERNAME` – optional; resolved via `getMe()` at boot  
- `PORT` – web + (webhook) Telegram share the same listener  
- `IMPACT_STATS_MODE` – `live` (default) or `demo` for public dashboards
- `OPERATOR_TELEGRAM_USER_IDS` – comma-separated Telegram user ids omitted from live rollups
