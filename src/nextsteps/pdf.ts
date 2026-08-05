import PDFDocument from "pdfkit";
import { formatUsd } from "../library/benefitEstimate.js";
import { docLabel, hasDoc } from "../library/docs.js";
import { estimateFormFillMinutes } from "../library/formFill.js";
import { getDisclaimer, getProgram } from "../library/load.js";
import type { NextStepsItem, SessionState, TodoStatus } from "../library/types.js";
import {
  closestDeadline,
  docsSavingsTable,
  openProgramsAnnualUsd,
  openTodos,
} from "./model.js";

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

function deadlineLine(item: NextStepsItem): string {
  if (item.deadlineLabel) {
    return item.deadlineDate
      ? `${item.deadlineLabel} (${item.deadlineDate})`
      : item.deadlineLabel;
  }
  return "No deadline — apply anytime (confirm on the official site)";
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

  sectionTitle(doc, "Step 1 — Find your documents");
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(
      "Pull these together first — each one unlocks estimated aid on your open applications (estimates only). Where a program accepts an award letter or pay stubs, that counts as one choice.",
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

  // Absolute-positioned table cells leave the text cursor mid-row — reset.
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
  doc.fillColor("#222").fontSize(10).text(item.action, { width: usable });

  const program = getProgram(item.programId);
  if (program) {
    const mins = estimateFormFillMinutes(program, session.docsInHand);
    doc
      .fillColor("#444")
      .fontSize(9)
      .text(`Est. ~${mins} min to fill out the application`, { width: usable });
  }

  // Short clickable CTA (full URL as annotation target) — avoids broken multi-line link hitboxes.
  doc.fillColor("#222").fontSize(10).text("Apply: ", { continued: true });
  doc.fillColor("#0b5c2e").text("Open official page", {
    link: item.link,
    underline: true,
  });
  doc
    .fillColor("#666")
    .fontSize(8)
    .text(hostLabel(item.link), { link: item.link, width: usable });

  doc.fillColor("#222").fontSize(10).text(`Deadline: ${deadlineLine(item)}`, { width: usable });

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

  // Disaster CalFresh is short-lived and unusual: spell out how it usually works
  // so the PDF alone is enough to apply when a county window is open.
  if (program?.requiresActiveDisasterWindow && program.applySteps.length) {
    doc.moveDown(0.15);
    doc
      .fillColor("#444")
      .fontSize(9)
      .text("How Disaster CalFresh usually works:", { width: usable });
    for (const step of program.applySteps) {
      doc.text(`• ${step}`, { width: usable });
    }
  }

  doc.moveDown(0.45);
}

/** One living PDF: the benefits report and the To Do List are the same document. */
export async function renderNextStepsPdf(session: SessionState): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 48, size: "LETTER" });
  const done = collectPdf(doc);
  const total = openProgramsAnnualUsd(session);

  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("CalClaim — Your To Do List");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#444")
    .text("Your benefits report · same file · estimates only");
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

  sectionTitle(doc, "Step 2 — Open applications");
  const todos = openTodos(session);
  if (todos.length === 0) {
    doc.fontSize(10).fillColor("#000").text("• No open items — nice work.");
    doc.moveDown();
  } else {
    doc
      .fontSize(9)
      .fillColor("#444")
      .text("Tap each green link to open the official apply page.");
    doc.moveDown(0.45);
    todos.forEach((item, i) => drawTodoItem(doc, item, i + 1, session));
  }

  const closest = closestDeadline(session);
  if (closest) {
    sectionTitle(doc, "Closest deadline");
    doc
      .fontSize(10)
      .fillColor("#000")
      .text(`${closest.programName}: ${deadlineLine(closest)}`);
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

  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.text("In Telegram: say “to do” to resend this file · STOP pauses reminders · erase deletes your data.");
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
