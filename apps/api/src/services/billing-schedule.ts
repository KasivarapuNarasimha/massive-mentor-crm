/**
 * Pure decisions for a downgrade that was paid now and starts later.
 * No database access. The job applies a decision once, then clears the schedule.
 */

export type ScheduledPlanIntent = {
  planCode: string;
  effectiveAt: string;
  paymentId: string | null;
  subscriptionId: string | null;
};

export type ScheduleSkipReason = "not_scheduled" | "before_effective_date" | "already_applied";
export type ScheduleFailReason =
  | "invalid_effective_date"
  | "plan_not_found"
  | "subscription_not_found";

export type ScheduleDecision =
  | { outcome: "skip"; reason: ScheduleSkipReason }
  | { outcome: "fail"; reason: ScheduleFailReason }
  | { outcome: "apply"; intent: ScheduledPlanIntent; appliedKey: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function scheduleKey(planCode: string, effectiveAt: string): string {
  return `${planCode}@${effectiveAt}`;
}

export function scheduledPlanSettings(input: {
  planCode: string;
  effectiveAt: string;
  paymentId: string;
  subscriptionId: string;
}): Record<string, string> {
  return {
    scheduledPlanCode: input.planCode,
    scheduledPlanAt: input.effectiveAt,
    scheduledPaymentId: input.paymentId,
    scheduledSubscriptionId: input.subscriptionId,
  };
}

export function readScheduledPlan(settings: unknown): ScheduledPlanIntent | null {
  const record = asRecord(settings);
  if (!record) return null;
  const planCode = text(record.scheduledPlanCode);
  const effectiveAt = text(record.scheduledPlanAt);
  if (!planCode || !effectiveAt) return null;
  return {
    planCode,
    effectiveAt,
    paymentId: text(record.scheduledPaymentId),
    subscriptionId: text(record.scheduledSubscriptionId),
  };
}

/**
 * Before the effective instant, do nothing.
 * On or after that instant, apply once.
 * A second call sees the applied key and does nothing.
 * A missing plan or subscription fails without a patch.
 */
export function evaluateScheduledPlan(input: {
  settings: unknown;
  now: Date;
  planFound: boolean;
  subscriptionFound: boolean;
}): ScheduleDecision {
  const record = asRecord(input.settings) ?? {};
  const appliedKey = text(record.scheduledPlanAppliedKey);
  const intent = readScheduledPlan(input.settings);
  if (!intent) {
    return appliedKey
      ? { outcome: "skip", reason: "already_applied" }
      : { outcome: "skip", reason: "not_scheduled" };
  }

  const effectiveMs = new Date(intent.effectiveAt).getTime();
  if (!Number.isFinite(effectiveMs)) {
    return { outcome: "fail", reason: "invalid_effective_date" };
  }
  const key = scheduleKey(intent.planCode, intent.effectiveAt);
  if (appliedKey === key) {
    return { outcome: "skip", reason: "already_applied" };
  }
  if (input.now.getTime() < effectiveMs) {
    return { outcome: "skip", reason: "before_effective_date" };
  }
  if (!input.planFound) return { outcome: "fail", reason: "plan_not_found" };
  if (!input.subscriptionFound) return { outcome: "fail", reason: "subscription_not_found" };
  return { outcome: "apply", intent, appliedKey: key };
}

export function settingsAfterApply(
  settings: unknown,
  applied: { planCode: string; effectiveAt: string; appliedAt: string }
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(asRecord(settings) ?? {}) };
  delete next.scheduledPlanCode;
  delete next.scheduledPlanAt;
  delete next.scheduledPaymentId;
  delete next.scheduledSubscriptionId;
  next.scheduledPlanAppliedKey = scheduleKey(applied.planCode, applied.effectiveAt);
  next.scheduledPlanAppliedAt = applied.appliedAt;
  next.scheduledPlanAppliedCode = applied.planCode;
  return next;
}

/** Business fields switched on the effective date. setupFeePaid is intentionally absent. */
export function entitlementPatch(input: {
  planCode: string;
  planId: string;
  maxUsers: number;
  subscriptionEndsAt: Date;
}): { plan: string; planId: string; maxUsers: number; subscriptionEndsAt: Date } {
  const family = input.planCode.split("_")[0] || "professional";
  return {
    plan: family,
    planId: input.planId,
    maxUsers: input.maxUsers,
    subscriptionEndsAt: input.subscriptionEndsAt,
  };
}

export function seatCapFromPayment(metadata: unknown, planMaxUsers: number): number {
  const record = asRecord(metadata);
  if (record?.pricingVersion === "2026-per-user") {
    const count = Number(record.userCount);
    if (Number.isInteger(count) && count > 0) return count;
  }
  return planMaxUsers;
}
