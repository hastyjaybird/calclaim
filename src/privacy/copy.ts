/** Public privacy policy (GitHub); Telegram auto-linkifies this in messages. */
export const PRIVACY_POLICY_URL =
  "https://github.com/hastyjaybird/calclaim/blob/main/PRIVACY.md";

export const HELP_MENU_TEXT = `Help – type one of these anytime:

• stop – pause deadline reminders (keeps your data; message again to resume)
• guide – resend your Application Guide
• share – get a link or QR code for someone else
• restart – start over from the beginning (clears your Application Guide)
• erase – delete all your CalClaim data from this session

Or pick a button below:`;

export const PRIVACY_SHORT =
  "We do not sell your data or send it to third-party marketers.";

/** Prompt after Help → Leave feedback. */
export const FEEDBACK_PROMPT =
  "What feedback would you like to share? You can send text, a voice message, or a picture.";

export const ABOUT_TEXT = `CalClaim finds help with food, health coverage, phone discounts, energy bills, and more – and gives you a personalized Application Guide for California and federal programs to make it easier to apply.

Estimates only. Not affiliated with PG&E, DHCS, CDSS, USDA, FCC, IRS, or any agency. Not tax, legal, or benefits advice. For tax credits or filing questions, consult a tax professional or a free VITA site. Official agencies decide eligibility.

CalClaim currently focuses more on California state benefits than federal ones. The federal programs shown are not exhaustive, and neither list is a complete catalog of available aid. Energy / utility programs (CARE, ESA, etc.) are just some of the programs in the list.

Please share if you'd like us to include a missing program, or if you found something incorrect – we'd be grateful for your feedback. Tap Leave feedback below.`;

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
