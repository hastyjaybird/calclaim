import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ROOT } from "../config.js";
import { renderShareQrPng } from "../bot/share.js";

const CALCLAIM_LOGO = path.join(
  ROOT,
  "public/brand/calclaim-logo-horizontal-v2-fraunces-cropped.png",
);

const TAGLINE =
  "Scan to find California benefits help — food, health, phone discounts, energy bill aid, and more.";

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

function drawBoothBannerPage(
  doc: PDFKit.PDFDocument,
  input: {
    partnerName: string;
    partnerId: string;
    qrPng: Buffer;
    calclaimBuf: Buffer | null;
    partnerLogoBuf: Buffer | null;
  },
): void {
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

  if (input.calclaimBuf) {
    doc.image(input.calclaimBuf, margin, y, { fit: [contentW * 0.72, 90] });
    y += 110;
  } else {
    doc
      .fillColor("#084d3d")
      .font("Helvetica-Bold")
      .fontSize(32)
      .text("CalClaim", margin, y, { width: contentW });
    y += 48;
  }

  if (input.partnerLogoBuf) {
    const logoBox = 120;
    const logoX = margin + (contentW - logoBox) / 2;
    doc.save();
    doc.roundedRect(logoX - 8, y - 8, logoBox + 16, logoBox + 16, 10).fill("#ffffff");
    doc.restore();
    doc.image(input.partnerLogoBuf, logoX, y, {
      fit: [logoBox, logoBox],
      align: "center",
      valign: "center",
    });
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
    .text(TAGLINE, margin, y, { width: contentW, align: "center" });
  y = doc.y + 28;

  const qrSize = Math.min(300, contentW * 0.72);
  const qrX = margin + (contentW - qrSize) / 2;
  const qrPad = 18;
  const qrBlockBottom = y + qrSize + qrPad * 2 + 28;
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

  doc.image(input.qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Scan with your phone", qrX - qrPad, qrY + qrSize + 6, {
      width: qrSize + qrPad * 2,
      align: "center",
      lineBreak: false,
    });

  // Avoid PDFKit auto-paging when the footer sits near the bottom margin
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .fillColor("#084d3d")
    .font("Helvetica")
    .fontSize(11)
    .text(`Partner ID: ${input.partnerId}`, margin, pageH - 52, {
      width: contentW,
      align: "center",
      lineBreak: false,
    });
  doc.page.margins.bottom = savedBottom;
}

/**
 * Half-letter flier (8.5" × 5.5") for cut-and-handout use.
 * Landscape composition: copy on the left, QR on the right.
 */
function drawHalfPageFlier(
  doc: PDFKit.PDFDocument,
  bounds: { x: number; y: number; w: number; h: number },
  input: {
    partnerName: string;
    partnerId: string;
    qrPng: Buffer;
    calclaimBuf: Buffer | null;
    partnerLogoBuf: Buffer | null;
  },
): void {
  const pad = 28;
  const { x, y, w, h } = bounds;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  doc.save();
  doc.rect(x, y, w, h).fill("#eef4f1");
  doc.restore();

  doc.save();
  doc.rect(x, y, w, 8).fill("#0d7a5f");
  doc.restore();

  // Thin edge so the cut pieces still feel finished
  doc.save();
  doc.lineWidth(0.75).strokeColor("#c5d4ce");
  doc.rect(x + 0.4, y + 0.4, w - 0.8, h - 0.8).stroke();
  doc.restore();

  const qrSize = Math.min(168, innerH - 36);
  const qrPad = 12;
  const qrBlockW = qrSize + qrPad * 2;
  const qrX = x + w - pad - qrBlockW + qrPad;
  const qrY = y + (h - qrSize - 22) / 2;

  const copyW = Math.max(160, qrX - qrPad - 16 - innerX);

  let cy = innerY + 4;

  if (input.calclaimBuf) {
    doc.image(input.calclaimBuf, innerX, cy, { fit: [copyW * 0.92, 52] });
    cy += 60;
  } else {
    doc
      .fillColor("#084d3d")
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("CalClaim", innerX, cy, { width: copyW });
    cy += 30;
  }

  if (input.partnerLogoBuf) {
    const logoBox = 48;
    doc.save();
    doc.roundedRect(innerX - 4, cy - 4, logoBox + 8, logoBox + 8, 6).fill("#ffffff");
    doc.restore();
    doc.image(input.partnerLogoBuf, innerX, cy, {
      fit: [logoBox, logoBox],
      align: "center",
      valign: "center",
    });
    cy += logoBox + 12;
  }

  const nameMaxH = 44;
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(input.partnerName, innerX, cy, {
      width: copyW,
      height: nameMaxH,
      align: "left",
      ellipsis: true,
    });
  cy = Math.min(doc.y + 8, cy + nameMaxH + 8);

  const taglineMaxH = Math.max(36, qrY + qrSize - cy - 8);
  doc
    .fillColor("#3a5550")
    .font("Helvetica")
    .fontSize(11)
    .text(TAGLINE, innerX, cy, {
      width: copyW,
      height: taglineMaxH,
      align: "left",
      ellipsis: true,
    });

  doc.save();
  doc
    .roundedRect(qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2 + 22, 10)
    .fill("#ffffff");
  doc.restore();

  doc.image(input.qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Scan with your phone", qrX - qrPad, qrY + qrSize + 4, {
      width: qrSize + qrPad * 2,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor("#084d3d")
    .font("Helvetica")
    .fontSize(8)
    .text(`Partner ID: ${input.partnerId}`, innerX, y + h - pad - 4, {
      width: innerW,
      align: "left",
      lineBreak: false,
    });
}

function drawCutGuide(doc: PDFKit.PDFDocument, pageW: number, midY: number): void {
  doc.save();
  doc
    .strokeColor("#7a938c")
    .lineWidth(0.9)
    .dash(5, { space: 4 })
    .moveTo(0, midY)
    .lineTo(pageW, midY)
    .stroke();
  doc.undash();
  doc.restore();
}

/**
 * Printable kit (letter portrait):
 *  1. Full-page vertical booth placard
 *  2. Two half-page (8.5" × 5.5") fliers for cut-and-handout
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

  const shared = {
    partnerName: input.partnerName,
    partnerId: input.partnerId,
    qrPng,
    calclaimBuf,
    partnerLogoBuf,
  };

  drawBoothBannerPage(doc, shared);

  // Page 2: two half-letter fliers stacked for print + cut
  doc.addPage({ size: "LETTER", layout: "portrait", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const halfH = pageH / 2;

  drawHalfPageFlier(doc, { x: 0, y: 0, w: pageW, h: halfH }, shared);
  drawHalfPageFlier(doc, { x: 0, y: halfH, w: pageW, h: halfH }, shared);
  drawCutGuide(doc, pageW, halfH);

  doc.end();
  return done;
}
