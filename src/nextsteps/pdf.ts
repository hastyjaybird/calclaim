import PDFDocument from "pdfkit";
import { getCampaign } from "../analytics/campaigns.js";
import { formatUsd, maxBenefitAmountUsd } from "../library/benefitEstimate.js";
import { docLabel, hasDoc } from "../library/docs.js";
import { estimateFormFillMinutes } from "../library/formFill.js";
import { getDisclaimer, getProgram } from "../library/load.js";
import type { NextStepsItem, Program, SessionState, TodoStatus } from "../library/types.js";
import { ownerSignOffIfRentingLine } from "../library/requirements.js";
import {
  resolveProgramPresentation,
  type TerritoryApplyLink,
} from "../library/utilityTerritory.js";
import { windowForProgram } from "../disaster/liveWindow.js";
import { listUnassessedPrograms } from "../queue/ranker.js";
import {
  closestDeadline,
  docsSavingsTable,
  isTaxSeasonClaim,
  openProgramsAnnualUsd,
  openTodos,
} from "./model.js";

/** Fallback when the session has no arrival campaign (plain /start). */
export const WEBSITE_ENTRY_CAMPAIGN = "qr_website";

export interface ApplicationGuidePdfOpts {
  /** Pre-rendered arrival QR PNG (partner / peer / website). */
  arrivalQrPng?: Buffer | null;
  /** Campaign id for the QR caption (defaults to session.campaignId). */
  arrivalCampaignId?: string | null;
}

const TAX_PREPARER_HEADING = "For your tax preparer";
const TAX_PREPARER_INTRO =
  "Hand this box to VITA, a paid preparer, or tax software. These are credits to claim on the return – not applications to submit today.";
const TAX_BOX_FILL = "#f8f1e4";
const TAX_BOX_STROKE = "#8a5a12";
const TAX_BOX_HEADER = "#5c3a08";
const TAX_BOX_PAD = 12;
const TAX_BOX_GAP_AFTER = 16;
const TAX_BOX_ITEM_GAP = 8;

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function statusLabel(status: TodoStatus): string {
  switch (status) {
    case "todo":
      return "To do";
    case "in_progress":
      return "In progress";
    case "snoozed":
      return "Remind later";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    default:
      return status;
  }
}

function deadlineLine(item: NextStepsItem, taxSeason: boolean): string {
  if (item.deadlineLabel) {
    return item.deadlineDate
      ? `${item.deadlineLabel} (${item.deadlineDate})`
      : item.deadlineLabel;
  }
  return taxSeason
    ? "Claim when you file – typically January through mid-April"
    : "No deadline – apply anytime (confirm on the official site)";
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.x = doc.page.margins.left;
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(13).text(title);
  doc.font("Helvetica");
  doc.moveDown(0.35);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function drawFindYourDocumentsTable(
  doc: PDFKit.PDFDocument,
  session: SessionState,
): void {
  const rows = docsSavingsTable(session);
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colDoc = usable * 0.62;
  const colAmt = usable * 0.38;
  const padX = 8;
  const padY = 6;
  const headerH = 22;
  const rowH = 28;

  sectionTitle(doc, "Step 1 – Find your documents");
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(
      "Pull these together first – each one unlocks estimated aid on your open applications (estimates only). Where a program accepts an award letter or pay stubs, that counts as one choice.",
    );
  doc.moveDown(0.4);

  if (rows.length === 0) {
    doc.fontSize(10).fillColor("#000").text("• Nothing extra listed right now.");
    doc.moveDown();
    return;
  }

  ensureSpace(doc, headerH + rowH * Math.min(rows.length, 4) + 24);

  const tableTop = doc.y;
  let y = tableTop;
  const drawRowBg = (yy: number, h: number, fill: string) => {
    doc.save();
    doc.rect(left, yy, usable, h).fill(fill);
    doc.restore();
  };

  drawRowBg(y, headerH, "#1a3a2a");
  doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
  doc.text("Document", left + padX, y + padY, { width: colDoc - padX * 2 });
  doc.text("Could save you (est.)", left + colDoc + padX, y + padY, {
    width: colAmt - padX * 2,
    align: "right",
  });
  y += headerH;

  doc.font("Helvetica");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    drawRowBg(y, rowH, i % 2 === 0 ? "#f0f5f2" : "#ffffff");
    const amt = `up to ~${formatUsd(row.annualUsd)}/yr`;
    doc.fillColor("#111").fontSize(10);
    doc.text(row.label, left + padX, y + padY, {
      width: colDoc - padX * 2,
      ellipsis: true,
    });
    doc.fillColor("#0b5c2e").font("Helvetica-Bold").fontSize(10);
    doc.text(amt, left + colDoc + padX, y + padY, {
      width: colAmt - padX * 2,
      align: "right",
    });
    doc.font("Helvetica");
    y += rowH;
  }

  doc.save();
  doc.lineWidth(0.75).strokeColor("#1a3a2a");
  doc.rect(left, tableTop, usable, y - tableTop).stroke();
  doc.restore();

  // Absolute-positioned table cells leave the text cursor mid-row – reset.
  doc.x = left;
  doc.y = y + 10;
  doc
    .fontSize(8)
    .fillColor("#666")
    .text(
      "Per-document $ can overlap when one program needs several docs. Your total at the top counts each open program once.",
      { width: usable },
    );
  doc.moveDown(0.8);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Draw a full URL as visible, underlined, clickable text.
 * A rectangle annotation covers wrapped lines so the hitbox stays tappable.
 */
function drawClickableUrl(
  doc: PDFKit.PDFDocument,
  url: string,
  width: number,
): void {
  if (!url) return;
  const left = doc.x;
  const top = doc.y;
  doc.fillColor("#0b5c2e").fontSize(10).text(url, {
    width,
    underline: true,
  });
  const height = Math.max(doc.y - top, 12);
  doc.link(left, top, width, height, url);
}

function applyViaLabel(url: string): string {
  const host = hostLabel(url);
  if (host === "benefitscal.com") return "Apply via BenefitsCal:";
  return "Apply:";
}

function applyLinkRows(
  item: NextStepsItem,
  session: SessionState,
): { label: string; url: string }[] {
  const program = getProgram(item.programId);
  if (!program) {
    return item.link ? [{ label: applyViaLabel(item.link), url: item.link }] : [];
  }
  const window = windowForProgram(program);
  if (window?.applyUrl) {
    return [{ label: "Apply online:", url: window.applyUrl }];
  }
  const resolved = resolveProgramPresentation(program, session);
  if (resolved.territoryApplyLinks.length > 0) {
    return resolved.territoryApplyLinks.map((t: TerritoryApplyLink) => ({
      label: `Apply via ${t.label}:`,
      url: t.applyUrl,
    }));
  }
  if (!item.link) return [];
  return [{ label: applyViaLabel(item.link), url: item.link }];
}

function looksLikeUrlStep(step: string): boolean {
  return /https?:\/\//i.test(step);
}

function howToApplyForPdf(
  program: Program,
  session: SessionState,
): { heading: string; steps: string[] } | null {
  if (program.requiresActiveDisasterWindow && program.applySteps.length) {
    const steps = program.applySteps.filter((s) => !looksLikeUrlStep(s));
    if (!steps.length) return null;
    return {
      heading: "How Disaster CalFresh usually works:",
      steps,
    };
  }
  const resolved = resolveProgramPresentation(program, session);
  const steps = resolved.applySteps.filter((s) => !looksLikeUrlStep(s));
  if (!steps.length) return null;
  const heading =
    resolved.territoryLabels.length === 1
      ? `How to apply (${resolved.territoryLabels[0]}):`
      : resolved.territoryLabels.length > 1
        ? "How to apply with your utility:"
        : "How to apply:";
  return { heading, steps };
}

function drawTodoItem(
  doc: PDFKit.PDFDocument,
  item: NextStepsItem,
  index: number,
  session: SessionState,
): void {
  ensureSpace(doc, 90);
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.x = left;

  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(`${index}. ${item.programName}`, {
      width: usable,
      continued: true,
    });
  doc
    .font("Helvetica")
    .fillColor("#555")
    .fontSize(10)
    .text(`  ·  ${statusLabel(item.status)}  ·  ${item.category}`, { width: usable });

  doc.moveDown(0.12);
  doc
    .fillColor("#0b5c2e")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("When: You can apply now.", { width: usable });
  doc.font("Helvetica");

  doc.moveDown(0.08);
  doc.fillColor("#222").fontSize(10).text(item.action, { width: usable });

  const program = getProgram(item.programId);
  if (program) {
    const mins = estimateFormFillMinutes(program, session.docsInHand);
    doc
      .fillColor("#444")
      .fontSize(9)
      .text(`Est. ~${mins} min to fill out the application`, { width: usable });
    const ownerLine = ownerSignOffIfRentingLine(program.id);
    if (ownerLine) {
      doc.fillColor("#444").fontSize(9).text(ownerLine, { width: usable });
    }
  }

  const window = program ? windowForProgram(program) : null;
  if (window?.applyPhone) {
    doc
      .fillColor("#222")
      .fontSize(10)
      .text(`Apply by phone: ${window.applyPhone}`, { width: usable });
  }

  for (const row of applyLinkRows(item, session)) {
    doc.x = left;
    doc.fillColor("#222").fontSize(10).text(row.label, { width: usable });
    doc.x = left;
    drawClickableUrl(doc, row.url, usable);
  }

  doc
    .fillColor("#222")
    .fontSize(10)
    .text(`Deadline: ${deadlineLine(item, false)}`, { width: usable });

  const stillNeeded = item.docs.filter((d) => !hasDoc(session.docsInHand, d));
  if (stillNeeded.length > 0) {
    doc
      .fillColor("#444")
      .fontSize(9)
      .text(
        `Documents needed: ${stillNeeded.map((d) => docLabel(d)).join("; ")}`,
        { width: usable },
      );
  }

  if (program) {
    const how = howToApplyForPdf(program, session);
    if (how) {
      doc.moveDown(0.15);
      doc.fillColor("#444").fontSize(9).text(how.heading, { width: usable });
      for (const step of how.steps) {
        doc.text(`• ${step}`, { width: usable });
      }
    }
  }

  doc.moveDown(0.45);
}

type TaxBoxItem = {
  name: string;
  benefit: string | null;
  fileBy: string;
  url: string;
};

function taxOfficialUrl(item: NextStepsItem): string {
  const program = getProgram(item.programId);
  return (program?.applyUrl || item.link || "").trim();
}

function taxBenefitLine(item: NextStepsItem, session: SessionState): string | null {
  const program = getProgram(item.programId);
  if (!program) return null;
  const amount = maxBenefitAmountUsd(program.maxBenefitUsd, session.householdSize);
  if (amount != null) {
    const period = program.maxBenefitUsd.period;
    const suffix =
      period === "year"
        ? "/yr"
        : period === "month"
          ? "/mo"
          : period === "once"
            ? " one-time"
            : "";
    return `Rough benefit: up to ~${formatUsd(amount)}${suffix} (estimate)`;
  }
  if (program.maxBenefit) return `Rough benefit: ${program.maxBenefit}`;
  return null;
}

function toTaxBoxItem(item: NextStepsItem, session: SessionState): TaxBoxItem {
  return {
    name: item.programName,
    benefit: taxBenefitLine(item, session),
    fileBy: deadlineLine(item, true),
    url: taxOfficialUrl(item),
  };
}

function pageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

function remainingSpace(doc: PDFKit.PDFDocument): number {
  return pageBottom(doc) - doc.y;
}

function measureTaxBoxHeader(
  doc: PDFKit.PDFDocument,
  width: number,
  continued: boolean,
): number {
  const title = continued
    ? `${TAX_PREPARER_HEADING} (continued)`
    : TAX_PREPARER_HEADING;
  doc.font("Helvetica-Bold").fontSize(13);
  let h = doc.heightOfString(title, { width });
  if (!continued) {
    h += 4;
    doc.font("Helvetica").fontSize(9);
    h += doc.heightOfString(TAX_PREPARER_INTRO, { width });
  }
  return h + 8;
}

function measureTaxBoxItem(
  doc: PDFKit.PDFDocument,
  item: TaxBoxItem,
  width: number,
): number {
  let h = 0;
  doc.font("Helvetica-Bold").fontSize(11);
  h += doc.heightOfString(item.name, { width });
  doc.font("Helvetica").fontSize(9);
  if (item.benefit) {
    h += 2 + doc.heightOfString(item.benefit, { width });
  }
  h += 2 + doc.heightOfString("Claim on the return – do not apply now.", { width });
  h += 2 + doc.heightOfString(`File by: ${item.fileBy}`, { width });
  if (item.url) {
    doc.fontSize(8);
    h += 3 + doc.heightOfString("Official page (type this URL):", { width });
    h += 1 + doc.heightOfString(item.url, { width });
  }
  return h;
}

function drawTaxBoxHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  continued: boolean,
): number {
  const title = continued
    ? `${TAX_PREPARER_HEADING} (continued)`
    : TAX_PREPARER_HEADING;
  doc.fillColor(TAX_BOX_HEADER).font("Helvetica-Bold").fontSize(13);
  doc.text(title, x, y, { width });
  let nextY = doc.y;
  if (!continued) {
    nextY += 4;
    doc.fillColor("#4a3a22").font("Helvetica").fontSize(9);
    doc.text(TAX_PREPARER_INTRO, x, nextY, { width });
    nextY = doc.y;
  }
  return nextY + 8;
}

function drawTaxBoxItem(
  doc: PDFKit.PDFDocument,
  item: TaxBoxItem,
  index: number,
  x: number,
  y: number,
  width: number,
): number {
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(11);
  doc.text(`${index}. ${item.name}`, x, y, { width });
  let nextY = doc.y;
  doc.font("Helvetica").fontSize(9);
  if (item.benefit) {
    nextY += 1;
    doc.fillColor("#5c3a08").text(item.benefit, x, nextY, { width });
    nextY = doc.y;
  }
  nextY += 1;
  doc
    .fillColor("#333")
    .text("Claim on the return – do not apply now.", x, nextY, { width });
  nextY = doc.y + 1;
  doc.text(`File by: ${item.fileBy}`, x, nextY, { width });
  nextY = doc.y;
  if (item.url) {
    nextY += 2;
    doc
      .fillColor("#333")
      .fontSize(8)
      .text("Official page (type this URL):", x, nextY, { width });
    nextY = doc.y;
    doc.fillColor("#0b5c2e").fontSize(8);
    const urlTop = nextY;
    doc.text(item.url, x, nextY, { width });
    nextY = doc.y;
    doc.link(x, urlTop, width, Math.max(nextY - urlTop, 10), item.url);
  }
  return nextY;
}

function drawTaxPreparerBox(
  doc: PDFKit.PDFDocument,
  items: NextStepsItem[],
  session: SessionState,
): void {
  if (items.length === 0) return;

  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const innerWidth = usable - TAX_BOX_PAD * 2;
  const rows = items.map((item) => toTaxBoxItem(item, session));

  let index = 0;
  let continued = false;

  while (index < rows.length) {
    const headerH = measureTaxBoxHeader(doc, innerWidth, continued);
    const firstItemH = measureTaxBoxItem(doc, rows[index]!, innerWidth);
    const minChunk = TAX_BOX_PAD * 2 + headerH + firstItemH;
    if (remainingSpace(doc) < minChunk) {
      doc.addPage();
    }

    const innerBudget = remainingSpace(doc) - TAX_BOX_PAD * 2;
    let usedInner = headerH;
    const chunk: { row: TaxBoxItem; n: number }[] = [];
    let i = index;
    while (i < rows.length) {
      const h = measureTaxBoxItem(doc, rows[i]!, innerWidth);
      const gap = chunk.length > 0 ? TAX_BOX_ITEM_GAP : 0;
      if (chunk.length > 0 && usedInner + gap + h > innerBudget) break;
      chunk.push({ row: rows[i]!, n: i + 1 });
      usedInner += gap + h;
      i++;
    }

    const boxH = usedInner + TAX_BOX_PAD * 2 + 6;
    const boxTop = doc.y;

    doc.save();
    doc.lineWidth(1.25);
    doc
      .rect(left, boxTop, usable, boxH)
      .fillAndStroke(TAX_BOX_FILL, TAX_BOX_STROKE);
    doc.restore();

    const innerX = left + TAX_BOX_PAD;
    let y = boxTop + TAX_BOX_PAD;
    y = drawTaxBoxHeader(doc, innerX, y, innerWidth, continued);
    for (let c = 0; c < chunk.length; c++) {
      const part = chunk[c]!;
      if (c > 0) y += TAX_BOX_ITEM_GAP;
      y = drawTaxBoxItem(doc, part.row, part.n, innerX, y, innerWidth);
    }

    doc.x = left;
    doc.y = boxTop + boxH + TAX_BOX_GAP_AFTER;
    index = i;
    continued = true;
  }
}

/** One living PDF: the Application Guide (programs to apply for + how). */
export async function renderNextStepsPdf(
  session: SessionState,
  opts: ApplicationGuidePdfOpts = {},
): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 48, size: "LETTER" });
  const done = collectPdf(doc);
  const total = openProgramsAnnualUsd(session);

  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("CalClaim – Your Application Guide");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#444")
    .text("Programs you may qualify for · how to apply · estimates only");
  doc.text(
    `Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`,
  );
  doc.moveDown(0.35);
  if (total > 0) {
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0b5c2e")
      .text(
        `You may qualify for a total of ~${formatUsd(total)} this year (estimates only).`,
      );
    doc.font("Helvetica");
  }
  doc.moveDown();

  drawFindYourDocumentsTable(doc, session);

  const todos = openTodos(session);
  const applyNow = todos.filter((item) => !isTaxSeasonClaim(item.programId));
  const taxSeason = todos.filter((item) => isTaxSeasonClaim(item.programId));

  sectionTitle(doc, "Step 2 – Apply now");
  if (applyNow.length === 0) {
    doc
      .fontSize(10)
      .fillColor("#000")
      .text(
        todos.length === 0
          ? "• No open items – nice work."
          : "• Nothing to submit today – tax-season credits are in the box for your tax preparer below.",
      );
    doc.moveDown();
  } else {
    doc
      .fontSize(9)
      .fillColor("#444")
      .text(
        "These have an application you can start today. Tap each green URL to open the official apply page.",
      );
    doc.moveDown(0.45);
    applyNow.forEach((item, i) => drawTodoItem(doc, item, i + 1, session));
  }

  if (taxSeason.length > 0) {
    drawTaxPreparerBox(doc, taxSeason, session);
  }

  const closest = closestDeadline(session);
  if (closest) {
    sectionTitle(doc, "Closest deadline");
    doc
      .fontSize(10)
      .fillColor("#000")
      .text(
        `${closest.programName}: ${deadlineLine(closest, isTaxSeasonClaim(closest.programId))}`,
      );
    doc.moveDown();
  }

  const already = session.items.filter((i) => i.status === "done");
  sectionTitle(doc, "Already on");
  if (already.length === 0) {
    doc.fontSize(10).fillColor("#000").text("• (none marked yet)");
  } else {
    for (const i of already) {
      doc.fontSize(10).fillColor("#000").text(`• ${i.programName} (${i.category})`);
    }
  }
  doc.moveDown();

  const unassessed = listUnassessedPrograms(session);
  if (unassessed.length > 0) {
    sectionTitle(doc, "Programs not assessed yet");
    doc
      .fontSize(9)
      .fillColor("#444")
      .text(
        "You exited before reviewing these. Message CalClaim anytime to continue where you left off.",
      );
    doc.moveDown(0.35);
    for (const program of unassessed) {
      doc
        .fontSize(10)
        .fillColor("#000")
        .text(`• ${program.name} (${program.category})`);
    }
    doc.moveDown();
  }

  drawArrivalQr(doc, session, opts);

  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.text("In Telegram: say “guide” to resend this file · STOP pauses reminders · erase deletes your data.");
  doc.moveDown(0.6);
  doc
    .fontSize(9)
    .fillColor("#555")
    .text("For more help, visit BenefitsCal at ", { continued: true });
  doc
    .fillColor("#0b5c2e")
    .text("https://benefitscal.com/", {
      link: "https://benefitscal.com/",
      underline: true,
    });
  doc.end();
  return done;
}

function drawArrivalQr(
  doc: PDFKit.PDFDocument,
  session: SessionState,
  opts: ApplicationGuidePdfOpts,
): void {
  const png = opts.arrivalQrPng;
  if (!png?.length) return;

  const campaignId =
    opts.arrivalCampaignId?.trim() ||
    session.campaignId?.trim() ||
    WEBSITE_ENTRY_CAMPAIGN;
  const campaign = getCampaign(campaignId);
  const isWebsite =
    campaignId === WEBSITE_ENTRY_CAMPAIGN || campaignId === "link_website";

  const qrSize = 120;
  ensureSpace(doc, qrSize + 72);
  sectionTitle(doc, "Your CalClaim QR");
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(
      isWebsite
        ? "Scan to open CalClaim (website entry)."
        : campaign?.name
          ? `Scan to open CalClaim the same way you did (${campaign.name}).`
          : "Scan to open CalClaim the same way you did.",
    );
  doc.moveDown(0.4);
  const left = doc.page.margins.left;
  doc.image(png, left, doc.y, { width: qrSize, height: qrSize });
  doc.y += qrSize + 10;
  doc.moveDown(0.35);
}
