import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderShareQrPng } from "../src/bot/share.js";
import { campaignLandingUrl } from "../src/config.js";
import type { SessionState } from "../src/library/types.js";
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
  utilityBillsAsked: true,
  billsInMyName: ["pge"],
  billNotInMyName: false,
  meterSharing: "own",
  inShutoffZone: null,
  shutoffAddressChoices: null,
  residencyTie: "ca_home",
  isCaResident: true,
  buyingEvThisYear: false,
  firstTimeZev: false,
  buyingEbikeThisYear: false,
  wouldRetireVehicle: false,
  hasChildInHousehold: true,
  isFosterYouth: false,
  isRefugeeOrAsylee: false,
  hasMedicalDeviceOrCondition: false,
  hasAgedBlindOrDisabled: false,
  workDisruption: null,
  inDisasterArea: null,
  residenceZip: null,
  residenceCounty: null,
  // Leave common docs out so the "Find your documents" incentive table has rows.
  docsInHand: ["categoricalProof"],
  // Simulate early exit: remaining queue programs appear under "not assessed".
  queue: ["liheap", "esa", "amp"],
  queueIndex: 0,
  alreadyOn: [],
  lastBotMessage: null,
  campaignId: "qr_website",
  screensSeen: [],
  screenShownAt: null,
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
      docs: ["photoId", "incomeOrCategorical"],
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
    {
      programId: "esa",
      programName: "ESA",
      category: "energy",
      action: "Apply for ESA",
      link: "https://www.pge.com/en/save-energy-and-money/energy-saving-programs/energy-savings-assistance-program.html",
      deadlineLabel: "",
      deadlineDate: null,
      status: "todo",
      docs: ["utilityBill", "incomeOrCategorical"],
    },
    {
      programId: "caleitc",
      programName: "CalEITC",
      category: "tax",
      action: "Claim CalEITC when you file your tax return – not an application you submit today",
      link: "https://www.ftb.ca.gov/file/personal/credits/california-earned-income-tax-credit.html",
      deadlineLabel: "Tax year 2026 California filing deadline",
      deadlineDate: "2027-04-15",
      status: "todo",
      docs: ["taxReturn"],
    },
    {
      programId: "federal_eitc",
      programName: "Federal Earned Income Tax Credit (EITC)",
      category: "tax",
      action: "Claim Federal Earned Income Tax Credit (EITC) when you file your tax return – not an application you submit today",
      link: "https://www.irs.gov/credits-deductions/individuals/earned-income-tax-credit-eitc",
      deadlineLabel: "Tax year 2026 federal filing deadline",
      deadlineDate: "2027-04-15",
      status: "todo",
      docs: ["taxReturn", "taxForms"],
    },
    {
      programId: "child_tax_credit",
      programName: "Child Tax Credit (CTC)",
      category: "tax",
      action: "Claim Child Tax Credit (CTC) when you file your tax return – not an application you submit today",
      link: "https://www.irs.gov/credits-deductions/individuals/child-tax-credit",
      deadlineLabel: "Tax year 2026 federal filing deadline",
      deadlineDate: "2027-04-15",
      status: "todo",
      docs: ["taxReturn", "taxForms"],
    },
  ],
  remindersEnabled: true,
  remindersStopped: false,
  reopenNotifyOptIn: null,
  reopenWatchProgramIds: [],
  savedImmigrationStatus: null,
  awaitingConfirm: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const outDir = path.join(root, "docs", "samples");
fs.mkdirSync(outDir, { recursive: true });
const arrivalQrPng = await renderShareQrPng(
  campaignLandingUrl("https://calclaim.jayhasty.com", "qr_website"),
);
const buf = await renderNextStepsPdf(sample, {
  arrivalQrPng,
  arrivalCampaignId: "qr_website",
});
const out = path.join(outDir, "calclaim-application-guide-sample.pdf");
fs.writeFileSync(out, buf);
console.log("Wrote", out);
