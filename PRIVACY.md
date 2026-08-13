# CalClaim Privacy Policy (demo)

**Product:** CalClaim v2 – California financial aid / benefits navigator (Telegram)  
**Last updated:** 2026-08-12

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

- Answers you tap (gate, household size, income band, ZIP when needed for county-specific programs, offer actions)
- Immigration status (citizen / eligible immigrant / no / prefer not to say) is asked only when needed for later programs. **That answer is not stored** in your session, QC logs, or Telegram message capture, and is cleared from memory when your queue finishes, you restart, or you erase data.
- Next-steps todo items and deadlines derived from our frozen program library
- Free-form text or voice notes you send that are not a recognized button/command (alpha feedback / developer quality control)
- Voice notes are transcribed to text (when transcription is configured) and stored as feedback for the developer To Do List
- Optional email and comments submitted on the public contact form (stored in the developer feedback To Do List in SQLite)
- Partner signup: organization name, work email, and optional city (stored in SQLite `partner_signups`; used to email the QR kit and power the partner status page)
- Optional gifts on the public site: gift amount, monthly vs one-time, and Stripe payment / subscription ids (SQLite `donations`). Card numbers, bank account numbers, and PayPal credentials are collected by Stripe / PayPal, not by CalClaim.

### Impact analytics (aggregate funder dashboard)

- QR scans and shared-link clicks (campaign id, timestamp). Friend-share links use an anonymous per-person code so we can tell organization outreach from people sharing with friends – we do not store who a link was sent to.
- Clicks from the bot to official program apply pages (program id, timestamp)
- “Add to My Application Guide” follow-through taps
- Coarse location only: QR poster placement coordinates, and optionally city-level IP geolocation (rounded; never street address)

## What we do **not** collect (v2)

- Document uploads as a required product step (ID, pay stubs, bills) – if you send a file anyway, file metadata may be logged as above
- Card numbers, bank account numbers, or PayPal passwords. Optional gifts are processed by Stripe and PayPal; we do not store those details.
- Marketing email lists (optional email on the contact form is for replies only; partner signup email is only for delivering that partner’s QR kit; “Email Application Guide to my computer” opens your own Mail app with a download link and does not send us the address)
- Phone numbers unless you tap Telegram’s share-contact control
- Precise GPS unless you share a location
- Raw IP addresses stored long-term (looked up briefly for city-level map dots, then discarded)

## How we use data

- To run your session and send next-steps / reminder messages
- To improve the demo UX via quiet QC logs (`data/responses.jsonl`), the developer feedback To Do List, and aggregate time-on-screen stats on `/dev` (derived from existing screen timestamps)
- To transcribe alpha voice feedback to text (OpenAI Whisper when `OPENAI_API_KEY` is configured)
- To operate the demo and inspect Telegram-visible profile/message fields in SQLite
- To publish **aggregate** impact metrics on the public funder dashboard (`/impact`)
- Street + city typed for the optional PG&E shut-off / fire-threat check is sent once to a US Census address standardizer and to PG&E’s map lookup, then discarded. If you share location, we reverse-geocode to the nearest street for that same check and do not keep GPS or the street. We store only the yes/no result.

We do not sell your data. This demo does not send your Telegram profile or messages to third-party marketers. Voice audio is sent to the transcription provider only when you send a voice note and a key is configured. Optional website gifts are processed by Stripe and PayPal; CalClaim does not store card or bank numbers.

## Retention & deletion

- Message **STOP** to pause deadline reminders only (your session and Application Guide stay; message again to resume reminders).
- Use **Help → Erase all my data** / type **erase** to delete your session, Telegram user/message rows, todos, reminder flags, your QC log rows, and your alpha feedback to-do rows.
- Aggregate impact counts (anonymized event totals) may remain on the funder dashboard after you erase your session.
- Hosting operators may wipe the demo database when the demo ends.

## Developer area access (humans only)

The Developer tools at `/dev` (library watch / scan UI) are for **authorized human operators only**.

- Robots, crawlers, scrapers, automated scripts, AI agents, bots, and any other non-human systems are **prohibited** from logging in to or accessing the Developer page or its APIs (`/api/dev/*`).
- Access requires a shared operator password, a CAPTCHA challenge, and an explicit human attestation checkbox.
- `robots.txt` and `X-Robots-Tag: noindex, nofollow` mark the Developer area as off-limits to automated agents.
- This rule does not restrict people from using the public funder dashboard at `/impact` or the Telegram bot.

## Not affiliated

Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or any agency. Estimates only – not tax, legal, or benefits advice. Dollar totals on the impact site are library estimates × follow-throughs, not verified payouts.

## Contact

Demo operator: Jay Hasty (portfolio project).
