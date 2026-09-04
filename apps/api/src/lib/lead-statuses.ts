/**
 * Unified Lead + Deal status vocabulary (all workspaces / business types).
 * Contact.status and Deal.stage both use these keys.
 * Contact.status remains a free String in Prisma (no enum migration).
 *
 * Keep in sync with apps/web/lib/business-config.ts FALLBACK_LEAD_STATUSES
 * and apps/web deal Kanban STAGES.
 */

export type LeadStatusDef = {
  key: string;
  label: string;
  order: number;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
  isCallResult?: boolean;
  /** Soft-archive without rewriting Contact.status values */
  active?: boolean;
};

/** Keys that cannot be deleted, archived, or remapped */
export const IMMUTABLE_LEAD_STATUS_KEYS = new Set(["won", "lost"]);

/**
 * Final product list (15 statuses) — Lead dropdown + Deal Kanban columns.
 */
export const UNIFIED_PIPELINE_STATUSES: LeadStatusDef[] = [
  { key: "new", label: "New", color: "#3b82f6", order: 1 },
  { key: "rnr", label: "RNR", color: "#64748b", order: 2, isCallResult: true },
  { key: "contacted", label: "Contacted", color: "#8b5cf6", order: 3 },
  { key: "busy", label: "Busy", color: "#94a3b8", order: 4, isCallResult: true },
  { key: "qualified", label: "Qualified", color: "#06b6d4", order: 5 },
  { key: "call_back", label: "Call back", color: "#38bdf8", order: 6, isCallResult: true },
  { key: "proposal", label: "Proposal Sent", color: "#f59e0b", order: 7 },
  { key: "not_interested", label: "Not interested", color: "#f87171", order: 8, isCallResult: true },
  { key: "negotiation", label: "Negotiation", color: "#f97316", order: 9 },
  { key: "interested", label: "Interested", color: "#34d399", order: 10, isCallResult: true },
  { key: "switch_off", label: "Switch off", color: "#a78bfa", order: 11, isCallResult: true },
  { key: "no_incoming_calls", label: "No Incoming calls", color: "#fb923c", order: 12, isCallResult: true },
  { key: "invalid_number", label: "Invalid number", color: "#ef4444", order: 13, isCallResult: true },
  { key: "won", label: "Won", color: "#22c55e", isWon: true, order: 14 },
  { key: "lost", label: "Lost", color: "#ef4444", isLost: true, order: 15 },
];

/** @deprecated alias — product defaults */
export const TELECALLING_LEAD_STATUSES = UNIFIED_PIPELINE_STATUSES;
export const CANONICAL_LEAD_STATUSES = UNIFIED_PIPELINE_STATUSES;
export const ALL_KNOWN_LEAD_STATUSES = UNIFIED_PIPELINE_STATUSES;

const UNIFIED_KEYS = new Set(UNIFIED_PIPELINE_STATUSES.map((s) => s.key));

const CALL_RESULT_KEYS = new Set(
  UNIFIED_PIPELINE_STATUSES.filter((s) => s.isCallResult).map((s) => s.key)
);

export function isCallResultStatus(status: string): boolean {
  const s = normalizeStatusKey(status);
  return CALL_RESULT_KEYS.has(s);
}

/**
 * Normalize any stored Lead status or Deal stage to the unified 15-key vocabulary.
 * Legacy Deal stages: lead→new, closed_won→won, closed_lost→lost, etc.
 */
export function normalizeStatusKey(raw: string | null | undefined): string {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  // Legacy deal pipeline → unified keys
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

  if (UNIFIED_KEYS.has(s)) return s;
  return s || "new";
}

/** Lead status → Deal stage: 1:1 same vocabulary */
export function leadStatusToDealStageKey(status: string): string | null {
  const s = normalizeStatusKey(status);
  if (!s) return null;
  if (UNIFIED_KEYS.has(s)) return s;
  return null;
}

export function leadStatusLabel(status: string): string {
  const s = normalizeStatusKey(status);
  const hit = UNIFIED_PIPELINE_STATUSES.find((x) => x.key === s);
  if (hit) return hit.label;
  if (!status) return "";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type LeadStatusConfigInput = {
  key: string;
  label?: string;
  color?: string;
  order?: number;
  isWon?: boolean;
  isLost?: boolean;
  active?: boolean;
};

/**
 * Soft-merge BusinessConfig pipeline statuses with unified defaults.
 * Config may add statuses, rename labels, reorder, and archive (active:false).
 * Keys are stable — renames are label-only (never rewrite Contact.status).
 * won/lost keys are always present and cannot be archived away.
 */
export function mergeLeadStatusesWithCanonical(
  fromConfig: LeadStatusConfigInput[]
): LeadStatusDef[] {
  const byKey = new Map<string, LeadStatusDef>();

  for (const s of UNIFIED_PIPELINE_STATUSES) {
    byKey.set(s.key, { ...s, active: true });
  }

  for (const s of fromConfig) {
    if (!s?.key) continue;
    const nk = normalizeStatusKey(s.key);
    const existing = byKey.get(nk);
    if (existing) {
      const immutable = IMMUTABLE_LEAD_STATUS_KEYS.has(nk);
      byKey.set(nk, {
        ...existing,
        label: s.label?.trim() ? s.label.trim() : existing.label,
        color: s.color || existing.color,
        // Soft: respect tenant order when provided
        order: typeof s.order === "number" ? s.order : existing.order,
        active: immutable ? true : s.active !== false,
        isWon: nk === "won" ? true : s.isWon ?? existing.isWon,
        isLost: nk === "lost" ? true : s.isLost ?? existing.isLost,
      });
    } else {
      // Custom / extra status from BusinessConfig
      byKey.set(nk, {
        key: nk,
        label: (s.label || s.key).trim() || nk,
        order: typeof s.order === "number" ? s.order : 50 + byKey.size,
        color: s.color,
        isWon: s.isWon,
        isLost: s.isLost,
        active: s.active !== false,
      });
    }
  }

  // Prefer "Proposal Sent" label for proposal when still generic
  if (byKey.has("proposal")) {
    const p = byKey.get("proposal")!;
    if (!p.label || p.label.toLowerCase() === "proposal") {
      byKey.set("proposal", { ...p, label: "Proposal Sent" });
    }
  }

  // won/lost always present
  for (const key of IMMUTABLE_LEAD_STATUS_KEYS) {
    const hit = byKey.get(key);
    if (!hit) {
      const canonical = UNIFIED_PIPELINE_STATUSES.find((x) => x.key === key)!;
      byKey.set(key, { ...canonical, active: true });
    } else {
      byKey.set(key, {
        ...hit,
        key,
        active: true,
        isWon: key === "won" ? true : hit.isWon,
        isLost: key === "lost" ? true : hit.isLost,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Active statuses for pickers; keepValue stays visible even if archived */
export function activeLeadStatuses(
  statuses: LeadStatusDef[],
  keepValue?: string | null
): LeadStatusDef[] {
  const keep = keepValue != null && keepValue !== "" ? normalizeStatusKey(keepValue) : null;
  return statuses.filter((s) => s.active !== false || (keep != null && s.key === keep));
}

export function isWonStatusKey(status: string): boolean {
  const s = normalizeStatusKey(status);
  return s === "won" || s === "active";
}

export function isLostStatusKey(status: string): boolean {
  const s = normalizeStatusKey(status);
  return s === "lost" || s === "churned" || s === "dead";
}

export function isClosedStatusKey(status: string): boolean {
  return isWonStatusKey(status) || isLostStatusKey(status);
}
