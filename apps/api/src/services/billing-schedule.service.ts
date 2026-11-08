/**
 * Applies a paid downgrade when scheduledPlanAt is reached.
 * Runs inside the existing daily billing job. Does not create payments,
 * invoices, or subscriptions, and does not change setupFeePaid.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  entitlementPatch,
  evaluateScheduledPlan,
  readScheduledPlan,
  seatCapFromPayment,
  settingsAfterApply,
} from "./billing-schedule.js";

const START_TOLERANCE_MS = 1000;

export async function applyDueScheduledPlanChanges(now = new Date()): Promise<{
  applied: number;
  skipped: number;
  failed: number;
}> {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Business"
    WHERE status <> 'deleted'
      AND COALESCE(settings->>'scheduledPlanCode', '') <> ''
    LIMIT 500
  `;

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of ids) {
    try {
      const outcome = await applyOneScheduledPlan(row.id, now);
      if (outcome === "apply") applied += 1;
      else if (outcome === "fail") failed += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(
        "[billing] scheduled plan apply failed",
        row.id,
        err instanceof Error ? err.message : "error"
      );
    }
  }
  return { applied, skipped, failed };
}

async function applyOneScheduledPlan(
  businessId: string,
  now: Date
): Promise<"apply" | "skip" | "fail"> {
  return prisma.$transaction(async (tx) => {
    const biz = await tx.business.findUnique({
      where: { id: businessId },
      select: { id: true, settings: true, plan: true },
    });
    if (!biz) return "fail";

    const early = evaluateScheduledPlan({
      settings: biz.settings,
      now,
      planFound: true,
      subscriptionFound: true,
    });
    if (early.outcome === "skip") return "skip";
    if (early.outcome === "fail") return "fail";

    const intent = readScheduledPlan(biz.settings);
    if (!intent) return "skip";

    const plan = await tx.subscriptionPlan.findUnique({ where: { code: intent.planCode } });
    const subscription = intent.subscriptionId
      ? await tx.subscription.findFirst({
          where: { id: intent.subscriptionId, businessId },
          include: { plan: true },
        })
      : await tx.subscription.findFirst({
          where: { businessId, status: "active", plan: { code: intent.planCode } },
          include: { plan: true },
          orderBy: { createdAt: "desc" },
        });

    const startMatches =
      !!subscription &&
      Math.abs(new Date(subscription.startDate).getTime() - new Date(intent.effectiveAt).getTime()) <
        START_TOLERANCE_MS;
    const subscriptionOk =
      !!subscription &&
      subscription.plan?.code === intent.planCode &&
      subscription.endDate != null &&
      startMatches;

    const paymentId = intent.paymentId || subscription?.paymentId || null;
    const payment = paymentId
      ? await tx.billingPayment.findFirst({
          where: { id: paymentId, businessId },
          select: { id: true, metadata: true, status: true },
        })
      : null;
    const paymentOk = intent.paymentId ? !!payment && payment.status === "paid" : true;

    const decision = evaluateScheduledPlan({
      settings: biz.settings,
      now,
      planFound: !!plan && plan.status === "active",
      subscriptionFound: subscriptionOk && paymentOk,
    });
    if (decision.outcome === "skip") return "skip";
    if (decision.outcome !== "apply" || !plan || !subscription?.endDate) return "fail";

    const patch = entitlementPatch({
      planCode: plan.code,
      planId: plan.id,
      maxUsers: seatCapFromPayment(payment?.metadata, plan.maxUsers),
      subscriptionEndsAt: subscription.endDate,
    });
    if (Object.prototype.hasOwnProperty.call(patch, "setupFeePaid")) {
      throw new Error("scheduled plan apply must not change setupFeePaid");
    }

    await tx.business.update({
      where: { id: businessId },
      data: {
        plan: patch.plan,
        currentPlanId: patch.planId,
        maxUsers: patch.maxUsers,
        subscriptionEndsAt: patch.subscriptionEndsAt,
        settings: settingsAfterApply(biz.settings, {
          planCode: intent.planCode,
          effectiveAt: intent.effectiveAt,
          appliedAt: now.toISOString(),
        }) as Prisma.InputJsonValue,
      },
    });
    await tx.subscriptionEvent.create({
      data: {
        businessId,
        action: "scheduled_plan_applied",
        fromPlan: biz.plan,
        toPlan: plan.code,
        metadata: {
          effectiveAt: intent.effectiveAt,
          subscriptionId: subscription.id,
          paymentId: payment?.id ?? null,
          setupFeeCharged: false,
        },
      },
    });
    return "apply";
  });
}
