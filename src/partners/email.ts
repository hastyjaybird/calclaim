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

export interface PartnerVerifyEmailPayload {
  partner: SignedUpPartner;
  verifyUrl: string;
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
                Your email is verified. Your unique partner ID is
                <strong style="color:#10241f;">${escapeHtml(partner.id)}</strong>.
              </p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#3a5550;">
                ${
                  partner.accountType === "organization"
                    ? `Every scan of your QR code credits <strong>${name}</strong> on the public community partner leaderboard.`
                    : `Every scan of your QR code is tracked on your private status page (individuals are not listed on the public leaderboard).`
                }
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
                Attached as <code>calclaim-booth-banner.pdf</code> – page 1 is a full booth placard; page 2 has two half-page fliers (same layout, rotated) to cut and hand out.
                <br /><a href="${escapeHtml(bannerUrl)}" style="color:#0d7a5f;">Download booth banner</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.45;color:#3a5550;">
                Questions? Reply to this email or use the contact form on the CalClaim impact site.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;font-family:Figtree,Helvetica,Arial,sans-serif;font-size:12px;color:#3a5550;">
              CalClaim demo · Verified partner account · Not an official agency affiliation
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

Your email is verified. Your unique partner ID is ${partner.id}.

${
    partner.accountType === "organization"
      ? `Every scan of your QR code credits ${partner.name} on the public community partner leaderboard.`
      : `Every scan of your QR code is tracked on your private status page (individuals are not listed on the public leaderboard).`
  }

Your partner status page:
${statusUrl}

Your unique QR code (also attached as calclaim-qr.png):
${qrUrl}

Booth banner to print (also attached as calclaim-booth-banner.pdf) – page 1 is a full booth placard; page 2 has two half-page fliers (same layout, rotated) to cut and hand out:
${bannerUrl}

Questions? Reply to this email or use the contact form on the CalClaim impact site.

– CalClaim
`;
}

function buildVerifyHtml(payload: PartnerVerifyEmailPayload): string {
  const { partner, verifyUrl } = payload;
  const name = escapeHtml(partner.name);
  const domain = escapeHtml(partner.emailDomain || "");
  const accountLabel =
    partner.accountType === "individual"
      ? "individual partner"
      : "organization partner";
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#eef4f1;font-family:Georgia,'Times New Roman',serif;color:#10241f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f1;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">
          <tr>
            <td style="background:#0d7a5f;padding:18px 28px;color:#f7f3ea;font-family:Figtree,Helvetica,Arial,sans-serif;font-size:14px;letter-spacing:0.04em;">
              CalClaim · Verify your email
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;font-family:Figtree,Helvetica,Arial,sans-serif;">
              <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;color:#084d3d;">Confirm ${name}</h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#3a5550;">
                Someone signed up as a CalClaim ${accountLabel} using
                <strong style="color:#10241f;">${escapeHtml(partner.email)}</strong>.
              </p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#3a5550;">
                Click below to verify this email${
                  partner.accountType === "organization" && domain
                    ? ` and confirm the <strong>@${domain}</strong> organization domain`
                    : ""
                }. Your QR kit unlocks after verification.
              </p>
              <p style="margin:0 0 22px;">
                <a href="${escapeHtml(verifyUrl)}"
                   style="display:inline-block;background:#0d7a5f;color:#f7f3ea;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:15px;">
                  Verify email address
                </a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:#3a5550;">
                Or paste this link into your browser:
              </p>
              <p style="margin:0 0 18px;font-size:13px;line-height:1.45;word-break:break-all;">
                <a href="${escapeHtml(verifyUrl)}" style="color:#0d7a5f;">${escapeHtml(verifyUrl)}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.45;color:#3a5550;">
                If you did not sign up for CalClaim, ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;font-family:Figtree,Helvetica,Arial,sans-serif;font-size:12px;color:#3a5550;">
              CalClaim demo · Email verification · Link expires in 48 hours
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildVerifyText(payload: PartnerVerifyEmailPayload): string {
  const { partner, verifyUrl } = payload;
  const domainNote =
    partner.accountType === "organization" && partner.emailDomain
      ? ` This also confirms the @${partner.emailDomain} organization domain.`
      : "";
  return `Confirm ${partner.name}

Someone signed up as a CalClaim partner using ${partner.email}.${domainNote}

Verify your email to unlock your QR kit:
${verifyUrl}

If you did not sign up for CalClaim, ignore this email.

– CalClaim
`;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: nodemailer.SendMailOptions["attachments"];
}): Promise<void> {
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
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
}

async function writeOutboxFile(opts: {
  kind: string;
  slug: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  extra?: Record<string, unknown>;
  binaries?: Array<{ suffix: string; buffer: Buffer }>;
}): Promise<string> {
  const outDir = path.join(DATA_DIR, "mail-outbox");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${opts.kind}-${opts.slug}-${stamp}`;
  fs.writeFileSync(path.join(outDir, `${base}.html`), opts.html, "utf8");
  fs.writeFileSync(path.join(outDir, `${base}.txt`), opts.text, "utf8");
  for (const bin of opts.binaries ?? []) {
    fs.writeFileSync(path.join(outDir, `${base}${bin.suffix}`), bin.buffer);
  }
  fs.writeFileSync(
    path.join(outDir, `${base}.json`),
    JSON.stringify(
      {
        to: opts.to,
        subject: opts.subject,
        kind: opts.kind,
        writtenAt: new Date().toISOString(),
        note: "SMTP not configured – email written to mail-outbox for local demo.",
        ...opts.extra,
      },
      null,
      2,
    ),
    "utf8",
  );
  return outDir;
}

/** Send welcome email via SMTP when configured; otherwise write a local outbox kit. */
export async function sendPartnerWelcomeEmail(
  payload: PartnerWelcomeEmailPayload,
): Promise<SendPartnerEmailResult> {
  const subject = `Welcome to CalClaim – your partner kit (${payload.partner.id})`;
  const text = buildWelcomeText(payload);
  const html = buildWelcomeHtml(payload);
  const attachments = [
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
  ];

  if (smtpConfigured()) {
    try {
      await sendMail({
        to: payload.partner.email,
        subject,
        text,
        html,
        attachments,
      });
      return {
        ok: true,
        mode: "smtp",
        detail: `Sent welcome email to ${payload.partner.email}`,
      };
    } catch (err) {
      console.error("[partner-email] SMTP send failed, falling back to outbox:", err);
      const outDir = await writeOutboxFile({
        kind: "partner-welcome",
        slug: payload.partner.slug,
        to: payload.partner.email,
        subject,
        text,
        html,
        extra: {
          partnerId: payload.partner.id,
          slug: payload.partner.slug,
          statusUrl: payload.statusUrl,
          qrUrl: payload.qrUrl,
          bannerUrl: payload.bannerUrl,
        },
        binaries: [
          { suffix: "-qr.png", buffer: payload.qrPng },
          { suffix: "-banner.pdf", buffer: payload.bannerPdf },
        ],
      });
      return {
        ok: true,
        mode: "outbox",
        detail: `SMTP failed; wrote kit to ${outDir}`,
      };
    }
  }

  const outDir = await writeOutboxFile({
    kind: "partner-welcome",
    slug: payload.partner.slug,
    to: payload.partner.email,
    subject,
    text,
    html,
    extra: {
      partnerId: payload.partner.id,
      slug: payload.partner.slug,
      statusUrl: payload.statusUrl,
      qrUrl: payload.qrUrl,
      bannerUrl: payload.bannerUrl,
    },
    binaries: [
      { suffix: "-qr.png", buffer: payload.qrPng },
      { suffix: "-banner.pdf", buffer: payload.bannerPdf },
    ],
  });
  console.log(
    `[partner-email] SMTP unset – wrote welcome kit to ${outDir} (to: ${payload.partner.email})`,
  );
  return {
    ok: true,
    mode: "outbox",
    detail: `SMTP not configured; wrote kit to ${outDir}`,
  };
}

/** Send email verification magic link. */
export async function sendPartnerVerificationEmail(
  payload: PartnerVerifyEmailPayload,
): Promise<SendPartnerEmailResult> {
  const subject = `Verify your CalClaim partner email (${payload.partner.id})`;
  const text = buildVerifyText(payload);
  const html = buildVerifyHtml(payload);

  if (smtpConfigured()) {
    try {
      await sendMail({
        to: payload.partner.email,
        subject,
        text,
        html,
      });
      return {
        ok: true,
        mode: "smtp",
        detail: `Sent verification email to ${payload.partner.email}`,
      };
    } catch (err) {
      console.error("[partner-email] Verify SMTP failed, falling back to outbox:", err);
      const outDir = await writeOutboxFile({
        kind: "partner-verify",
        slug: payload.partner.slug,
        to: payload.partner.email,
        subject,
        text,
        html,
        extra: {
          partnerId: payload.partner.id,
          slug: payload.partner.slug,
          verifyUrl: payload.verifyUrl,
        },
      });
      return {
        ok: true,
        mode: "outbox",
        detail: `SMTP failed; wrote verification to ${outDir}`,
      };
    }
  }

  const outDir = await writeOutboxFile({
    kind: "partner-verify",
    slug: payload.partner.slug,
    to: payload.partner.email,
    subject,
    text,
    html,
    extra: {
      partnerId: payload.partner.id,
      slug: payload.partner.slug,
      verifyUrl: payload.verifyUrl,
    },
  });
  console.log(
    `[partner-email] SMTP unset – wrote verification to ${outDir} (to: ${payload.partner.email})`,
  );
  console.log(`[partner-email] Verify link: ${payload.verifyUrl}`);
  return {
    ok: true,
    mode: "outbox",
    detail: `SMTP not configured; wrote verification to ${outDir}`,
  };
}
