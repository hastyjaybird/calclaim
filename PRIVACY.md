# CalClaim Privacy Policy (demo)

**Product:** CalClaim v2 — California financial aid / benefits navigator (Telegram)  
**Last updated:** 2026-07-31

## What we collect

### From Telegram (stored in SQLite)

Whenever you message or tap buttons in the bot, we store what Telegram sends us:

- Telegram **user id**
- **First name**, **last name** (if set), **username** (if set)
- **Language code** and **Telegram Premium** flag (if present)
- **Chat id** / chat type
- Each inbound **message** or **button tap**: text, callback data, timestamp
- If you choose to share them: **phone number** (contact share), **location**, or media file ids / captions
- A JSON snapshot of the Telegram User / message object for that update

Tables: `telegram_users`, `telegram_messages` in the demo database.

### Session & product data

- Answers you tap (gate, household size, income band, offer actions)
- Next-steps todo items and deadlines derived from our frozen program corpus
- Free-form text or voice notes you send that are not a recognized button/command (alpha feedback / developer quality control)
- Voice notes are transcribed to text (when transcription is configured) and stored as feedback for the developer to-do list
- Optional phone, email, and comments submitted on the public contact form (stored in the developer feedback to-do list in SQLite)

### Impact analytics (aggregate funder dashboard)

- QR scans and shared-link clicks (campaign id, timestamp)
- Clicks from the bot to official program apply pages (program id, timestamp)
- “Add to my to do list” follow-through taps
- Coarse location only: QR poster placement coordinates, and optionally city-level IP geolocation (rounded; never street address)

## What we do **not** collect (v2)

- Document uploads as a required product step (ID, pay stubs, bills) — if you send a file anyway, file metadata may be logged as above
- Payment information
- Marketing email lists (optional email on the contact form is for replies only; “Email report to my computer” opens your own Mail app with a download link and does not send us the address)
- Phone numbers unless you tap Telegram’s share-contact control or optionally enter one on the contact form
- Precise GPS unless you share a location
- Raw IP addresses stored long-term (looked up briefly for city-level map dots, then discarded)

## How we use data

- To run your session and send next-steps / reminder messages
- To improve the demo UX via quiet QC logs (`data/responses.jsonl`) and the developer feedback to-do list
- To transcribe alpha voice feedback to text (OpenAI Whisper when `OPENAI_API_KEY` is configured)
- To operate the demo and inspect Telegram-visible profile/message fields in SQLite
- To publish **aggregate** impact metrics on the public funder dashboard (`/impact`)

We do not sell your data. This demo does not send your Telegram profile or messages to third-party marketers. Voice audio is sent to the transcription provider only when you send a voice note and a key is configured.

## Retention & deletion

- Message **STOP** to pause deadline reminders only (your session and to-do list stay; message again to resume reminders).
- Use **Help → Erase all my data** / type **erase** to delete your session, Telegram user/message rows, todos, reminder flags, your QC log rows, and your alpha feedback to-do rows.
- Aggregate impact counts (anonymized event totals) may remain on the funder dashboard after you erase your session.
- Hosting operators may wipe the demo database when the demo ends.

## Developer area access (humans only)

The Developer tools at `/dev` (corpus watch / scan UI) are for **authorized human operators only**.

- Robots, crawlers, scrapers, automated scripts, AI agents, bots, and any other non-human systems are **prohibited** from logging in to or accessing the Developer page or its APIs (`/api/dev/*`).
- Access requires a shared operator password, a CAPTCHA challenge, and an explicit human attestation checkbox.
- `robots.txt` and `X-Robots-Tag: noindex, nofollow` mark the Developer area as off-limits to automated agents.
- This rule does not restrict people from using the public funder dashboard at `/impact` or the Telegram bot.

## Not affiliated

Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or any agency. Estimates only — not tax, legal, or benefits advice. Dollar totals on the impact site are corpus estimates × follow-throughs, not verified payouts.

## Contact

Demo operator: Jay Hasty (portfolio project).
