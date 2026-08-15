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

const TAGLINE_LINE1 = "Scan to find California benefits help";
const TAGLINE_LINE2 =
  "food, health, phone discounts, energy bill aid, and more.";

/** Letter portrait in PDF points (72 pt/in). */
const LETTER_W = 612;
const LETTER_H = 792;

const INK = "#000000";
const RULE = "#000000";
const PAPER = "#ffffff";

type BannerShared = {
  partnerName: string;
  eventName?: string;
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
    // Fall through – embed original if conversion fails
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
  opts: { frame?: boolean } = {},
): void {
  const { x, y, w, h } = bounds;
  const margin = Math.max(18, Math.min(48, w * 0.078));
  const contentW = w - margin * 2;
  const scale = w / LETTER_W;
  const drawFrame = opts.frame !== false;

  const savedBottom = doc.page.margins.bottom;
  const savedTop = doc.page.margins.top;
  doc.page.margins.bottom = 0;
  doc.page.margins.top = 0;

  doc.save();
  doc.rect(x, y, w, h).fill(PAPER);
  doc.restore();

  if (drawFrame) {
    // Hairline frame (full placard only – half-fliers use the center cut guide)
    doc.save();
    doc.lineWidth(Math.max(0.6, 1 * scale)).strokeColor(RULE);
    doc.rect(x + 0.5, y + 0.5, w - 1, h - 1).stroke();
    doc.restore();
  }

  // QR bordered block – geometric center of the placard (half-fliers reuse this layout)
  const tagSize = Math.max(10, 15 * scale);
  const taglineBlockH = tagSize * 2.8 + 10 * scale;
  // Leave room under the QR for the two-line scan tagline
  const footerReserve = taglineBlockH + margin * 0.65;
  // Stacked partner → CalClaim header needs more vertical room than the old side-by-side lockup
  const headerReserve = Math.min(
    h * 0.36,
    input.partnerLogoBuf ? 280 * scale : 230 * scale,
  );
  const qrPad = 14 * scale;
  const pageCenterX = x + w / 2;
  const pageCenterY = y + h / 2;

  let qrSize = Math.min(300 * scale, contentW * 0.72);
  const maxHalfAbove = pageCenterY - (y + headerReserve);
  const maxHalfBelow = y + h - footerReserve - pageCenterY;
  const maxBox = 2 * Math.min(maxHalfAbove, maxHalfBelow, contentW / 2);
  const maxQr = Math.max(100 * scale, maxBox - qrPad * 2);
  if (qrSize > maxQr) qrSize = maxQr;

  const qrBoxSize = qrSize + qrPad * 2;
  const qrBoxX = pageCenterX - qrBoxSize / 2;
  const qrBoxY = pageCenterY - qrBoxSize / 2;
  const qrX = qrBoxX + qrPad;
  const qrY = qrBoxY + qrPad;

  let cy = y + margin * 0.85;

  if (input.partnerLogoBuf) {
    // Partner logo (name under it), then CalClaim below
    const logoBox = Math.min(72 * scale, h * 0.1);
    const nameSize = Math.max(10, 14 * scale);
    const nameH = nameSize * 2.4;
    const calclaimDrawW = Math.min(contentW * 0.55, 220 * scale);
    const calclaimDrawH = Math.min(52 * scale, h * 0.065);

    doc.image(input.partnerLogoBuf, x + margin + (contentW - logoBox) / 2, cy, {
      fit: [logoBox, logoBox],
      align: "center",
      valign: "center",
    });

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(nameSize)
      .text(input.partnerName, x + margin, cy + logoBox + 4 * scale, {
        width: contentW,
        height: nameH,
        align: "center",
        ellipsis: true,
      });

    cy += logoBox + nameH + 10 * scale;

    if (input.calclaimBuf) {
      doc.image(input.calclaimBuf, x + margin + (contentW - calclaimDrawW) / 2, cy, {
        fit: [calclaimDrawW, calclaimDrawH],
        align: "center",
        valign: "center",
      });
      cy += calclaimDrawH + 12 * scale;
    } else {
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(Math.max(12, 20 * scale))
        .text("CalClaim", x + margin, cy, {
          width: contentW,
          align: "center",
          lineBreak: false,
        });
      cy += 28 * scale;
    }
  } else {
    if (input.calclaimBuf) {
      const logoH = Math.min(90 * scale, h * 0.12);
      const logoW = contentW * 0.72;
      doc.image(input.calclaimBuf, x + margin + (contentW - logoW) / 2, cy, {
        fit: [logoW, logoH],
        align: "center",
      });
      cy += logoH + 14 * scale;
    } else {
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(Math.max(18, 32 * scale))
        .text("CalClaim", x + margin, cy, { width: contentW, align: "center" });
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
    cy = doc.y + 10 * scale;
  }

  if (input.eventName) {
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(Math.max(12, 18 * scale))
      .text(input.eventName, x + margin, cy, {
        width: contentW,
        align: "center",
        height: Math.max(16, 24 * scale),
        ellipsis: true,
      });
  }

  doc.save();
  doc
    .lineWidth(Math.max(0.6, 1 * scale))
    .strokeColor(RULE)
    .rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize)
    .stroke();
  doc.restore();

  doc.image(input.qrPng, qrX, qrY, { width: qrSize, height: qrSize });

  // Scan tagline directly under the QR
  const tagY = qrBoxY + qrBoxSize + 10 * scale;
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(tagSize)
    .text(TAGLINE_LINE1, x + margin, tagY, {
      width: contentW,
      align: "center",
      height: tagSize * 1.4,
      ellipsis: true,
    });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(tagSize)
    .text(TAGLINE_LINE2, x + margin, doc.y + 2 * scale, {
      width: contentW,
      align: "center",
      height: tagSize * 1.4,
      ellipsis: true,
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
  drawBannerLayout(doc, { x: 0, y: 0, w: LETTER_W, h: LETTER_H }, input, {
    frame: false,
  });
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
  qrTargetUrl: string;
  partnerLogoPath?: string | null;
  eventName?: string;
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
      Title: input.eventName
        ? `CalClaim event banner – ${input.partnerName} – ${input.eventName}`
        : `CalClaim booth banner – ${input.partnerName}`,
      Author: "CalClaim",
    },
  });
  const done = collectPdf(doc);

  const shared: BannerShared = {
    partnerName: input.partnerName,
    eventName: input.eventName?.trim() || undefined,
    qrPng,
    calclaimBuf,
    partnerLogoBuf,
  };

  drawBannerLayout(doc, { x: 0, y: 0, w: LETTER_W, h: LETTER_H }, shared);

  // Page 2: two half-letter fliers – same layout, rotated 90° and shrunk
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
