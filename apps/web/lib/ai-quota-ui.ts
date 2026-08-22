/**
 * Detect CRM Massive Mentor AI daily quota exhaustion from API responses.
 * Does not invent plan/limit values beyond parsing API fields or branded message text.
 */

import type { ApiResponse } from "@/types/api";

export const AI_QUOTA_BILLING_HREF = "/dashboard/billing";

export const AI_QUOTA_PLAN_ROWS: Array<{
  key: string;
  label: string;
  limitLabel: string;
}> = [
  { key: "starter", label: "Starter", limitLabel: "50 AI actions/day" },
  { key: "professional", label: "Professional", limitLabel: "150 AI actions/day" },
  { key: "business", label: "Business", limitLabel: "300 AI actions/day" },
  { key: "enterprise", label: "Enterprise / White Label", limitLabel: "Custom / High Limit" },
];

export type AiQuotaExhaustionInfo = {
  planLabel: string;
  dailyLimit: number;
  message: string;
};

/** True only for CRM AI quota gate — not generic AI errors or provider scrub messages alone. */
export function isAiQuotaExceededResponse(
  res: Pick<ApiResponse, "success" | "code" | "status" | "error"> | null | undefined
): boolean {
  if (!res || res.success) return false;
  if (res.code === "AI_QUOTA_EXCEEDED") return true;
  if (res.status === 429 && /massive mentor ai usage limit reached/i.test(String(res.error || ""))) {
    return true;
  }
  return false;
}

export function parseAiQuotaExhaustion(
  res: Pick<ApiResponse, "success" | "error" | "planLabel" | "dailyLimit" | "code" | "status">
): AiQuotaExhaustionInfo | null {
  if (!isAiQuotaExceededResponse(res)) return null;
  const message = String(res.error || "Massive Mentor AI usage limit reached");
  let planLabel = typeof res.planLabel === "string" && res.planLabel.trim() ? res.planLabel.trim() : "";
  let dailyLimit = typeof res.dailyLimit === "number" && res.dailyLimit > 0 ? res.dailyLimit : 0;

  if (!planLabel || !dailyLimit) {
    const m = message.match(
      /You've used your\s+(\d+)\s+AI actions for today on the\s+(.+?)\s+plan/i
    );
    if (m) {
      if (!dailyLimit) dailyLimit = Number(m[1]);
      if (!planLabel) planLabel = m[2].trim();
    }
  }

  if (!planLabel) planLabel = "Starter";
  if (!dailyLimit) dailyLimit = 50;

  return { planLabel, dailyLimit, message };
}

export function matchPlanRowKey(planLabel: string): string {
  const p = planLabel.toLowerCase();
  if (p.includes("enterprise") || p.includes("white")) return "enterprise";
  if (p.includes("business")) return "business";
  if (p.includes("professional") || p === "pro") return "professional";
  return "starter";
}
