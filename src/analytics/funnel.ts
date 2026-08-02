import { recordEvent } from "./db.js";

/** Ordered CX pipeline stages for funder fall-off chart. */
export const FUNNEL_STAGES = [
  {
    id: "reached",
    label: "Found CalClaim",
    detail: "QR scan or shared link",
  },
  {
    id: "bot_start",
    label: "Opened CalClaim",
    detail: "Started a session",
  },
  {
    id: "started",
    label: "Tapped Start",
    detail: "Opt-in → gate",
  },
  {
    id: "gate_done",
    label: "Completed gate",
    detail: "Categorical programs yes/none",
  },
  {
    id: "triage_done",
    label: "Completed triage",
    detail: "Income / past-due → offer queue",
  },
  {
    id: "first_offer",
    label: "Saw first offer",
    detail: "First program card shown",
  },
  {
    id: "apply_open",
    label: "Opened apply page",
    detail: "Click through to official site",
  },
  {
    id: "follow_through",
    label: "Added to list",
    detail: "“I opened it — add to list”",
  },
  {
    id: "finished",
    label: "Finished queue",
    detail: "Got to-do list / benefits report",
  },
] as const;

export type FunnelStageId = (typeof FUNNEL_STAGES)[number]["id"];

const STAGE_SET = new Set<string>(FUNNEL_STAGES.map((s) => s.id));

export function isFunnelStage(id: string): id is FunnelStageId {
  return STAGE_SET.has(id);
}

export function trackFunnel(
  stage: FunnelStageId,
  telegramUserId?: number | null,
  extras?: { programId?: string | null; campaignId?: string | null },
): void {
  recordEvent({
    eventType: "funnel",
    source: "bot",
    telegramUserId: telegramUserId ?? null,
    programId: extras?.programId ?? null,
    campaignId: extras?.campaignId ?? null,
    label: stage,
  });
}
