/**
 * Trial / subscription access evaluation for multi-tenant SaaS lock.
 * Super Admin + demo workspaces always allowed.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";

export type BillingAccess = {
  allowed: boolean;
  reason?: "trial_expired" | "subscription_expired" | "suspended" | "locked" | "deleted";
  isTrial: boolean;
  isLocked: boolean;
  planStatus: string;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  subscriptionEndsAt: Date | null;
  businessId: string | null;
  businessName?: string | null;
  plan?: string | null;
};

function daysRemaining(end: Date | null | undefined): number | null {
  if (!end) return null;
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * Enforce standard 3-day free trial window for non-extended trials.
 * Repairs legacy / bad data that shows 13–14 day trials without changing paid or admin-extended trials.
 */
async function normalizeStandardTrial(biz: {
  id: string;
  isTrial: boolean;
  planStatus: string;
  plan: string | null;
  trialDays: number | null;
  trialStartDate: Date | null;
  trialEndsAt: Date | null;
  createdAt?: Date;
}): Promise<{
  trialDays: number | null;
  trialEndsAt: Date | null;
  trialStartDate: Date | null;
}> {
  if (!biz.isTrial && biz.planStatus !== "trial" && biz.plan !== "trial") {
    return {
      trialDays: biz.trialDays,
      trialEndsAt: biz.trialEndsAt,
      trialStartDate: biz.trialStartDate,
    };
  }

  const startDate =
    biz.trialStartDate ||
    (biz as { createdAt?: Date }).createdAt ||
    new Date();

  // Admin-extended trials keep their allotted days (events or explicit trialDays > 3 with extend history)
  const extendEvent = await prisma.subscriptionEvent
    .findFirst({
      where: {
        businessId: biz.id,
        action: { in: ["trial_extend", "extend_trial", "trial_reset"] },
      },
      select: { id: true },
    })
    .catch(() => null);

  if (extendEvent) {
    return {
      trialDays: biz.trialDays,
      trialEndsAt: biz.trialEndsAt,
      trialStartDate: biz.trialStartDate || startDate,
    };
  }

  const STANDARD = 3;
  const allotted = biz.trialDays && biz.trialDays > 0 ? biz.trialDays : STANDARD;
  // Cap un-extended trials at the product standard (3 days)
  const days = Math.min(allotted, STANDARD);
  const expectedEnd = addDays(new Date(startDate), days);
  const end = biz.trialEndsAt ? new Date(biz.trialEndsAt) : expectedEnd;

  // Repair when end is beyond the standard window (e.g. 13–14 day leftovers)
  if (!biz.trialEndsAt || end.getTime() > expectedEnd.getTime() + 60_000 || (biz.trialDays || 0) > STANDARD) {
    await prisma.business
      .update({
        where: { id: biz.id },
        data: {
          trialDays: days,
          trialStartDate: biz.trialStartDate || startDate,
          trialEndsAt: expectedEnd,
        },
      })
      .catch(() => undefined);
    return {
      trialDays: days,
      trialEndsAt: expectedEnd,
      trialStartDate: biz.trialStartDate || startDate,
    };
  }

  return {
    trialDays: days,
    trialEndsAt: end,
    trialStartDate: biz.trialStartDate || startDate,
  };
}

export async function evaluateBillingAccess(userId: string): Promise<BillingAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformRole: true },
  });
  if (user?.platformRole === "super_admin") {
    return {
      allowed: true,
      isTrial: false,
      isLocked: false,
      planStatus: "active",
      trialEndsAt: null,
      trialDaysRemaining: null,
      subscriptionEndsAt: null,
      businessId: null,
    };
  }

  const businessId = await getUserBusinessId(userId);
  if (!businessId) {
    // No business yet — allow profile onboarding paths only (caller decides)
    return {
      allowed: true,
      isTrial: false,
      isLocked: false,
      planStatus: "none",
      trialEndsAt: null,
      trialDaysRemaining: null,
      subscriptionEndsAt: null,
      businessId: null,
    };
  }

  const bizRaw = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      status: true,
      isDemo: true,
      portalKind: true,
      plan: true,
      planStatus: true,
      isTrial: true,
      isLocked: true,
      trialEndsAt: true,
      trialStartDate: true,
      subscriptionEndsAt: true,
      trialDays: true,
      gracePeriodDays: true,
      createdAt: true,
    },
  });

  if (!bizRaw) {
    return {
      allowed: false,
      reason: "deleted",
      isTrial: false,
      isLocked: true,
      planStatus: "deleted",
      trialEndsAt: null,
      trialDaysRemaining: null,
      subscriptionEndsAt: null,
      businessId,
    };
  }

  // Normalize 3-day free trial (repair inflated remaining days from bad data)
  const trialNorm = await normalizeStandardTrial(bizRaw);
  const biz = {
    ...bizRaw,
    trialDays: trialNorm.trialDays,
    trialEndsAt: trialNorm.trialEndsAt,
    trialStartDate: trialNorm.trialStartDate,
  };

  // Demo portal never locked by billing
  if (biz.isDemo || biz.portalKind === "demo") {
    return {
      allowed: true,
      isTrial: false,
      isLocked: false,
      planStatus: "active",
      trialEndsAt: null,
      trialDaysRemaining: null,
      subscriptionEndsAt: null,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  if (biz.status === "deleted") {
    return {
      allowed: false,
      reason: "deleted",
      isTrial: !!biz.isTrial,
      isLocked: true,
      planStatus: biz.planStatus,
      trialEndsAt: biz.trialEndsAt,
      trialDaysRemaining: daysRemaining(biz.trialEndsAt),
      subscriptionEndsAt: biz.subscriptionEndsAt,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  if (biz.status === "suspended" || biz.planStatus === "suspended" || biz.isLocked) {
    return {
      allowed: false,
      reason: biz.isLocked ? "locked" : "suspended",
      isTrial: !!biz.isTrial,
      isLocked: true,
      planStatus: biz.planStatus,
      trialEndsAt: biz.trialEndsAt,
      trialDaysRemaining: daysRemaining(biz.trialEndsAt),
      subscriptionEndsAt: biz.subscriptionEndsAt,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  const now = Date.now();

  // Paid / active subscription
  if (
    !biz.isTrial &&
    (biz.planStatus === "active" || biz.planStatus === "past_due") &&
    biz.subscriptionEndsAt &&
    new Date(biz.subscriptionEndsAt).getTime() > now
  ) {
    return {
      allowed: true,
      isTrial: false,
      isLocked: false,
      planStatus: biz.planStatus,
      trialEndsAt: biz.trialEndsAt,
      trialDaysRemaining: daysRemaining(biz.trialEndsAt),
      subscriptionEndsAt: biz.subscriptionEndsAt,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  if (!biz.isTrial && biz.planStatus === "active" && !biz.subscriptionEndsAt) {
    // Legacy active paid without end date — allow
    return {
      allowed: true,
      isTrial: false,
      isLocked: false,
      planStatus: "active",
      trialEndsAt: biz.trialEndsAt,
      trialDaysRemaining: null,
      subscriptionEndsAt: null,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  // Trial path
  if (biz.isTrial || biz.planStatus === "trial" || biz.plan === "trial") {
    const trialEnd = biz.trialEndsAt;
    if (trialEnd && new Date(trialEnd).getTime() > now) {
      return {
        allowed: true,
        isTrial: true,
        isLocked: false,
        planStatus: "trial",
        trialEndsAt: trialEnd,
        trialDaysRemaining: daysRemaining(trialEnd),
        subscriptionEndsAt: biz.subscriptionEndsAt,
        businessId: biz.id,
        businessName: biz.name,
        plan: biz.plan,
      };
    }
    // Trial expired
    return {
      allowed: false,
      reason: "trial_expired",
      isTrial: true,
      isLocked: true,
      planStatus: "expired",
      trialEndsAt: trialEnd,
      trialDaysRemaining: 0,
      subscriptionEndsAt: biz.subscriptionEndsAt,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  if (biz.subscriptionEndsAt && new Date(biz.subscriptionEndsAt).getTime() <= now) {
    const grace = biz.gracePeriodDays ?? 3;
    const graceEnd = new Date(biz.subscriptionEndsAt).getTime() + grace * 86400000;
    if (now <= graceEnd && !biz.isLocked) {
      // Optional grace — CRM still allowed, past_due
      return {
        allowed: true,
        isTrial: false,
        isLocked: false,
        planStatus: "past_due",
        trialEndsAt: biz.trialEndsAt,
        trialDaysRemaining: daysRemaining(biz.trialEndsAt),
        subscriptionEndsAt: biz.subscriptionEndsAt,
        businessId: biz.id,
        businessName: biz.name,
        plan: biz.plan,
      };
    }
    return {
      allowed: false,
      reason: "subscription_expired",
      isTrial: false,
      isLocked: true,
      planStatus: "expired",
      trialEndsAt: biz.trialEndsAt,
      trialDaysRemaining: daysRemaining(biz.trialEndsAt),
      subscriptionEndsAt: biz.subscriptionEndsAt,
      businessId: biz.id,
      businessName: biz.name,
      plan: biz.plan,
    };
  }

  return {
    allowed: true,
    isTrial: !!biz.isTrial,
    isLocked: false,
    planStatus: biz.planStatus,
    trialEndsAt: biz.trialEndsAt,
    trialDaysRemaining: daysRemaining(biz.trialEndsAt),
    subscriptionEndsAt: biz.subscriptionEndsAt,
    businessId: biz.id,
    businessName: biz.name,
    plan: biz.plan,
  };
}

/** Persist lock flags when access is denied (idempotent). */
export async function enforceLockIfNeeded(access: BillingAccess): Promise<void> {
  if (!access.businessId || access.allowed) return;
  if (!access.reason) return;
  await prisma.business.update({
    where: { id: access.businessId },
    data: {
      isLocked: true,
      planStatus: access.reason === "suspended" ? "suspended" : "expired",
      licenseStatus: "expired",
    },
  }).catch(() => undefined);
}
