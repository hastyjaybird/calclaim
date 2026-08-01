import PDFDocument from "pdfkit";
import { formatUsd } from "../corpus/benefitEstimate.js";
import { getDisclaimer } from "../corpus/load.js";
import type { SessionState } from "../corpus/types.js";
import {
  closestDeadline,
  docsSavingsTable,
  openProgramsAnnualUsd,
} from "./model.js";

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
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

  doc.fillColor("#000").fontSize(14).text("Find your documents", { underline: true });
  doc.moveDown(0.25);
  doc
    .fontSize(9)
    .fillColor("#444")
    .text(
      "Pull these together first — each one unlocks estimated aid on your open applications (estimates only).",
    );
  doc.moveDown(0.4);

  if (rows.length === 0) {
    doc.fontSize(10).fillColor("#000").text("• Nothing extra listed right now.");
    doc.moveDown();
    return;
  }

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

  const total = openProgramsAnnualUsd(session);
  drawRowBg(y, headerH, "#e8f0eb");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(9);
  doc.text("Open programs total (unique)", left + padX, y + padY, {
    width: colDoc - padX * 2,
  });
  doc.fillColor("#0b5c2e").text(`up to ~${formatUsd(total)}/yr`, left + colDoc + padX, y + padY, {
    width: colAmt - padX * 2,
    align: "right",
  });
  doc.font("Helvetica");
  y += headerH;

  doc.save();
  doc.lineWidth(0.75).strokeColor("#1a3a2a");
  doc.rect(left, tableTop, usable, y - tableTop).stroke();
  doc.restore();

  doc.y = y + 8;
  doc
    .fontSize(8)
    .fillColor("#666")
    .text(
      "Per-document $ can overlap when one program needs several docs. Total row counts each open program once.",
    );
  doc.moveDown();
}

export async function renderNextStepsPdf(session: SessionState): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const done = collectPdf(doc);

  doc.fontSize(18).text("CalClaim — Your next steps", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#444").text(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`);
  doc.text("California financial aid checklist (estimates only)");
  doc.moveDown();

  drawFindYourDocumentsTable(doc, session);

  doc.fillColor("#000").fontSize(12).text("Already on", { underline: true });
  const already = session.items.filter((i) => i.status === "done");
  if (already.length === 0) {
    doc.fontSize(10).text("• (none marked yet)");
  } else {
    for (const i of already) {
      doc.fontSize(10).text(`• ${i.programName} (${i.category})`);
    }
  }
  doc.moveDown();

  doc.fontSize(12).text("To-do list", { underline: true });
  const todos = session.items.filter((i) => i.status !== "done");
  if (todos.length === 0) {
    doc.fontSize(10).text("• No open items — nice work.");
  } else {
    for (const i of todos) {
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor("#000").text(`${i.programName} [${i.status}] — ${i.category}`);
      doc.fontSize(10).fillColor("#222").text(`  Action: ${i.action}`);
      doc.text(`  Link: ${i.link}`);
      if (i.deadlineLabel) {
        doc.text(
          `  Deadline: ${i.deadlineLabel}${i.deadlineDate ? ` (${i.deadlineDate})` : ""}`,
        );
      }
    }
  }
  doc.moveDown();

  const closest = closestDeadline(session);
  if (closest) {
    doc.fillColor("#000").fontSize(12).text("Closest deadline", { underline: true });
    doc.fontSize(10).text(`${closest.programName}: ${closest.deadlineLabel} (${closest.deadlineDate})`);
    doc.moveDown();
  }

  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.text("Type erase in Telegram to delete your CalClaim data.");
  doc.end();
  return done;
}

export async function renderBenefitsReportPdf(session: SessionState): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const done = collectPdf(doc);

  doc.fontSize(18).text("CalClaim — Benefits report", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#444").text(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`);
  doc.text("Multi-category CA aid summary — not affiliated with any agency.");
  doc.moveDown();

  doc.fillColor("#000").fontSize(12).text("Your path summary", { underline: true });
  doc.fontSize(10).text(`Branch: ${session.branch ?? "n/a"}`);
  if (session.householdSize) doc.text(`Household size: ${session.householdSize}`);
  if (session.incomeBand) doc.text(`Income band: ${session.incomeBand}`);
  doc.moveDown();

  for (const i of session.items) {
    doc.fontSize(11).fillColor("#000").text(`${i.programName} — ${i.status}`);
    doc.fontSize(10).fillColor("#222").text(`  ${i.action}`);
    doc.text(`  ${i.link}`);
    doc.text("  Max / note: see program site.");
    if (i.deadlineLabel) {
      doc.text(`  Deadline: ${i.deadlineLabel}`);
    }
    doc.moveDown(0.4);
  }

  doc.moveDown();
  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.end();
  return done;
}
