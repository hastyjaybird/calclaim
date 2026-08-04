import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import PDFDocument from "pdfkit";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { ROOT } from "../config.js";

const CALCLAIM_LOGO = path.join(
  ROOT,
  "public/brand/calclaim-logo-horizontal-v2-fraunces-cropped.png",
);

const TAGLINE =
  "Scan to find California benefits help — food, health, phone discounts, energy bill aid, and more.";

/** Letter portrait in PDF points (72 pt/in). */
const LETTER_W = 612;
const LETTER_H = 792;

const INK = "#000000";
const INK_SOFT = "#333333";
const RULE = "#000000";
const PAPER = "#ffffff";

type BannerShared = {
  partnerName: string;
  partnerId: string;
  qrPng: Buffer;
  calclaimBuf: Buffer | null;
  partnerLogoBuf: Buffer | null;
};

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Convert PNG/JPEG buffers to grayscale PNG for B&W print. */
function toGrayscalePng(buf: Buffer): Buffer {
  try {
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) {
      const png = PNG.sync.read(buf);
      for (let i = 0; i < png.data.length; i += 4) {
        const y = Math.round(
          0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2],
        );
        png.data[i] = y;
        png.data[i + 1] = y;
        png.data[i + 2] = y;
      }
      return PNG.sync.write(png);
    }
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) {
      const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
      const data = Buffer.from(decoded.data);
      for (let i = 0; i < data.length; i += 4) {
        const y = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = y;
        data[i + 1] = y;
        data[i + 2] = y;
      }
      const out = new PNG({ width: decoded.width, height: decoded.height });
      data.copy(out.data);
      return PNG.sync.write(out);
    }
  } catch {
    // Fall through — embed original if conversion fails
  }
  return buf;
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
  if (!fs.existsSync(abs)) return null;
  return toGrayscalePng(fs.readFileSync(abs));
}

async function renderBlackQrPng(targetUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(targetUrl, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * Full booth placard layout drawn into an arbitrary rectangle.
 * Coordinate space is local to (bounds.x, bounds.y); caller may transform.
 */
function drawBannerLayout(
  doc: PDFKit.PDFDocument,
  bounds: { x: number; y: number; w: number; h: number },
  input: BannerShared,
): void {
  const { x, y, w, h } = bounds;
  const margin = Math.max(18, Math.min(48, w * 0.078));
  const contentW = w - margin * 2;
  const scale = w / LETTER_W;

  const savedBottom = doc.page.margins.bottom;
  const savedTop = doc.page.margins.top;
  doc.page.margins.bottom = 0;
  doc.page.margins.top = 0;

  doc.save();
  doc.rect(x, y, w, h).fill(PAPER);
  doc.restore();

  // Hairline frame
  doc.save();
  doc.lineWidth(Math.max(0.6, 1 * scale)).strokeColor(RULE);
  doc.rect(x + 0.5, y + 0.5, w - 1, h - 1).stroke();
  doc.restore();

  let cy = y + margin * 0.85;

  if (input.partnerLogoBuf) {
    // Partner logo + name first, CalClaim beside them
    const rowH = Math.min(72 * scale, h * 0.11);
    const logoBox = rowH;
    const gap = 10 * scale;
    const calclaimMaxW = contentW * 0.34;
    const calclaimMaxH = rowH;

    let calclaimDrawW = calclaimMaxW;
    let calclaimDrawH = calclaimMaxH * 0.72;
    if (input.calclaimBuf) {
      // Reserve right column for CalClaim; left gets logo + name
    } else {
      calclaimDrawW = Math.min(calclaimMaxW, 120 * scale);
    }

    const leftW = contentW - calclaimDrawW - gap * 2;
    const nameX = x + margin + logoBox + gap;
    const nameW = Math.max(40, leftW - logoBox - gap);

    doc.image(input.partnerLogoBuf, x + margin, cy, {
      fit: [logoBox, logoBox],
      align: "center",
      valign: "center",
    });

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(Math.max(11, 18 * scale))
      .text(input.partnerName, nameX, cy + rowH * 0.15, {
        width: nameW,
        height: rowH * 0.7,
        align: "left",
        ellipsis: true,
      });

    const calclaimX = x + margin + contentW - calclaimDrawW;
    if (input.calclaimBuf) {
      doc.image(input.calclaimBuf, calclaimX, cy + (rowH - calclaimDrawH) / 2, {
        fit: [calclaimDrawW, calclaimDrawH],
        align: "right",
        valign: "center",
      });
    } else {
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(Math.max(12, 20 * scale))
        .text("CalClaim", calclaimX, cy + rowH * 0.25, {
          width: calclaimDrawW,
          align: "right",
          lineBreak: false,
        });
    }

    cy += rowH + 14 * scale;

    // Divider under co-brand row
    doc.save();
    doc
      .strokeColor(INK)
      .lineWidth(Math.max(0.5, 0.75 * scale))
      .moveTo(x + margin, cy)
      .lineTo(x + margin + contentW, cy)
      .stroke();
    doc.restore();
    cy += 16 * scale;
  } else {
    if (input.calclaimBuf) {
      const logoH = Math.min(90 * scale, h * 0.12);
      doc.image(input.calclaimBuf, x + margin, cy, {
        fit: [contentW * 0.72, logoH],
      });
      cy += logoH + 18 * scale;
    } else {
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(Math.max(18, 32 * scale))
        .text("CalClaim", x + margin, cy, { width: contentW });
      cy += 40 * scale;
    }

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(Math.max(16, 28 * scale))
      .text(input.partnerName, x + margin, cy, {
        width: contentW,
        align: "center",
      });
    cy = doc.y + 12 * scale;
  }

  doc
    .fillColor(INK_SOFT)
    .font("Helvetica")
    .fontSize(Math.max(9, 14 * scale))
    .text(TAGLINE, x + margin, cy, { width: contentW, align: "center" });
  cy = doc.y + 22 * scale;

  const footerReserve = 28 * scale;
  const qrLabelH = 18 * scale;
  const qrPad = 14 * scale;
  const maxQr = Math.min(300 * scale, contentW * 0.72);
  let qrSize = maxQr;
  const availableForQr = y + h - margin - footerReserve - cy - qrPad * 2 - qrLabelH;
  if (availableForQr < qrSize) {
    qrSize = Math.max(120 * scale, availableForQr);
  }

  const qrX = x + margin + (contentW - qrSize) / 2;
  const qrY = cy;

  doc.save();
  doc
    .lineWidth(Math.max(0.6, 1 * scale))
    .strokeColor(RULE)
    .rect(qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2 + qrLabelH)
    .stroke();
  doc.restore();

  doc.image(input.qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(Math.max(8, 12 * scale))
    .text("Scan with your phone", qrX - qrPad, qrY + qrSize + 4 * scale, {
      width: qrSize + qrPad * 2,
      align: "center",
      lineBreak: false,
    });

  // Partner ID — footnote, bottom-right corner
  const idSize = Math.max(7, 9 * scale);
  doc
    .fillColor(INK_SOFT)
    .font("Helvetica")
    .fontSize(idSize)
    .text(input.partnerId, x + margin, y + h - margin * 0.65 - idSize, {
      width: contentW,
      align: "right",
      lineBreak: false,
    });

  doc.page.margins.bottom = savedBottom;
  doc.page.margins.top = savedTop;
}

/**
 * Draw the full portrait placard layout rotated 90° and scaled into bounds
 * (half-letter landscape slot).
 */
function drawRotatedShrunkFlier(
  doc: PDFKit.PDFDocument,
  bounds: { x: number; y: number; w: number; h: number },
  input: BannerShared,
): void {
  // After 90° CW rotation, portrait (LETTER_W × LETTER_H) occupies LETTER_H × LETTER_W
  const scale = Math.min(bounds.w / LETTER_H, bounds.h / LETTER_W);
  const destW = LETTER_H * scale;
  const destH = LETTER_W * scale;
  const ox = bounds.x + (bounds.w - destW) / 2;
  const oy = bounds.y + (bounds.h - destH) / 2;

  doc.save();
  // Origin at top-right of destination box, then 90° CCW → portrait reads as landscape
  doc.translate(ox + destW, oy);
  doc.rotate(90);
  doc.scale(scale);
  drawBannerLayout(doc, { x: 0, y: 0, w: LETTER_W, h: LETTER_H }, input);
  doc.restore();
}

function drawCutGuide(doc: PDFKit.PDFDocument, pageW: number, midY: number): void {
  doc.save();
  doc
    .strokeColor("#666666")
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
 *  1. Full-page vertical booth placard (black & white)
 *  2. Two half-page fliers: same layout, rotated 90° and shrunk
 */
export async function renderPartnerBoothBannerPdf(input: {
  partnerName: string;
  partnerId: string;
  qrTargetUrl: string;
  partnerLogoPath?: string | null;
}): Promise<Buffer> {
  const qrPng = await renderBlackQrPng(input.qrTargetUrl);
  const calclaimBuf = fs.existsSync(CALCLAIM_LOGO)
    ? toGrayscalePng(fs.readFileSync(CALCLAIM_LOGO))
    : null;
  const partnerLogoBuf = resolveLogoBuf(input.partnerLogoPath);

  const doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: `CalClaim booth banner — ${input.partnerName}`,
      Author: "CalClaim",
    },
  });
  const done = collectPdf(doc);

  const shared: BannerShared = {
    partnerName: input.partnerName,
    partnerId: input.partnerId,
    qrPng,
    calclaimBuf,
    partnerLogoBuf,
  };

  drawBannerLayout(doc, { x: 0, y: 0, w: LETTER_W, h: LETTER_H }, shared);

  // Page 2: two half-letter fliers — same layout, rotated 90° and shrunk
  doc.addPage({
    size: "LETTER",
    layout: "portrait",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const halfH = pageH / 2;

  drawRotatedShrunkFlier(doc, { x: 0, y: 0, w: pageW, h: halfH }, shared);
  drawRotatedShrunkFlier(doc, { x: 0, y: halfH, w: pageW, h: halfH }, shared);
  drawCutGuide(doc, pageW, halfH);

  doc.end();
  return done;
}
