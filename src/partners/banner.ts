import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ROOT } from "../config.js";
import { renderShareQrPng } from "../bot/share.js";

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * Printable landscape booth placard: CalClaim logo, partner name, and unique QR.
 * Letter landscape (11×8.5") — fits a table tent or booth easel.
 */
export async function renderPartnerBoothBannerPdf(input: {
  partnerName: string;
  partnerId: string;
  qrTargetUrl: string;
}): Promise<Buffer> {
  const qrPng = await renderShareQrPng(input.qrTargetUrl);
  const logoPath = path.join(
    ROOT,
    "public/brand/calclaim-logo-horizontal-v2-fraunces.png",
  );
  const logoBuf = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  const doc = new PDFDocument({
    size: "LETTER",
    layout: "landscape",
    margins: { top: 36, bottom: 36, left: 40, right: 40 },
    info: {
      Title: `CalClaim booth banner — ${input.partnerName}`,
      Author: "CalClaim",
    },
  });
  const done = collectPdf(doc);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 40;

  // Soft paper wash
  doc.save();
  doc.rect(0, 0, pageW, pageH).fill("#eef4f1");
  doc.restore();

  // Leaf accent bar at top
  doc.save();
  doc.rect(0, 0, pageW, 10).fill("#0d7a5f");
  doc.restore();

  const contentTop = 48;
  const leftColW = pageW * 0.52;
  const qrSize = 280;

  if (logoBuf) {
    doc.image(logoBuf, margin, contentTop, { fit: [220, 146] });
  } else {
    doc
      .fillColor("#084d3d")
      .font("Helvetica-Bold")
      .fontSize(28)
      .text("CalClaim", margin, contentTop);
  }

  const nameTop = contentTop + 160;
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(28)
    .text(input.partnerName, margin, nameTop, {
      width: leftColW - 20,
      align: "left",
    });

  const afterName = doc.y + 12;
  doc
    .fillColor("#3a5550")
    .font("Helvetica")
    .fontSize(14)
    .text(
      "Scan to find California benefits help — food, health, phone discounts, energy bill aid, and more.",
      margin,
      afterName,
      { width: leftColW - 20 },
    );

  doc
    .fillColor("#084d3d")
    .font("Helvetica")
    .fontSize(11)
    .text(`Partner ID: ${input.partnerId}`, margin, pageH - 56, {
      width: leftColW - 20,
    });

  const qrX = pageW - margin - qrSize;
  const qrY = (pageH - qrSize) / 2 + 8;

  // White pad behind QR for print contrast
  doc.save();
  doc
    .roundedRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 52, 12)
    .fill("#ffffff");
  doc.restore();

  doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .fillColor("#10241f")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Scan with your phone", qrX - 16, qrY + qrSize + 8, {
      width: qrSize + 32,
      align: "center",
    });

  doc.end();
  return done;
}
