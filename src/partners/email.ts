import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { DATA_DIR } from "../config.js";
import type { SignedUpPartner } from "./db.js";

export interface PartnerWelcomeEmailPayload {
  partner: SignedUpPartner;
  statusUrl: string;
  qrUrl: string;
  bannerUrl: string;
  qrPng: Buffer;
  bannerPdf: Buffer;
}

export interface SendPartnerEmailResult {
  ok: boolean;
  mode: "smtp" | "outbox";
  detail: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildWelcomeHtml(payload: PartnerWelcomeEmailPayload): string {
  const { partner, statusUrl, qrUrl, bannerUrl } = payload;
  const name = escapeHtml(partner.name);
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef4f1;font-family:Georgia,'Times New Roman',serif;color:#10241f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f1;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
          <tr>
            <td style="background:#0d7a5f;padding:18px 28px;color:#f7f3ea;font-family:Figtree,Helvetica,Arial,sans-serif;font-size:14px;letter-spacing:0.04em;">
              CalClaim · Partner welcome
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-family:Figtree,Helvetica,Arial,sans-serif;">
              <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;color:#084d3d;">Welcome, ${name}</h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#3a5550;">
                Thanks for partnering with CalClaim. Your unique partner ID is
                <strong style="color:#10241f;">${escapeHtml(partner.id)}</strong>.
              </p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#3a5550;">
                Every scan of your QR code credits <strong>${name}</strong> on the community partner leaderboard.
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#084d3d;font-weight:700;">Your partner status page</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.45;">
                <a href="${escapeHtml(statusUrl)}" style="color:#0d7a5f;">${escapeHtml(statusUrl)}</a>
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#084d3d;font-weight:700;">Your unique QR code</p>
              <p style="margin:0 0 10px;font-size:15px;line-height:1.45;color:#3a5550;">
                Attached as <code>calclaim-qr.png</code>, or open:
                <a href="${escapeHtml(qrUrl)}" style="color:#0d7a5f;">${escapeHtml(qrUrl)}</a>
              </p>
              <p style="margin:0 0 18px;text-align:center;">
                <img src="cid:partner-qr" alt="Your CalClaim partner QR code" width="220" height="220" style="display:inline-block;border:0;" />
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#084d3d;font-weight:700;">Booth banner (print this)</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.45;color:#3a5550;">
                Attached as <code>calclaim-booth-banner.pdf</code> — page 1 is a full booth placard; page 2 has two half-page fliers to cut and hand out (CalClaim logo, your company name, and your QR).
                <br /><a href="${escapeHtml(bannerUrl)}" style="color:#0d7a5f;">Download booth banner</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.45;color:#3a5550;">
                Questions? Reply to this email or use the contact form on the CalClaim impact site.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;font-family:Figtree,Helvetica,Arial,sans-serif;font-size:12px;color:#3a5550;">
              CalClaim demo · Community outreach partner · Not an official agency affiliation
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildWelcomeText(payload: PartnerWelcomeEmailPayload): string {
  const { partner, statusUrl, qrUrl, bannerUrl } = payload;
  return `Welcome, ${partner.name}

Thanks for partnering with CalClaim. Your unique partner ID is ${partner.id}.

Every scan of your QR code credits ${partner.name} on the community partner leaderboard.

Your partner status page:
${statusUrl}

Your unique QR code (also attached as calclaim-qr.png):
${qrUrl}

Booth banner to print (also attached as calclaim-booth-banner.pdf) — page 1 is a full booth placard; page 2 has two half-page fliers to cut and hand out:
${bannerUrl}

Questions? Reply to this email or use the contact form on the CalClaim impact site.

— CalClaim
`;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendViaSmtp(payload: PartnerWelcomeEmailPayload): Promise<SendPartnerEmailResult> {
  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const from = process.env.SMTP_FROM!;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  await transporter.sendMail({
    from,
    to: payload.partner.email,
    subject: `Welcome to CalClaim — your partner kit (${payload.partner.id})`,
    text: buildWelcomeText(payload),
    html: buildWelcomeHtml(payload),
    attachments: [
      {
        filename: "calclaim-qr.png",
        content: payload.qrPng,
        cid: "partner-qr",
        contentType: "image/png",
      },
      {
        filename: "calclaim-booth-banner.pdf",
        content: payload.bannerPdf,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    ok: true,
    mode: "smtp",
    detail: `Sent welcome email to ${payload.partner.email}`,
  };
}

async function writeOutbox(payload: PartnerWelcomeEmailPayload): Promise<SendPartnerEmailResult> {
  const outDir = path.join(DATA_DIR, "mail-outbox");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `partner-welcome-${payload.partner.slug}-${stamp}`;
  const htmlPath = path.join(outDir, `${base}.html`);
  const txtPath = path.join(outDir, `${base}.txt`);
  const metaPath = path.join(outDir, `${base}.json`);
  const qrPath = path.join(outDir, `${base}-qr.png`);
  const bannerPath = path.join(outDir, `${base}-banner.pdf`);

  fs.writeFileSync(htmlPath, buildWelcomeHtml(payload), "utf8");
  fs.writeFileSync(txtPath, buildWelcomeText(payload), "utf8");
  fs.writeFileSync(qrPath, payload.qrPng);
  fs.writeFileSync(bannerPath, payload.bannerPdf);
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        to: payload.partner.email,
        subject: `Welcome to CalClaim — your partner kit (${payload.partner.id})`,
        partnerId: payload.partner.id,
        slug: payload.partner.slug,
        statusUrl: payload.statusUrl,
        qrUrl: payload.qrUrl,
        bannerUrl: payload.bannerUrl,
        writtenAt: new Date().toISOString(),
        note: "SMTP not configured — email written to mail-outbox for local demo.",
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `[partner-email] SMTP unset — wrote welcome kit to ${outDir} (to: ${payload.partner.email})`,
  );

  return {
    ok: true,
    mode: "outbox",
    detail: `SMTP not configured; wrote kit to ${outDir}`,
  };
}

/** Send welcome email via SMTP when configured; otherwise write a local outbox kit. */
export async function sendPartnerWelcomeEmail(
  payload: PartnerWelcomeEmailPayload,
): Promise<SendPartnerEmailResult> {
  if (smtpConfigured()) {
    try {
      return await sendViaSmtp(payload);
    } catch (err) {
      console.error("[partner-email] SMTP send failed, falling back to outbox:", err);
      const fallback = await writeOutbox(payload);
      return {
        ...fallback,
        detail: `SMTP failed; ${fallback.detail}`,
      };
    }
  }
  return writeOutbox(payload);
}
