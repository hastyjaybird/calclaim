# Funder impact dashboard

**URL (local):** `http://localhost:3000/impact`  
**API:** `GET /api/stats`  
**Nav:** Impact · [Developer](developer-corpus-watch.md) (`/dev`)

## What funders see

1. **Banner** — CalClaim + one-line demo framing  
2. **People reached** — QR scans + shared-link clicks (`/go/:campaign`)  
3. **Programs accessed** — clicks from chat → official apply sites via `/r/:programId`  
4. **Follow-throughs** — “Save to my to do list” taps  
5. **Est. aid unlocked** — sum of corpus `estAnnualUsd` × follow-throughs  
6. **Pipeline fall-off** — CX tree funnel (reach → bot → start → gate → triage → first offer → apply → list → finished) with largest drop callout  
7. **Map** — QR placement pins + coarse city-level IP (never street address)  
8. **Charts** — users/day and cumulative people reached  
9. **Program table** — opens, follow-throughs, estimated $

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
| Telegram `/start <payload>` | `bot_start` | opt-in flow |
| Offer “Save to my to do list” | `follow_through` | next-steps PDF |

Campaign pins live in [`corpus/campaigns.json`](../corpus/campaigns.json). Print QR codes pointing at `/go/<id>`.

## Location policy

- Cell-tower data is **not** available.  
- IP geolocation is **city-level**, rounded (~3–4 miles).  
- Preferred map story: **QR poster sites** (known lat/lng).  
- Never store typed street addresses on the impact map.

## Seed demo data

```bash
npm run seed-impact
```

## Env

- `PUBLIC_BASE_URL` — required in production so Telegram buttons hit *your* redirects  
- `TELEGRAM_BOT_USERNAME` — optional; resolved via `getMe()` at boot  
- `PORT` — web + (webhook) Telegram share the same listener  
