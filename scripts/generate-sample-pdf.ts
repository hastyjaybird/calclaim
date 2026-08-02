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
  hasAgedBlindOrDisabled: false,
  // Leave common docs out so the "Find your documents" incentive table has rows.
  docsInHand: ["categoricalProof"],
  queue: [],
  queueIndex: 0,
  alreadyOn: [],
  lastBotMessage: null,
  campaignId: null,
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
      link: "https://www.pge.com/en/account/billing-and-assistance/financial-assistance/california-alternate-rates-for-energy-program.html",
      deadlineLabel: "",
      deadlineDate: null,
      status: "todo",
      docs: ["utilityBill", "photoId"],
    },
  ],
  remindersEnabled: true,
  remindersStopped: false,
  awaitingConfirm: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const outDir = path.join(root, "docs", "samples");
fs.mkdirSync(outDir, { recursive: true });
const buf = await renderNextStepsPdf(sample);
const out = path.join(outDir, "calclaim-todo-list-sample.pdf");
fs.writeFileSync(out, buf);
console.log("Wrote", out);
