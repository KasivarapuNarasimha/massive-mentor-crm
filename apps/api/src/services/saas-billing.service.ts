/**
 * SaaS billing: trial provisioning, Razorpay orders, payment verify, activation.
 * Extends platform PlatformInvoice + SubscriptionEvent for ops history.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { recordAudit } from "@/services/audit.service";
import {
  sendEmail,
  buildTrialExpiredEmail,
  buildTrialExpiryReminderEmail,
  buildRenewalReminderEmail,
} from "@/services/email.service";
import { notifyUser } from "@/services/notification.service";
import { getUserBusinessId } from "@/services/field-engine.service";
import {
  ensureSubscriptionPlans,
  getPlanByCode,
  getPlanById,
  listActivePlans,
} from "@/services/subscription-plan.service";
import { evaluateBillingAccess } from "@/services/billing-access.service";
import { validateCoupon } from "@/services/billing-coupon.service";
import { notifySuperAdmins } from "@/services/billing-notify.service";

const GST_RATE = 0.18;

export function trialDaysDefault(): number {
  return env.TRIAL_DAYS ?? 3;
}

export function razorpayConfigured(): boolean {
  return !!(env.RAZORPAY_KEY_ID?.trim() && env.RAZORPAY_KEY_SECRET?.trim());
}

export function getRazorpayPublicKey(): string | null {
  return env.RAZORPAY_KEY_ID?.trim() || null;
}

async function nextInvoiceNumber(): Promise<string> {
  const { nextSaaSInvoiceNumber } = await import("@/services/invoice-sequence.service");
  return nextSaaSInvoiceNumber();
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** Provision trial subscription row + business flags (3-day default). */
export async function startTrialForBusiness(opts: {
  businessId: string;
  actorUserId?: string | null;
  trialDays?: number;
}) {
  const days = opts.trialDays ?? trialDaysDefault();
  const start = new Date();
  const end = addDays(start, days);

  await ensureSubscriptionPlans();

  const sub = await prisma.subscription.create({
    data: {
      businessId: opts.businessId,
      status: "trial",
      startDate: start,
      endDate: end,
      trialStartDate: start,
      trialEndDate: end,
      autoRenew: false,
      createdById: opts.actorUserId || null,
      notes: `${days}-day free trial`,
    },
  });

  await prisma.business.update({
    where: { id: opts.businessId },
    data: {
      plan: "trial",
      planStatus: "trial",
      isTrial: true,
      isLocked: false,
      trialDays: days,
      trialStartDate: start,
      trialEndsAt: end,
      licenseStatus: "trial",
      subscriptionEndsAt: null,
    },
  });

  await prisma.subscriptionEvent.create({
    data: {
      businessId: opts.businessId,
      actorUserId: opts.actorUserId || null,
      action: "trial_start",
      toPlan: "trial",
      metadata: { trialDays: days, trialEndDate: end.toISOString() },
    },
  });

  return sub;
}

export async function getBillingOverview(userId: string) {
  const access = await evaluateBillingAccess(userId);
  const businessId = access.businessId || (await getUserBusinessId(userId));
  if (!businessId) throw new Error("Business context required");

  const [biz, plans, payments, subscriptions] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      include: { currentPlan: true },
    }),
    listActivePlans(),
    prisma.billingPayment.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { plan: true },
    }),
    prisma.subscription.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { plan: true },
    }),
  ]);

  if (!biz) throw new Error("Business not found");

  const renewalDate = biz.subscriptionEndsAt;
  const renewalDaysRemaining = renewalDate
    ? Math.max(0, Math.ceil((new Date(renewalDate).getTime() - Date.now()) / 86400000))
    : null;

  const timeline = [
    ...subscriptions.map((s) => ({
      at: s.createdAt,
      type: "subscription",
      label: `${s.status} · ${s.plan?.name || "Plan"}`,
      status: s.status,
    })),
    ...payments.map((p) => ({
      at: p.paidAt || p.createdAt,
      type: "payment",
      label: `${p.status} · ₹${p.amount} · ${p.invoiceNumber || p.id.slice(0, 8)}`,
      status: p.status,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 30);

  const usage = {
    maxUsers: biz.maxUsers,
    members: await prisma.businessMember.count({ where: { businessId } }),
    contacts: await prisma.contact.count({
      where: { businessId, deletedAt: null },
    }),
    deals: await prisma.deal.count({ where: { businessId } }),
  };

  return {
    access,
    business: {
      id: biz.id,
      name: biz.name,
      plan: biz.plan,
      planStatus: biz.planStatus,
      isTrial: biz.isTrial,
      isLocked: biz.isLocked,
      trialStartDate: biz.trialStartDate,
      trialEndsAt: biz.trialEndsAt,
      trialDays: biz.trialDays,
      subscriptionEndsAt: biz.subscriptionEndsAt,
      renewalDate,
      renewalDaysRemaining,
      gracePeriodDays: biz.gracePeriodDays,
      maxUsers: biz.maxUsers,
      billingEmail: biz.billingEmail,
      currency: "INR",
      currentPlan: biz.currentPlan,
      createdAt: biz.createdAt,
    },
    plans,
    payments,
    subscriptions,
    timeline,
    usage,
    razorpayKeyId: getRazorpayPublicKey(),
    razorpayEnabled: razorpayConfigured(),
  };
}

export type CheckoutPurpose = "checkout" | "upgrade" | "downgrade" | "renewal" | "retry";

/**
 * Create a NEW Razorpay order (never reuse old orders on retry).
 */
export async function createCheckoutOrder(
  userId: string,
  planCode: string,
  opts?: {
    couponCode?: string;
    purpose?: CheckoutPurpose;
    /** For retry: cancel previous created payment */
    previousPaymentId?: string;
  }
) {
  if (!razorpayConfigured()) {
    throw new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Business context required");

  const plan = await getPlanByCode(planCode);
  if (!plan || plan.status !== "active") throw new Error("Invalid plan");

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    include: { currentPlan: true },
  });
  if (!biz) throw new Error("Business not found");

  const purpose: CheckoutPurpose = opts?.purpose || "checkout";

  // Cancel prior unpaid payment if retry
  if (opts?.previousPaymentId) {
    await prisma.billingPayment.updateMany({
      where: {
        id: opts.previousPaymentId,
        businessId,
        status: { in: ["created", "authorized", "failed"] },
      },
      data: { status: "cancelled" },
    });
  }

  let basePrice = Number(plan.price);
  let discountAmount = 0;
  let couponId: string | null = null;
  let couponMeta: Record<string, unknown> = {};

  // Simple proration credit on upgrade (remaining days of current paid period)
  let prorationCredit = 0;
  if (
    purpose === "upgrade" &&
    biz.currentPlan &&
    biz.subscriptionEndsAt &&
    new Date(biz.subscriptionEndsAt).getTime() > Date.now()
  ) {
    const remainingMs = new Date(biz.subscriptionEndsAt).getTime() - Date.now();
    const remainingDays = Math.max(0, remainingMs / 86400000);
    const cycleDays = biz.currentPlan.billingCycle === "annual" ? 365 : 30;
    const currentPrice = Number(biz.currentPlan.price);
    prorationCredit =
      Math.round((currentPrice / cycleDays) * remainingDays * 100) / 100;
    prorationCredit = Math.min(prorationCredit, basePrice * 0.9);
  }

  if (opts?.couponCode) {
    const v = await validateCoupon({
      code: opts.couponCode,
      planCode: plan.code,
      basePrice,
      businessId,
    });
    if (!v.ok) throw new Error(v.error || "Invalid coupon");
    discountAmount = v.discountAmount || 0;
    couponId = v.couponId || null;
    couponMeta = { couponCode: v.code, discountType: v.discountType };
  }

  const afterDiscount = Math.max(0, basePrice - discountAmount - prorationCredit);
  const gst = Math.round(afterDiscount * GST_RATE * 100) / 100;
  const total = Math.round((afterDiscount + gst) * 100) / 100;
  const amountPaise = Math.max(100, Math.round(total * 100)); // Razorpay min ~₹1

  const invoiceNumber = await nextInvoiceNumber();
  const payment = await prisma.billingPayment.create({
    data: {
      businessId,
      userId,
      planId: plan.id,
      couponId,
      billingCycle: plan.billingCycle,
      amount: total,
      gst,
      discountAmount: discountAmount + prorationCredit,
      currency: plan.currency || "INR",
      invoiceNumber,
      status: "created",
      purpose,
      metadata: {
        planCode: plan.code,
        basePrice: Number(plan.price),
        prorationCredit,
        ...couponMeta,
      },
    },
  });

  // Coupon redemption is deferred until webhook activation (prevents burning codes on abandon)

  const auth = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
  ).toString("base64");

  const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: plan.currency || "INR",
      receipt: payment.id.slice(0, 40),
      notes: {
        businessId,
        planCode: plan.code,
        paymentId: payment.id,
        invoiceNumber,
        purpose,
      },
    }),
  });

  const orderJson = (await orderRes.json()) as {
    id?: string;
    error?: { description?: string };
  };

  if (!orderRes.ok || !orderJson.id) {
    await prisma.billingPayment.update({
      where: { id: payment.id },
      data: { status: "failed", metadata: { error: orderJson } },
    });
    throw new Error(orderJson.error?.description || "Failed to create Razorpay order");
  }

  await prisma.billingPayment.update({
    where: { id: payment.id },
    data: { razorpayOrderId: orderJson.id },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  return {
    keyId: env.RAZORPAY_KEY_ID,
    orderId: orderJson.id,
    amount: amountPaise,
    currency: plan.currency || "INR",
    paymentId: payment.id,
    invoiceNumber,
    purpose,
    plan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      price: plan.price,
      gst,
      total,
      discountAmount: discountAmount + prorationCredit,
      billingCycle: plan.billingCycle,
    },
    prefill: {
      name: user?.name || biz.name || "",
      email: user?.email || biz.billingEmail || "",
    },
    businessName: biz.name || "Massive Mentor CRM",
  };
}

function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const secret = env.RAZORPAY_KEY_SECRET || "";
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Frontend checkout callback — verifies client signature only.
 * Does NOT activate subscription (webhook is source of truth).
 * Returns status; client should poll until paid/activated.
 */
export async function acknowledgeCheckoutPayment(
  userId: string,
  input: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    paymentId?: string;
  }
) {
  const ok = verifyRazorpaySignature(
    input.razorpay_order_id,
    input.razorpay_payment_id,
    input.razorpay_signature
  );
  if (!ok) throw new Error("Invalid payment signature");

  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Business context required");

  const payment = await prisma.billingPayment.findFirst({
    where: {
      businessId,
      OR: [
        { id: input.paymentId || "__none__" },
        { razorpayOrderId: input.razorpay_order_id },
      ],
    },
  });
  if (!payment) throw new Error("Payment record not found");

  if (payment.status === "paid" && payment.activatedAt) {
    return {
      status: "paid" as const,
      activated: true,
      payment,
      access: await evaluateBillingAccess(userId),
      message: "Subscription already active",
    };
  }

  // Mark authorized — waiting for webhook
  await prisma.billingPayment.update({
    where: { id: payment.id },
    data: {
      status: payment.status === "paid" ? "paid" : "authorized",
      razorpayPaymentId: input.razorpay_payment_id,
      razorpayOrderId: input.razorpay_order_id,
      razorpaySignature: input.razorpay_signature,
      metadata: {
        ...((payment.metadata as object) || {}),
        clientAcknowledgedAt: new Date().toISOString(),
      },
    },
  });

  // Dev fallback: if no webhook secret configured, activate via system (local only)
  const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret && env.NODE_ENV !== "production") {
    const { activateSubscriptionFromPayment } = await import(
      "@/services/billing-activation.service"
    );
    await activateSubscriptionFromPayment({
      paymentId: payment.id,
      razorpayPaymentId: input.razorpay_payment_id,
      razorpayOrderId: input.razorpay_order_id,
      razorpaySignature: input.razorpay_signature,
      activatedBy: "system",
    });
    return {
      status: "paid" as const,
      activated: true,
      payment: await prisma.billingPayment.findUnique({ where: { id: payment.id } }),
      access: await evaluateBillingAccess(userId),
      message: "Activated (dev mode — configure RAZORPAY_WEBHOOK_SECRET for production)",
    };
  }

  return {
    status: "authorized" as const,
    activated: false,
    payment: await prisma.billingPayment.findUnique({ where: { id: payment.id } }),
    access: await evaluateBillingAccess(userId),
    message: "Payment received. Activating via secure webhook…",
  };
}

/** Poll payment activation status after checkout */
export async function getPaymentStatus(userId: string, paymentId: string) {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Business context required");
  const payment = await prisma.billingPayment.findFirst({
    where: { id: paymentId, businessId },
    include: { plan: true, subscription: true },
  });
  if (!payment) throw new Error("Payment not found");
  return {
    id: payment.id,
    status: payment.status,
    activated: !!(payment.activatedAt && payment.status === "paid"),
    activatedAt: payment.activatedAt,
    invoiceNumber: payment.invoiceNumber,
    invoiceUrl: payment.invoiceUrl,
    amount: payment.amount,
    plan: payment.plan,
    access: await evaluateBillingAccess(userId),
  };
}

/** Retry failed/cancelled payment — always creates a brand-new Razorpay order */
export async function retryPayment(userId: string, previousPaymentId: string) {
  const businessId = await getUserBusinessId(userId);
  const prev = await prisma.billingPayment.findFirst({
    where: { id: previousPaymentId, businessId: businessId || undefined },
    include: { plan: true },
  });
  if (!prev?.plan) throw new Error("Previous payment not found");
  if (prev.status === "paid") throw new Error("Payment already completed");
  return createCheckoutOrder(userId, prev.plan.code, {
    purpose: "retry",
    previousPaymentId: prev.id,
  });
}

/** Super Admin: extend or reset trial */
export async function adminExtendTrial(
  actorUserId: string,
  businessId: string,
  days: number
) {
  const biz = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false },
  });
  if (!biz) throw new Error("Business not found");
  const base =
    biz.trialEndsAt && new Date(biz.trialEndsAt).getTime() > Date.now()
      ? new Date(biz.trialEndsAt)
      : new Date();
  const end = addDays(base, Math.max(1, days));
  await prisma.business.update({
    where: { id: businessId },
    data: {
      isTrial: true,
      isLocked: false,
      plan: "trial",
      planStatus: "trial",
      licenseStatus: "trial",
      trialEndsAt: end,
      trialStartDate: biz.trialStartDate || new Date(),
      trialDays: (biz.trialDays || trialDaysDefault()) + days,
    },
  });
  await prisma.subscription.create({
    data: {
      businessId,
      status: "trial",
      startDate: new Date(),
      endDate: end,
      trialStartDate: new Date(),
      trialEndDate: end,
      createdById: actorUserId,
      notes: `Trial extended by ${days} days`,
    },
  });
  await prisma.subscriptionEvent.create({
    data: {
      businessId,
      actorUserId,
      action: "trial_extend",
      toPlan: "trial",
      metadata: { days, trialEndsAt: end.toISOString() },
    },
  });
  return getBillingOverviewForBusiness(businessId);
}

export async function adminResetTrial(actorUserId: string, businessId: string) {
  await startTrialForBusiness({
    businessId,
    actorUserId,
    trialDays: trialDaysDefault(),
  });
  await prisma.subscriptionEvent.create({
    data: {
      businessId,
      actorUserId,
      action: "trial_reset",
      toPlan: "trial",
      metadata: { days: trialDaysDefault() },
    },
  });
  return getBillingOverviewForBusiness(businessId);
}

async function getBillingOverviewForBusiness(businessId: string) {
  const owner = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerUserId: true },
  });
  if (!owner) throw new Error("Business not found");
  return getBillingOverview(owner.ownerUserId);
}

/** Daily job: lock expired trials / subscriptions + renewal reminders (7/3/1) */
export async function runDailyBillingJobs(): Promise<{
  lockedTrials: number;
  lockedSubs: number;
  reminders: number;
  renewalReminders: number;
}> {
  const now = new Date();
  let lockedTrials = 0;
  let lockedSubs = 0;
  let reminders = 0;
  let renewalReminders = 0;

  const expiredTrials = await prisma.business.findMany({
    where: {
      isDemo: false,
      portalKind: "customer",
      isTrial: true,
      isLocked: false,
      trialEndsAt: { lte: now },
      status: { not: "deleted" },
    },
    take: 500,
  });

  for (const b of expiredTrials) {
    await prisma.business.update({
      where: { id: b.id },
      data: {
        isLocked: true,
        planStatus: "expired",
        licenseStatus: "expired",
      },
    });
    await prisma.subscriptionEvent.create({
      data: {
        businessId: b.id,
        action: "trial_expired",
        fromPlan: "trial",
        metadata: { at: now.toISOString() },
      },
    });
    await recordAudit({
      businessId: b.id,
      action: "saas_customer_locked",
      entityType: "business",
      entityId: b.id,
      metadata: { reason: "trial_expired" },
    });
    const owner = await prisma.user.findUnique({ where: { id: b.ownerUserId } });
    if (owner?.email) {
      const mail = buildTrialExpiredEmail({
        name: owner.name,
        companyName: b.name,
      });
      void sendEmail({
        to: owner.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }).catch(() => undefined);
    }
    await notifySuperAdmins({
      title: "Trial expired",
      message: `${b.name} trial ended — CRM locked`,
      entityType: "business",
      entityId: b.id,
    });
    lockedTrials++;
  }

  // Paid subscriptions past end + grace
  const expiredSubs = await prisma.business.findMany({
    where: {
      isDemo: false,
      isTrial: false,
      isLocked: false,
      subscriptionEndsAt: { lte: now },
      planStatus: { in: ["active", "past_due"] },
      status: { not: "deleted" },
    },
    take: 500,
  });
  for (const b of expiredSubs) {
    const grace = b.gracePeriodDays ?? 3;
    const graceEnd = new Date(b.subscriptionEndsAt!).getTime() + grace * 86400000;
    if (Date.now() <= graceEnd) {
      await prisma.business.update({
        where: { id: b.id },
        data: { planStatus: "past_due" },
      });
      continue;
    }
    await prisma.business.update({
      where: { id: b.id },
      data: { isLocked: true, planStatus: "expired", licenseStatus: "expired" },
    });
    await recordAudit({
      businessId: b.id,
      action: "saas_customer_locked",
      entityType: "business",
      entityId: b.id,
      metadata: { reason: "subscription_expired" },
    });
    await notifySuperAdmins({
      title: "Subscription expired",
      message: `${b.name} locked after grace period`,
      entityType: "business",
      entityId: b.id,
    });
    lockedSubs++;
  }

  // Trial reminders
  for (const daysLeft of [2, 1, 0]) {
    const start = addDays(now, daysLeft);
    start.setHours(0, 0, 0, 0);
    const end = addDays(start, 1);
    const targets = await prisma.business.findMany({
      where: {
        isDemo: false,
        isTrial: true,
        isLocked: false,
        trialEndsAt: { gte: start, lt: end },
      },
      take: 200,
    });
    for (const b of targets) {
      const owner = await prisma.user.findUnique({ where: { id: b.ownerUserId } });
      if (!owner?.email) continue;
      const mail = buildTrialExpiryReminderEmail({
        name: owner.name,
        companyName: b.name,
        daysLeft,
        trialEndDate: b.trialEndsAt,
      });
      void sendEmail({
        to: owner.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }).catch(() => undefined);
      await notifySuperAdmins({
        title: "Trial expiring",
        message: `${b.name}: trial reminder (${daysLeft} day(s) left)`,
        entityType: "business",
        entityId: b.id,
      });
      reminders++;
    }
  }

  // Renewal reminders: 7, 3, 1 days before subscriptionEndsAt
  for (const daysLeft of [7, 3, 1]) {
    const start = addDays(now, daysLeft);
    start.setHours(0, 0, 0, 0);
    const end = addDays(start, 1);
    const targets = await prisma.business.findMany({
      where: {
        isDemo: false,
        isTrial: false,
        isLocked: false,
        subscriptionEndsAt: { gte: start, lt: end },
      },
      take: 200,
    });
    for (const b of targets) {
      const owner = await prisma.user.findUnique({ where: { id: b.ownerUserId } });
      if (!owner?.email) continue;
      const mail = buildRenewalReminderEmail({
        name: owner.name,
        companyName: b.name,
        daysLeft,
        endsAt: b.subscriptionEndsAt,
      });
      void sendEmail({
        to: owner.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }).catch(() => undefined);
      await notifySuperAdmins({
        title: "Renewal due",
        message: `${b.name} renewal in ${daysLeft} day(s)`,
        entityType: "business",
        entityId: b.id,
      });
      renewalReminders++;
    }
  }

  return { lockedTrials, lockedSubs, reminders, renewalReminders };
}
