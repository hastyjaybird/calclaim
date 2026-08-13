/** Public privacy policy (GitHub); Telegram auto-linkifies this in messages. */
export const PRIVACY_POLICY_URL =
  "https://github.com/hastyjaybird/calclaim/blob/main/PRIVACY.md";

export const HELP_MENU_TEXT = `Help – type one of these anytime:

• stop – pause deadline reminders (keeps your data; message again to resume)
• guide – resend your Application Guide
• email – open your email app with a link to your Application Guide (for your computer)
• share – get a link or QR code for someone else
• restart – start over from the beginning (clears your Application Guide)
• erase – delete all your CalClaim data from this session

We store Telegram profile info and messages to run this demo. We do not sell your data or send it to third-party marketers.
Privacy policy: ${PRIVACY_POLICY_URL}

Or pick a button below:`;

export const PRIVACY_SHORT = `Privacy (short):
• We store Telegram user id, name, username, language, and your messages/taps in our demo database.
• Home ZIP only when needed to check a county-specific program (e.g. CMSP).
• Immigration status is asked only when needed for later programs – your answer is not stored and is not connected to your phone number.
• Phone/location only if you share them in Telegram.
• Street + city for the optional PG&E shut-off check is looked up once, then discarded (we keep only yes/no). If you share location, we snap to the nearest street for that same check and do not keep GPS or the street.
• Friend-share links use an anonymous code so we can count clicks – not who you sent them to.
• We do not sell your data or send it to third-party marketers.
• Type STOP to pause reminders (keeps your data). Type erase to delete your data.

Full policy: ${PRIVACY_POLICY_URL}`;

export const ABOUT_TEXT = `CalClaim finds help with food, health coverage, phone discounts, energy bills, and more – and gives you a personalized Application Guide for California and federal programs to make it easier to apply.

Estimates only. Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or any agency. Not tax, legal, or benefits advice. Official agencies decide eligibility.

Energy / utility programs (CARE, ESA, etc.) are just some of the programs in the list – not the whole product.`;

/** Soft default when we capture free-form alpha feedback (then re-show last prompt). */
export const THANKS_FEEDBACK = "Thanks for your feedback!";

/** Shared household vs roommate blurb – reuse on every screen that says “household”. */
export const HOUSEHOLD_EXPLAIN =
  "Your household = people who share money with you (buy food together, share bills, or depend on each other). Not roommates who keep their rent/food money separate.";

/** Immigration-status gate – asked last; answer is process-memory only. */
export const IMMIGRATION_STATUS_PROMPT = `A few programs are based on immigration status. There may be California programs available specifically for non-citizens.

Are you a U.S. citizen or an eligible immigrant?

Your answer is not stored and is not connected to your phone number – it is completely private. We only use it once to decide which programs to show you next.`;

/** @deprecated use THANKS_FEEDBACK – kept for older docs references */
export const THANKS_REDIRECT = THANKS_FEEDBACK;
