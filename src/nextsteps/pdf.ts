import PDFDocument from "pdfkit";
import { getDisclaimer } from "../corpus/load.js";
import type { SessionState } from "../corpus/types.js";
import { closestDeadline, docsToGather } from "./model.js";

const DOC_LABELS: Record<string, string> = {
  categoricalProof: "Award letter (Medi-Cal / CalFresh / SSI / CalWORKs / WIC)",
  photoId: "Photo ID",
  utilityBill: "Utility account # or recent bill",
  incomeProof: "Proof of income (pay stub or award letter)",
};

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function renderNextStepsPdf(session: SessionState): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50, size: "LETTER" });
  const done = collectPdf(doc);

  doc.fontSize(18).text("CalClaim — Your next steps", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#444").text(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`);
  doc.text("California financial aid checklist (estimates only)");
  doc.moveDown();

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
      doc.text(`  Deadline: ${i.deadlineLabel}${i.deadlineDate ? ` (${i.deadlineDate})` : ""}`);
    }
  }
  doc.moveDown();

  const closest = closestDeadline(session);
  doc.fillColor("#000").fontSize(12).text("Closest deadline", { underline: true });
  if (closest) {
    doc.fontSize(10).text(`${closest.programName}: ${closest.deadlineLabel} (${closest.deadlineDate})`);
  } else {
    doc.fontSize(10).text("No dated deadlines in your open todos. Check each program site.");
  }
  doc.moveDown();

  doc.fontSize(12).text("Documents to gather", { underline: true });
  const docs = docsToGather(session);
  if (docs.length === 0) {
    doc.fontSize(10).text("• Nothing extra listed right now.");
  } else {
    for (const d of docs) {
      doc.fontSize(10).text(`• ${DOC_LABELS[d] ?? d}`);
    }
  }
  doc.moveDown();

  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.text("Help → Erase all my data / STOP to exit and delete your data.");
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
    doc.text(`  Max / note: see program site. Deadline: ${i.deadlineLabel}`);
    doc.moveDown(0.4);
  }

  doc.moveDown();
  doc.fontSize(9).fillColor("#555").text(getDisclaimer());
  doc.end();
  return done;
}
