/**
 * Unified Lead + Deal status vocabulary (browser).
 * Keep in sync with apps/api/src/lib/lead-statuses.ts
 */

export type PipelineStatusDef = {
  key: string;
  label: string;
  order: number;
  color?: string;
};

/** Exact 15 columns for Lead dropdown + Deal Kanban */
export const UNIFIED_PIPELINE_STATUSES: PipelineStatusDef[] = [
  { key: "new", label: "New", order: 1 },
  { key: "rnr", label: "RNR", order: 2 },
  { key: "contacted", label: "Contacted", order: 3 },
  { key: "busy", label: "Busy", order: 4 },
  { key: "qualified", label: "Qualified", order: 5 },
  { key: "call_back", label: "Call back", order: 6 },
  { key: "proposal", label: "Proposal Sent", order: 7 },
  { key: "not_interested", label: "Not interested", order: 8 },
  { key: "negotiation", label: "Negotiation", order: 9 },
  { key: "interested", label: "Interested", order: 10 },
  { key: "switch_off", label: "Switch off", order: 11 },
  { key: "no_incoming_calls", label: "No Incoming calls", order: 12 },
  { key: "invalid_number", label: "Invalid number", order: 13 },
  { key: "won", label: "Won", order: 14 },
  { key: "lost", label: "Lost", order: 15 },
];

export const UNIFIED_STATUS_KEYS = UNIFIED_PIPELINE_STATUSES.map((s) => s.key);

const KEY_SET = new Set(UNIFIED_STATUS_KEYS);

/** Map legacy Deal.stage / Lead status aliases → unified keys */
export function normalizePipelineStatus(raw: string | null | undefined): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (s === "lead" || s === "new_lead") return "new";
  if (s === "closed_won" || s === "closedwon" || s === "active") return "won";
  if (s === "closed_lost" || s === "closedlost" || s === "churned" || s === "dead") return "lost";
  if (s === "proposal_sent" || s === "proposalsent" || s === "propose" || s === "quoted")
    return "proposal";
  if (s === "callback") return "call_back";
  if (s === "switchoff") return "switch_off";
  if (s === "no_incoming" || s === "noincomingcalls") return "no_incoming_calls";
  if (s === "qualification") return "qualified";
  if (s === "negotiate" || s === "negotiating") return "negotiation";

  if (KEY_SET.has(s)) return s;
  return s || "new";
}

export function pipelineStatusLabel(key: string): string {
  const k = normalizePipelineStatus(key);
  return UNIFIED_PIPELINE_STATUSES.find((s) => s.key === k)?.label || key;
}
