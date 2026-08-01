import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionState } from "../src/corpus/types.js";
import { renderNextStepsPdf } from "../src/nextsteps/pdf.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sample: SessionState = {
  telegramUserId: 0,
  step: "idle",
  branch: "yes",
  language: "en",
  householdSize: 4,
  incomeBand: null,
  pastDue: false,
  billNotInMyName: false,
  hasChildInHousehold: true,
  // Leave common docs out so the "Find your documents" incentive table has rows.
  docsInHand: ["categoricalProof"],
  queue: [],
  queueIndex: 0,
  alreadyOn: [],
  lastBotMessage: null,
  items: [
    {
      programId: "calfresh",
      programName: "CalFresh",
      category: "food",
      action: "Apply for CalFresh",
      link: "https://benefitscal.com/ApplyForBenefits/begin/ABOVR?lang=en",
      deadlineLabel: "",
      deadlineDate: null,
      status: "in_progress",
      docs: ["photoId", "incomeProof"],
    },
    {
      programId: "lifeline",
      programName: "LifeLine",
      category: "telecom",
      action: "Apply for LifeLine",
      link: "https://www.californialifeline.com/",
      deadlineLabel: "",
      deadlineDate: null,
      status: "todo",
      docs: ["photoId", "incomeProof"],
    },
    {
      programId: "care",
      programName: "CARE",
      category: "energy",
      action: "Apply for CARE",
      link: "https://www.pge.com/en/account/billing-and-assistance/financialassistance/carefera.html",
      deadlineLabel: "",
      deadlineDate: null,
      status: "todo",
      docs: ["utilityBill", "photoId"],
    },
    {
      programId: "tax_credits",
      programName: "Tax credits (info)",
      category: "tax",
      action: "Remind later: Tax credits (info)",
      link: "https://www.irs.gov/credits-deductions",
      deadlineLabel: "Typical federal filing season",
      deadlineDate: "2027-04-15",
      status: "snoozed",
      docs: ["incomeProof"],
    },
  ],
  remindersEnabled: true,
  awaitingConfirm: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const outDir = path.join(root, "docs", "samples");
fs.mkdirSync(outDir, { recursive: true });
const buf = await renderNextStepsPdf(sample);
const out = path.join(outDir, "calclaim-next-steps-sample.pdf");
fs.writeFileSync(out, buf);
console.log("Wrote", out);
