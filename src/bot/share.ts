import QRCode from "qrcode";
import {
  campaignLandingUrl,
  getBotUsername,
  type AppConfig,
} from "../config.js";

/** Tracked landings for peer shares from Help → Share. */
export {
  SHARE_LINK_CAMPAIGN,
  SHARE_QR_CAMPAIGN,
} from "../analytics/peerShare.js";

const SHARE_BLURB =
  "Find California benefits help with CalClaim – food, health, phone, energy bill programs, and more.";

/** Caption on the peer-share QR: in-person scan or copy/forward the next message. */
export const SHARE_QR_CAPTION =
  "Show this QR to someone standing next to you – they can scan it with their phone camera.\n\nOr copy and forward the message below:";

function telegramSafePublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function botDeepLink(botUsername: string, campaignId: string): string | null {
  const user = getBotUsername(botUsername);
  if (!user) return null;
  return `https://t.me/${user}?start=${encodeURIComponent(campaignId)}`;
}

/** Prefer tracked /go landing; fall back to t.me deep link when public URL isn't phone-reachable. */
export function shareTargetUrl(
  config: AppConfig,
  campaignId: string,
): string | null {
  const landing = campaignLandingUrl(config.publicBaseUrl, campaignId);
  if (telegramSafePublicUrl(landing)) return landing;
  return botDeepLink(config.botUsername, campaignId);
}

export function telegramShareUrl(targetUrl: string): string {
  const params = new URLSearchParams({
    url: targetUrl,
    text: SHARE_BLURB,
  });
  return `https://t.me/share/url?${params.toString()}`;
}

export function buildShareMenuText(linkUrl: string): string {
  return `Share CalClaim with someone who might need benefits help.

Link (copy it, text it, or email it):
${linkUrl}

Or tap below to share in Telegram, or show a QR code they can scan with their phone.`;
}

/** Sample message a user can copy or forward to someone they know. */
export function buildShareForwardText(linkUrl: string): string {
  return `Hey — I found this free bot that helps with California benefits for food, health, phone, and energy bills. CalClaim builds a personalized Application Guide so applying is easier.

Worth checking out:
${linkUrl}`;
}

export async function renderShareQrPng(targetUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(targetUrl, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0b3d2e", light: "#ffffff" },
  });
}
