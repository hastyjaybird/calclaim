import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ROOT } from "../config.js";
import { renderShareQrPng } from "../bot/share.js";

const CALCLAIM_LOGO = path.join(
  ROOT,
  "public/brand/calclaim-logo-horizontal-v2-fraunces-cropped.png",
);

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function resolveLogoBuf(logoPathOrUrl?: string | null): Buffer | null {
  if (!logoPathOrUrl) return null;
  const cleaned = logoPathOrUrl.trim();
  if (!cleaned) return null;
  const abs = cleaned.startsWith("/")
    ? path.join(ROOT, "public", cleaned.replace(/^\//, ""))
    : path.isAbsolute(cleaned)
      ? cleaned
      : path.join(ROOT, cleaned);
  if (!abs.startsWith(path.join(ROOT, "public")) && !abs.startsWith(path.join(ROOT, "data"))) {
    return null;
  }
  return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
}

/**
 * Printable vertical booth placard (letter portrait): CalClaim mark, optional
 * partner logo, partner name, and unique QR.
 */
export async function renderPartnerBoothBannerPdf(input: {
  partnerName: string;
  partnerId: string;
  qrTargetUrl: string;
  partnerLogoPath?: string | null;
}): Promise<Buffer> {
  const qrPng = await renderShareQrPng(input.qrTargetUrl);
  const calclaimBuf = fs.existsSync(CALCLAIM_LOGO)
    ? fs.readFileSync(CALCLAIM_LOGO)
    : null;
  const partnerLogoBuf = resolveLogoBuf(input.partnerLogoPath);

  const doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    info: {
      Title: `CalClaim booth banner — ${input.partnerName}`,
      Author: "CalClaim",
    },
  });
  const done = collectPdf(doc);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 48;
  const contentW = pageW - margin * 2;

  doc.save();
  doc.rect(0, 0, pageW, pageH).fill("#eef4f1");
  doc.restore();

  doc.save();
  doc.rect(0, 0, pageW, 12).fill("#0d7a5f");
  doc.restore();

  let y = 40;

  if (calclaimBuf) {
    doc.image(calclaimBuf, margin, y, { fit: [contentW * 0.72, 90] });
    y += 110;
  } else {
    doc
      .fillColor("#084d3d")
      .font("Helvetica-Bold")
      .fontSize(32)
      .text("CalClaim", margin, y, { width: contentW });
    y += 48;
  }

  if (partnerLogoBuf) {
    const logoBox = 120;
    const logoX = margin + (contentW - logoBox) / 2;
    doc.save();
    doc.roundedRect(logoX - 8, y - 8, logoBox + 16, logoBox + 16, 10).fill("#ffffff");
    doc.restore();
    doc.image(partnerLogoBuf, logoX, y, { fit: [logoBox, logoBox], align: "center", valign: "center" });
    y += logoBox + 28;
  }

  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(30)
    .text(input.partnerName, margin, y, {
      width: contentW,
      align: "center",
    });
  y = doc.y + 16;

  doc
    .fillColor("#3a5550")
    .font("Helvetica")
    .fontSize(14)
    .text(
      "Scan to find California benefits help — food, health, phone discounts, energy bill aid, and more.",
      margin,
      y,
      { width: contentW, align: "center" },
    );
  y = doc.y + 28;

  const qrSize = Math.min(300, contentW * 0.72);
  const qrX = margin + (contentW - qrSize) / 2;
  const qrPad = 18;
  const qrBlockBottom = y + qrSize + qrPad * 2 + 28;
  // Keep QR above the partner ID footer
  const maxQrBottom = pageH - 72;
  let qrY = y;
  if (qrBlockBottom > maxQrBottom) {
    qrY = Math.max(y - (qrBlockBottom - maxQrBottom), y - 20);
  }

  doc.save();
  doc
    .roundedRect(qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2 + 28, 14)
    .fill("#ffffff");
  doc.restore();

  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Scan with your phone", qrX - qrPad, qrY + qrSize + 6, {
      width: qrSize + qrPad * 2,
      align: "center",
    });

  doc
    .fillColor("#084d3d")
    .font("Helvetica")
    .fontSize(11)
    .text(`Partner ID: ${input.partnerId}`, margin, pageH - 52, {
      width: contentW,
      align: "center",
    });

  doc.end();
  return done;
}
