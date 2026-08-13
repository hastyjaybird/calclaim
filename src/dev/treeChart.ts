/**
 * Static review chart: programs × triage gates / place-status qualifications,
 * plus unlock edges. Used by /dev/tree/chart so a human can verify offer order
 * and which CA residency, utility, county, and immigration bars each program
 * needs (bot-asked gates and eligibility-matrix rules).
 */

import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LIBRARY_DIR } from "../config.js";
import {
  clearProgramsCache,
  getLibraryMeta,
  loadPrograms,
} from "../library/load.js";
import { buildProgramMatrix, isHeldFromOffer } from "../library/requirements.js";
import { SHARED_METER_PROMPT } from "../library/sharedMeter.js";
import type { Branch, Program, ProgramJurisdiction } from "../library/types.js";

export type ChartGateId =
  | "income"
  | "past_due"
  | "medical_need"
  | "ca_residency"
  | "utility_bills"
  | "shared_meter"
  | "shutoff_zone"
  | "buying_ev"
  | "first_time_zev"
  | "child"
  | "foster_youth"
  | "refugee"
  | "abd"
  | "work"
  | "disaster"
  | "zip"
  | "citizen_or_eligible"
  | "ineligible_immigrant";

export interface ChartColumn {
  id: ChartGateId;
  short: string;
  label: string;
  /** Exact (or near-exact) Telegram copy the bot asks for this gate. */
  question: string;
  note: string;
}

export interface ChartCell {
  needed: boolean;
  /** Compact detail when needed (e.g. CARE band, job_loss). */
  detail: string;
}

export interface ChartProgramRow {
  id: string;
  name: string;
  category: string;
  jurisdiction: ProgramJurisdiction;
  oneLiner: string;
  yesOrder: number;
  noOrder: number;
  branches: Branch[];
  gateFeeder: boolean;
  /** Waitlisted / paused / enrollment closed – held out of the offer tree. */
  heldFromOffer: boolean;
  heldStatus: string;
  unlocks: string[];
  unlockedBy: string[];
  cells: Record<ChartGateId, ChartCell>;
  /** How many gating questions / place-status bars this program needs. */
  gateCount: number;
}

export interface TreeChart {
  version: string;
  market: string;
  columns: ChartColumn[];
  programs: ChartProgramRow[];
  feeders: {
    id: string;
    name: string;
    unlocks: { id: string; name: string }[];
  }[];
  banner: string;
}

/** Preferred column / ask order – immigration late; RCA refugee follow-up after Yes. */
export const CHART_COLUMNS: readonly ChartColumn[] = [
  {
    id: "income",
    short: "Income",
    label: "Household income band",
    question:
      "About how much is your household's total yearly income before taxes?",
    note: "NO arm only · after household size",
  },
  {
    id: "ca_residency",
    short: "CA home",
    label: "Lives in California most of the year",
    question: "Where do you live most of the year?",
    note:
      "Marks CA-home / county / utility-at-home programs · unlock-gated · another state → work-in-CA follow-up (EDD + disaster carve-out)",
  },
  {
    id: "utility_bills",
    short: "Bills",
    label: "Utility bills in your name",
    question: "Which bills do you have in your name?",
    note:
      "Multiselect + None + Done · CARE / FERA / ESA / LIHEAP / AMP / Medical Baseline / SmartFlex / PG&E rebates · after CA home · before past-due",
  },
  {
    id: "shared_meter",
    short: "Meter",
    label: "Shared utility meter",
    question: SHARED_METER_PROMPT,
    note:
      "After a bill in your name · CARE/FERA out if another household shares this meter · AMP out if landlord bills (submeter) or shared · ESA/LIHEAP/Medical Baseline not gated",
  },
  {
    id: "shutoff_zone",
    short: "Shut-off",
    label: "PG&E shut-off / fire-threat zone",
    question:
      "PG&E has rebates for a portable generator or battery if your home is in a shut-off or high fire-risk area. Renters also qualify.\n\nDo you already know whether you're in one of those areas?",
    note:
      "Yes I'm in one → show offer (no address) · No → drop · Use my location → nearest street · Not sure → street+city map (soft-fail to offer) · after PG&E bill",
  },
  {
    id: "past_due",
    short: "Past due",
    label: "Utility bill past due",
    question: "Is your utility bill past due?",
    note: "Gates AMP · after bills-in-name",
  },
  {
    id: "medical_need",
    short: "Medical need",
    label: "Qualifying medical condition or device",
    question:
      "Does anyone living in the home have a qualifying medical condition or device that needs extra electricity or gas (for example life-support equipment, dialysis, asthma, or extra heating or cooling)?",
    note: "After bills-in-name · Medical Baseline",
  },
  {
    id: "buying_ev",
    short: "Buying EV",
    label: "Buying an EV this year",
    question:
      "Are you trying to buy an electric vehicle (or a hydrogen car) this year?",
    note: "MyFirstEV / PG&E EV / Clean Cars",
  },
  {
    id: "first_time_zev",
    short: "First ZEV",
    label: "First-time ZEV buyer",
    question:
      "Would this be your first battery-electric or hydrogen vehicle (not a plug-in hybrid)?",
    note: "MyFirstEV · after buying-EV intent",
  },
  {
    id: "child",
    short: "Child",
    label: "Child / pregnancy in household",
    question: "Any kids under 18 (or a pregnancy) in the household?",
    note: "WIC / CalWORKs / Young Child Tax Credit / CTC / Sun Bucks",
  },
  {
    id: "foster_youth",
    short: "Foster youth",
    label: "Former foster youth (18–25)",
    question:
      "Are you (or someone filing) a former foster youth age 18–25 who was in foster care on or after their 18th birthday?",
    note: "Foster Youth Tax Credit",
  },
  {
    id: "abd",
    short: "65+ / ABD",
    label: "Aged, blind, or disabled",
    question: "Is anyone in the household 65 or older, blind, or disabled?",
    note: "SSI / CAPI / IHSS / SSDI",
  },
  {
    id: "work",
    short: "Work",
    label: "Work disruption",
    question: "Has anything affected your ability to work in the last few months?",
    note: "UI / SDI / PFL",
  },
  {
    id: "disaster",
    short: "Disaster",
    label: "Disaster area",
    question: "Did you live or work in a declared disaster area?",
    note: "Only when a county window is live",
  },
  {
    id: "zip",
    short: "ZIP / county",
    label: "Home ZIP / county residency",
    question:
      "What's your home ZIP code? (5 digits – used only to check county-specific programs.)",
    note: "Bot asks ZIP for CMSP · chart also marks other county-residency programs",
  },
  {
    id: "citizen_or_eligible",
    short: "Citizen / eligible",
    label: "Citizen or eligible immigrant",
    question: "Are you a U.S. citizen or an eligible immigrant?",
    note: "Asked after cheaper gates · answer not stored on the session",
  },
  {
    id: "refugee",
    short: "Refugee",
    label: "Refugee / asylee / RCA-eligible newcomer",
    question:
      "Are you a refugee, asylee, or similar eligible newcomer (SIV holder, Afghan or Ukrainian parolee, Cuban/Haitian entrant, or certified trafficking victim)?",
    note: "After citizen/eligible Yes · Refugee Cash Assistance",
  },
  {
    id: "ineligible_immigrant",
    short: "Ineligible path",
    label: "Ineligible-immigrant programs (CAPI / CFAP)",
    question: "Are you a U.S. citizen or an eligible immigrant? → No / Prefer not to say",
    note: "After “No”, or “Prefer not to say” (shown without assuming status)",
  },
];

function cell(needed: boolean, detail = ""): ChartCell {
  return { needed, detail: needed ? detail : "" };
}

function hasTag(tags: readonly string[], id: string): boolean {
  return tags.includes(id);
}

function gatesFor(
  program: Program,
  eligibility: readonly string[],
): Record<ChartGateId, ChartCell> {
  const incomeDetail =
    program.incomeGate === "careBand"
      ? "CARE"
      : program.incomeGate === "feraBand"
        ? "FERA"
        : program.incomeGate === "careOrFeraBand"
          ? "CARE/FERA"
          : "";

  const workDetail =
    program.requiresWorkDisruption === "job_loss"
      ? "job loss"
      : program.requiresWorkDisruption === "health"
        ? "health"
        : program.requiresWorkDisruption === "family_care"
          ? "family care"
          : "";

  const caResidencyNeeded =
    program.requiresCaResidency === true ||
    hasTag(eligibility, "ca_residency") ||
    hasTag(eligibility, "county_residency") ||
    hasTag(eligibility, "participating_utility");
  const caResidencyDetail = program.requiresCaResidency
    ? "bot ask"
    : hasTag(eligibility, "ca_residency")
      ? "CA live"
      : hasTag(eligibility, "county_residency")
        ? "county home"
        : hasTag(eligibility, "participating_utility")
          ? "utility home"
          : "";

  const billsNeeded =
    hasTag(eligibility, "account_in_your_name") || program.id === "esa";
  const billsDetail =
    program.id === "liheap"
      ? "energy/fuel"
      : program.id === "lifeline"
        ? "phone+net"
        : program.id === "ladwp_ez_save"
          ? "LADWP"
          : program.id === "smud_eapr"
            ? "SMUD"
            : program.id === "fera"
              ? "elec IOU"
              : program.id === "care" ||
                  program.id === "esa" ||
                  program.id === "amp" ||
                  program.id === "medical_baseline"
                ? "IOU"
                : billsNeeded
                  ? "PG&E"
                  : "";

  const shutoffNeeded = hasTag(eligibility, "fire_threat_district");

  const countyNeeded =
    program.requiresCmspCounty === true ||
    hasTag(eligibility, "county_residency");
  const countyDetail = program.requiresCmspCounty
    ? "CMSP"
    : hasTag(eligibility, "county_residency")
      ? "county"
      : "";

  const citizenNeeded =
    program.requiresCitizenOrEligibleImmigrant === true ||
    hasTag(eligibility, "citizen_or_eligible_immigrant");
  const ineligibleNeeded =
    program.requiresIneligibleImmigrantStatus === true ||
    hasTag(eligibility, "ssi_denied_for_status");

  return {
    income: cell(Boolean(program.incomeGate), incomeDetail),
    past_due: cell(program.requiresPastDue === true),
    medical_need: cell(
      program.requiresMedicalDeviceOrCondition === true ||
        hasTag(eligibility, "medical_device_or_condition"),
    ),
    ca_residency: cell(caResidencyNeeded, caResidencyDetail),
    utility_bills: cell(billsNeeded, billsDetail),
    shared_meter: cell(
      hasTag(eligibility, "no_shared_meter") ||
        hasTag(eligibility, "not_master_metered"),
      hasTag(eligibility, "not_master_metered")
        ? "not master"
        : hasTag(eligibility, "no_shared_meter")
          ? "own meter"
          : "",
    ),
    shutoff_zone: cell(shutoffNeeded, shutoffNeeded ? "map" : ""),
    buying_ev: cell(program.requiresBuyingEvThisYear === true),
    first_time_zev: cell(program.requiresFirstTimeZev === true),
    child: cell(program.requiresChildInHousehold === true),
    foster_youth: cell(program.requiresFosterYouth === true),
    refugee: cell(
      program.requiresRefugeeOrAsylee === true ||
        hasTag(eligibility, "refugee_or_asylee"),
    ),
    abd: cell(program.requiresAgedBlindOrDisabled === true),
    work: cell(Boolean(program.requiresWorkDisruption), workDetail),
    disaster: cell(program.requiresActiveDisasterWindow === true),
    zip: cell(countyNeeded, countyDetail),
    citizen_or_eligible: cell(citizenNeeded),
    ineligible_immigrant: cell(ineligibleNeeded),
  };
}

export function buildTreeChart(): TreeChart {
  const meta = getLibraryMeta();
  const programs = loadPrograms();
  const matrix = buildProgramMatrix();
  const byId = new Map(matrix.rows.map((r) => [r.id, r]));
  const nameOf = (id: string) =>
    programs.find((p) => p.id === id)?.name ?? byId.get(id)?.name ?? id;

  const rows: ChartProgramRow[] = programs.map((p) => {
    const req = byId.get(p.id);
    const cells = gatesFor(p, req?.eligibility ?? []);
    const gateCount = CHART_COLUMNS.filter((c) => cells[c.id].needed).length;
    const heldStatus = req?.availability.status ?? "open";
    const heldFromOffer = isHeldFromOffer(heldStatus);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      jurisdiction: p.jurisdiction,
      oneLiner: p.oneLiner,
      yesOrder: p.yesOrder,
      noOrder: p.noOrder,
      branches: [...p.branches],
      gateFeeder: p.gateFeeder === true,
      heldFromOffer,
      heldStatus,
      unlocks: req?.unlocks ?? [],
      unlockedBy: req?.unlockedBy ?? [],
      cells,
      gateCount,
    };
  });

  const feeders = rows
    .filter((r) => r.gateFeeder)
    .sort((a, b) => a.yesOrder - b.yesOrder || a.name.localeCompare(b.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      unlocks: r.unlocks.map((id) => ({ id, name: nameOf(id) })),
    }));

  const heldCount = rows.filter((r) => r.heldFromOffer).length;

  return {
    version: meta.version,
    market: meta.market,
    columns: [...CHART_COLUMNS],
    programs: rows,
    feeders,
    banner:
      heldCount > 0
        ? `If you qualify for these programs, you automatically qualify for the other ones they unlock (categorical eligibility). ${heldCount} program(s) are waitlisted/paused/closed – held out of the offer tree; users who qualify can opt in to reopen alerts.`
        : "If you qualify for these programs, you automatically qualify for the other ones they unlock (categorical eligibility). Rows follow message-tree offer order (yesOrder / noOrder) unless you opt into feeders-first.",
  };
}

export type ChartBranch = "yes" | "no";

/**
 * Rewrite yesOrder or noOrder for programs in the given branch, in the order
 * supplied. Programs not in that branch keep their existing number.
 */
export function saveProgramBranchOrder(
  branch: ChartBranch,
  orderedIds: string[],
): TreeChart {
  const programs = loadPrograms();
  const known = new Set(programs.map((p) => p.id));
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of orderedIds) {
    const id = String(raw);
    if (!known.has(id)) throw new Error(`Unknown program: ${id}`);
    if (seen.has(id)) continue;
    const program = programs.find((p) => p.id === id)!;
    if (!program.branches.includes(branch)) {
      throw new Error(`${id} is not on the ${branch.toUpperCase()} arm`);
    }
    seen.add(id);
    cleaned.push(id);
  }

  const expected = programs
    .filter((p) => p.branches.includes(branch))
    .map((p) => p.id);
  if (cleaned.length !== expected.length) {
    throw new Error(
      `Expected ${expected.length} ${branch} programs, got ${cleaned.length}`,
    );
  }

  const orderField = branch === "yes" ? "yesOrder" : "noOrder";
  const nextPrograms = programs.map((p) => ({ ...p }));
  cleaned.forEach((id, index) => {
    const row = nextPrograms.find((p) => p.id === id)!;
    row[orderField] = index + 1;
  });

  const filePath = path.join(LIBRARY_DIR, "programs.json");
  const meta = getLibraryMeta();
  const payload = {
    version: meta.version,
    market: meta.market,
    disclaimer: meta.disclaimer,
    programs: nextPrograms,
  };
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmp, filePath);

  clearProgramsCache();
  return buildTreeChart();
}
