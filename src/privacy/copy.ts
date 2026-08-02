/** Public privacy policy (GitHub); Telegram auto-linkifies this in messages. */
export const PRIVACY_POLICY_URL =
  "https://github.com/hastyjaybird/calclaim/blob/main/PRIVACY.md";

export const HELP_MENU_TEXT = `Help — type one of these anytime:

• stop — pause deadline reminders (keeps your data; message again to resume)
• to do — resend your to-do list / benefits report
• email — open your email app with a link to your report (for your computer)
• share — get a link or QR code for someone else
• restart — start over from the beginning (clears your to-do list)
• erase — delete all your CalClaim data from this session

We store Telegram profile info and messages to run this demo. We do not sell your data or send it to third-party marketers.
Privacy policy: ${PRIVACY_POLICY_URL}

Or pick a button below:`;

export const PRIVACY_SHORT = `Privacy (short):
• We store Telegram user id, name, username, language, and your messages/taps in our demo database.
• Phone/location only if you share them in Telegram.
• We do not sell your data or send it to third-party marketers.
• Type STOP to pause reminders (keeps your data). Type erase to delete your data.

Full policy: ${PRIVACY_POLICY_URL}`;

export const ABOUT_TEXT = `CalClaim helps California people find financial aid and benefits — food, health, phone discounts, energy bill help, and more.

Estimates only. Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or any agency. Not tax, legal, or benefits advice. Official agencies decide eligibility.

Energy / utility programs (CARE, ESA, etc.) are just some of the programs in the list — not the whole product.`;

/** Soft default when we capture free-form alpha feedback (then re-show last prompt). */
export const THANKS_FEEDBACK = "Thanks for your feedback!";

/** Shared household vs roommate blurb — reuse on every screen that says “household”. */
export const HOUSEHOLD_EXPLAIN = `Your household = people who share money with you (buy food together, share bills, or depend on each other).
Not your household = roommates who keep their rent/food money separate.`;

/** @deprecated use THANKS_FEEDBACK — kept for older docs references */
export const THANKS_REDIRECT = THANKS_FEEDBACK;
