/**
 * Canonical Lead pipeline statuses for ALL workspaces / business types.
 * Contact.status is a free string in DB (not a Prisma enum) — these are product defaults.
 * Keep in sync with apps/web/lib/business-config.ts FALLBACK_LEAD_STATUSES.
 */

export type LeadStatusDef = {
  key: string;
  label: string;
  order: number;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
  /** Telecalling / call-result statuses (not classic sales pipeline stages) */
  isCallResult?: boolean;
};

/** Classic pipeline — preserve order and keys exactly */
export const CLASSIC_LEAD_STATUSES: LeadStatusDef[] = [
  { key: "new", label: "New", color: "#3b82f6", order: 1 },
  { key: "contacted", label: "Contacted", color: "#8b5cf6", order: 2 },
  { key: "qualified", label: "Qualified", color: "#06b6d4", order: 3 },
  { key: "proposal", label: "Proposal Sent", color: "#f59e0b", order: 4 },
  { key: "negotiation", label: "Negotiation", color: "#f97316", order: 5 },
  { key: "won", label: "Won", color: "#22c55e", isWon: true, order: 6 },
  { key: "lost", label: "Lost", color: "#ef4444", isLost: true, order: 7 },
];

/** Global call-result statuses (telecalling) — all business types */
export const CALL_RESULT_LEAD_STATUSES: LeadStatusDef[] = [
  { key: "rnr", label: "RNR", color: "#64748b", order: 10, isCallResult: true },
  { key: "busy", label: "Busy", color: "#94a3b8", order: 11, isCallResult: true },
  { key: "call_back", label: "Call back", color: "#38bdf8", order: 12, isCallResult: true },
  { key: "not_interested", label: "Not interested", color: "#f87171", order: 13, isCallResult: true },
  { key: "interested", label: "Interested", color: "#34d399", order: 14, isCallResult: true },
  { key: "switch_off", label: "Switch off", color: "#a78bfa", order: 15, isCallResult: true },
  { key: "no_incoming_calls", label: "No Incoming calls", color: "#fb923c", order: 16, isCallResult: true },
  { key: "invalid_number", label: "Invalid number", color: "#ef4444", order: 17, isCallResult: true },
];

/** Full default list for UI / seed / import */
export const CANONICAL_LEAD_STATUSES: LeadStatusDef[] = [
  ...CLASSIC_LEAD_STATUSES,
  ...CALL_RESULT_LEAD_STATUSES,
];

const CALL_RESULT_KEYS = new Set(CALL_RESULT_LEAD_STATUSES.map((s) => s.key));

export function isCallResultStatus(status: string): boolean {
  const s = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  return CALL_RESULT_KEYS.has(s);
}

/**
 * Map Lead status → Deal pipeline stage (existing architecture).
 * Call results land on open pipeline stages so My Deals still shows the deal;
 * the human call result is also stored on deal.customFields.leadStatus and contact.status.
 */
export function leadStatusToDealStageKey(status: string): string | null {
  const s = (status || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!s) return null;

  // Classic
  if (s === "new" || s === "contacted") return "lead";
  if (s === "qualified") return "qualified";
  if (s === "proposal" || s === "proposal_sent" || s === "proposalsent") return "proposal";
  if (s === "negotiation" || s === "negotiating") return "negotiation";
  if (s === "won" || s === "closed_won" || s === "active") return "closed_won";
  if (s === "lost" || s === "closed_lost" || s === "churned") return "closed_lost";

  // Call results
  if (s === "interested") return "qualified";
  if (s === "not_interested" || s === "invalid_number") return "closed_lost";
  if (
    s === "rnr" ||
    s === "busy" ||
    s === "call_back" ||
    s === "callback" ||
    s === "switch_off" ||
    s === "switchoff" ||
    s === "no_incoming_calls" ||
    s === "no_incoming" ||
    s === "noincomingcalls"
  ) {
    return "lead";
  }

  return null;
}

export function leadStatusLabel(status: string): string {
  const s = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  const hit = CANONICAL_LEAD_STATUSES.find((x) => x.key === s);
  if (hit) return hit.label;
  if (!status) return "";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Merge config pipeline statuses with canonical defaults (never drop call results globally). */
export function mergeLeadStatusesWithCanonical(
  fromConfig: Array<{ key: string; label: string; color?: string; order?: number; isWon?: boolean; isLost?: boolean }>
): LeadStatusDef[] {
  const byKey = new Map<string, LeadStatusDef>();
  for (const s of fromConfig) {
    if (!s?.key) continue;
    byKey.set(s.key, {
      key: s.key,
      label: s.label || s.key,
      order: s.order ?? 50,
      color: s.color,
      isWon: s.isWon,
      isLost: s.isLost,
    });
  }
  if (byKey.has("proposal") && byKey.get("proposal")!.label?.toLowerCase() === "proposal") {
    byKey.set("proposal", { ...byKey.get("proposal")!, label: "Proposal Sent" });
  }
  for (const req of CANONICAL_LEAD_STATUSES) {
    if (!byKey.has(req.key)) byKey.set(req.key, { ...req });
  }
  return [...byKey.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
