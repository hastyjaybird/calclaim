# Funder impact dashboard

**URL (local):** `http://localhost:3000/impact`  
**API:** `GET /api/stats` · `GET /api/partners` · `GET /api/partners/:slug`  
**Nav:** Impact · Partners · [Developer](developer-corpus-watch.md) (`/dev`)

## What funders see

1. **Banner** — CalClaim + one-line demo framing  
2. **People reached** — QR scans + shared-link clicks (`/go/:campaign`)  
3. **Programs accessed** — clicks from chat → official apply sites via `/r/:programId`  
4. **Follow-throughs** — “Add to my to do list” taps  
5. **Est. aid unlocked** — sum of corpus `estAnnualUsd` × follow-throughs  
6. **Map** — QR placement pins + coarse city-level IP (never street address)  
7. **Community partners leaderboard** — orgs ranked by people reached via their unique QR; #1 gets a subtle trophy; each row links to a partner stats slide  
8. **Charts** — users/day and cumulative people reached  
9. **Program table** — opens, follow-throughs, estimated $  

Pipeline fall-off (CX tree funnel) lives behind [developer login](developer-corpus-watch.md).

### Partner slides

**URL:** `/partners/:slug` (e.g. `/partners/fresno-food-bank`)  
**QR PNG:** `GET /api/qr/partner/:slug` → tracked `/go/<campaignId>`

Each partner page is a standalone “deck slide” for funders:

- CalClaim logo × partner logo lockup  
- That partner’s unique printable QR  
- KPIs (people reached, bot starts, follow-throughs, est. aid)  
- Map + users/day + cumulative charts for their campaign  

Partners are defined in [`corpus/partners.json`](../corpus/partners.json) and linked to QR campaigns in [`corpus/campaigns.json`](../corpus/campaigns.json). Framing is **community outreach partners** — not official agency affiliation.

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
| `GET /r/:programId` | `program_open` | 302 → official `applyUrl` |
| Telegram `/start <payload>` | `bot_start` + session `campaignId` | opt-in flow |
| Offer “Add to my to do list” | `follow_through` (with session campaign) | next-steps PDF |

Campaign pins live in [`corpus/campaigns.json`](../corpus/campaigns.json). Print partner QRs from `/api/qr/partner/:slug` or point posters at `/go/<id>`.

## Location policy

- Cell-tower data is **not** available.  
- IP geolocation is **city-level**, rounded (~3–4 miles).  
- Preferred map story: **QR poster sites** (known lat/lng).  
- Never store typed street addresses on the impact map.

## Seed demo data

```bash
npm run seed-impact
```

Seed weights partner campaigns unevenly so the leaderboard has a clear #1 for demos.

## Env

- `PUBLIC_BASE_URL` — required in production so Telegram buttons hit *your* redirects  
- `TELEGRAM_BOT_USERNAME` — optional; resolved via `getMe()` at boot  
- `PORT` — web + (webhook) Telegram share the same listener  
