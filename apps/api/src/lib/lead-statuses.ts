/**
 * Canonical Lead statuses for ALL workspaces / business types.
 * Contact.status is a free String in DB (not a Prisma enum).
 * Keep UI FALLBACK_LEAD_STATUSES in apps/web/lib/business-config.ts in sync.
 */

export type LeadStatusDef = {
  key: string;
  label: string;
  order: number;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
  isCallResult?: boolean;
  /** Older sales-pipeline keys kept for existing data only */
  isLegacy?: boolean;
};

/**
 * Primary telecalling Lead workflow (Edit Lead / filters).
 * Order matches product requirement.
 */
export const TELECALLING_LEAD_STATUSES: LeadStatusDef[] = [
  { key: "new", label: "New", color: "#3b82f6", order: 1 },
  { key: "rnr", label: "RNR", color: "#64748b", order: 2, isCallResult: true },
  { key: "busy", label: "Busy", color: "#94a3b8", order: 3, isCallResult: true },
  { key: "call_back", label: "Call back", color: "#38bdf8", order: 4, isCallResult: true },
  { key: "not_interested", label: "Not interested", color: "#f87171", order: 5, isCallResult: true },
  { key: "interested", label: "Interested", color: "#34d399", order: 6, isCallResult: true },
  { key: "switch_off", label: "Switch off", color: "#a78bfa", order: 7, isCallResult: true },
  { key: "no_incoming_calls", label: "No Incoming calls", color: "#fb923c", order: 8, isCallResult: true },
  { key: "invalid_number", label: "Invalid number", color: "#ef4444", order: 9, isCallResult: true },
  { key: "won", label: "Won", color: "#22c55e", isWon: true, order: 10 },
  { key: "lost", label: "Lost", color: "#ef4444", isLost: true, order: 11 },
];

/**
 * Legacy sales-pipeline keys — still valid in DB and sync maps.
 * Shown in dropdown only so existing records remain editable/filterable.
 */
export const LEGACY_LEAD_STATUSES: LeadStatusDef[] = [
  { key: "contacted", label: "Contacted", color: "#8b5cf6", order: 20, isLegacy: true },
  { key: "qualified", label: "Qualified", color: "#06b6d4", order: 21, isLegacy: true },
  { key: "proposal", label: "Proposal Sent", color: "#f59e0b", order: 22, isLegacy: true },
  { key: "negotiation", label: "Negotiation", color: "#f97316", order: 23, isLegacy: true },
];

/** Product defaults (primary telecalling list) */
export const CANONICAL_LEAD_STATUSES: LeadStatusDef[] = [...TELECALLING_LEAD_STATUSES];

/** All known keys for labels + mapping (primary + legacy) */
export const ALL_KNOWN_LEAD_STATUSES: LeadStatusDef[] = [
  ...TELECALLING_LEAD_STATUSES,
  ...LEGACY_LEAD_STATUSES,
];

const CALL_RESULT_KEYS = new Set(
  TELECALLING_LEAD_STATUSES.filter((s) => s.isCallResult).map((s) => s.key)
);

export function isCallResultStatus(status: string): boolean {
  const s = (status || "").trim().toLowerCase().replace(/\s+/g, "_");
  return CALL_RESULT_KEYS.has(s);
}

/**
 * Map Lead status → Deal pipeline stage (Deal pipeline is separate; do not replace Deal stages).
 */
export function leadStatusToDealStageKey(status: string): string | null {
  const s = (status || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!s) return null;

  if (s === "new" || s === "contacted") return "lead";
  if (s === "qualified") return "qualified";
  if (s === "proposal" || s === "proposal_sent" || s === "proposalsent") return "proposal";
  if (s === "negotiation" || s === "negotiating") return "negotiation";
  if (s === "won" || s === "closed_won" || s === "active") return "closed_won";
  if (s === "lost" || s === "closed_lost" || s === "churned") return "closed_lost";

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
  const hit = ALL_KNOWN_LEAD_STATUSES.find((x) => x.key === s);
  if (hit) return hit.label;
  if (!status) return "";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Merge BusinessConfig pipeline with telecalling defaults.
 * - Always ensure telecalling statuses exist (all workspaces)
 * - Preserve custom config statuses
 * - Keep legacy keys available for existing data
 * - Sort: telecalling order first, then extras
 */
export function mergeLeadStatusesWithCanonical(
  fromConfig: Array<{
    key: string;
    label: string;
    color?: string;
    order?: number;
    isWon?: boolean;
    isLost?: boolean;
  }>
): LeadStatusDef[] {
  const byKey = new Map<string, LeadStatusDef>();

  // 1) Primary telecalling list (product order)
  for (const s of TELECALLING_LEAD_STATUSES) {
    byKey.set(s.key, { ...s });
  }

  // 2) Overlay / add from BusinessConfig (custom labels + extra keys)
  for (const s of fromConfig) {
    if (!s?.key) continue;
    const existing = byKey.get(s.key);
    if (existing) {
      byKey.set(s.key, {
        ...existing,
        label: s.label || existing.label,
        color: s.color || existing.color,
        isWon: s.isWon ?? existing.isWon,
        isLost: s.isLost ?? existing.isLost,
        // keep telecalling order for known keys
        order: existing.order,
      });
    } else {
      byKey.set(s.key, {
        key: s.key,
        label: s.label || s.key,
        order: s.order ?? 50,
        color: s.color,
        isWon: s.isWon,
        isLost: s.isLost,
      });
    }
  }

  if (byKey.has("proposal") && byKey.get("proposal")!.label?.toLowerCase() === "proposal") {
    byKey.set("proposal", { ...byKey.get("proposal")!, label: "Proposal Sent" });
  }

  // 3) Legacy keys for existing Contact.status values
  for (const leg of LEGACY_LEAD_STATUSES) {
    if (!byKey.has(leg.key)) byKey.set(leg.key, { ...leg });
  }

  return [...byKey.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
