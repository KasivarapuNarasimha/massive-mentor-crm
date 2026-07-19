/**
 * Single path to activate a paid SaaS subscription after trusted payment confirmation.
 * Called from Razorpay webhook (production) — not from untrusted frontend alone.
 */
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/services/audit.service";
import {
  sendEmail,
  buildPaymentSuccessEmail,
  buildSubscriptionActivatedEmail,
  buildInvoiceGeneratedEmail,
} from "@/services/email.service";
import { notifyUser } from "@/services/notification.service";
import { getPlanById } from "@/services/subscription-plan.service";
import { generateBillingInvoicePdf } from "@/services/billing-invoice-pdf.service";
import { notifySuperAdmins } from "@/services/billing-notify.service";
import fs from "node:fs";
import { recordCouponRedemption } from "@/services/billing-coupon.service";

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export async function activateSubscriptionFromPayment(opts: {
  paymentId: string;
  razorpayPaymentId: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  activatedBy: "webhook" | "admin" | "system";
  webhookEventId?: string;
}) {
  const payment = await prisma.billingPayment.findUnique({
    where: { id: opts.paymentId },
    include: { plan: true, business: true },
  });
  if (!payment) throw new Error("Payment not found");

  // Idempotent: already activated
  if (payment.status === "paid" && payment.activatedAt) {
    return {
      alreadyActivated: true,
      payment,
      subscriptionId: payment.subscriptionId,
    };
  }

  // Dedupe by razorpay payment id
  if (opts.razorpayPaymentId) {
    const dup = await prisma.billingPayment.findFirst({
      where: {
        razorpayPaymentId: opts.razorpayPaymentId,
        status: "paid",
        id: { not: payment.id },
      },
    });
    if (dup) {
      return { alreadyActivated: true, payment: dup, subscriptionId: dup.subscriptionId };
    }
  }

  const plan = payment.plan || (payment.planId ? await getPlanById(payment.planId) : null);
  if (!plan) throw new Error("Plan missing on payment");

  const now = new Date();
  const purpose = payment.purpose || "checkout";
  const biz = payment.business;

  // Proration / extension: upgrade extends from max(now, current end)
  let start = now;
  let end =
    plan.billingCycle === "annual" ? addMonths(now, 12) : addMonths(now, 1);

  if (
    (purpose === "upgrade" || purpose === "renewal" || purpose === "downgrade") &&
    biz.subscriptionEndsAt &&
    new Date(biz.subscriptionEndsAt).getTime() > now.getTime()
  ) {
    if (purpose === "renewal") {
      start = new Date(biz.subscriptionEndsAt);
      end =
        plan.billingCycle === "annual"
          ? addMonths(start, 12)
          : addMonths(start, 1);
    } else if (purpose === "upgrade") {
      // Immediate upgrade — remaining time credit applied at order time; full period from now
      end =
        plan.billingCycle === "annual" ? addMonths(now, 12) : addMonths(now, 1);
    } else if (purpose === "downgrade") {
      // Downgrade takes effect at period end
      start = new Date(biz.subscriptionEndsAt);
      end =
        plan.billingCycle === "annual"
          ? addMonths(start, 12)
          : addMonths(start, 1);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const paid = await tx.billingPayment.update({
      where: { id: payment.id },
      data: {
        status: "paid",
        razorpayPaymentId: opts.razorpayPaymentId || payment.razorpayPaymentId,
        razorpayOrderId: opts.razorpayOrderId || payment.razorpayOrderId,
        razorpaySignature: opts.razorpaySignature || payment.razorpaySignature,
        paidAt: payment.paidAt || now,
        activatedAt: now,
        activatedBy: opts.activatedBy,
        metadata: {
          ...((payment.metadata as object) || {}),
          webhookEventId: opts.webhookEventId,
        },
      },
    });

    // Expire prior active subs
    await tx.subscription.updateMany({
      where: {
        businessId: payment.businessId,
        status: { in: ["active", "trial", "past_due"] },
      },
      data: { status: "cancelled" },
    });

    const sub = await tx.subscription.create({
      data: {
        businessId: payment.businessId,
        planId: plan.id,
        status: purpose === "downgrade" ? "active" : "active",
        startDate: start,
        endDate: end,
        renewalDate: end,
        autoRenew: false,
        paymentId: paid.id,
        createdById: payment.userId,
        notes: `Activated via ${opts.activatedBy} (${purpose})`,
      },
    });

    await tx.billingPayment.update({
      where: { id: paid.id },
      data: { subscriptionId: sub.id },
    });

    // Platform invoice mirror (unique number)
    const invNum = paid.invoiceNumber || `MM-INV-${paid.id.slice(-10).toUpperCase()}`;
    const existingInv = await tx.platformInvoice.findUnique({
      where: { number: invNum },
    });
    if (!existingInv) {
      await tx.platformInvoice.create({
        data: {
          businessId: payment.businessId,
          number: invNum,
          kind: purpose === "renewal" ? "renewal" : "subscription",
          amount: paid.amount,
          currency: paid.currency,
          status: "paid",
          plan: plan.code,
          periodStart: start,
          periodEnd: end,
          paidAt: now,
          notes: `Razorpay ${opts.razorpayPaymentId}`,
        },
      });
    }

    const fromPlan = biz.plan;
    await tx.subscriptionEvent.create({
      data: {
        businessId: payment.businessId,
        actorUserId: payment.userId,
        action:
          purpose === "upgrade"
            ? "upgrade"
            : purpose === "downgrade"
              ? "downgrade"
              : purpose === "renewal"
                ? "renew"
                : "activate",
        fromPlan,
        toPlan: plan.code,
        metadata: {
          paymentId: paid.id,
          razorpayPaymentId: opts.razorpayPaymentId,
          activatedBy: opts.activatedBy,
          endDate: end.toISOString(),
        },
      },
    });

    const planKey = plan.code.split("_")[0] || "professional";
    // Downgrade scheduled: keep current plan until start if start > now
    const applyNow = purpose !== "downgrade" || start.getTime() <= now.getTime();
    if (applyNow) {
      await tx.business.update({
        where: { id: payment.businessId },
        data: {
          plan: planKey,
          planStatus: "active",
          isTrial: false,
          isLocked: false,
          licenseStatus: "active",
          subscriptionEndsAt: end,
          currentPlanId: plan.id,
          maxUsers: plan.maxUsers,
          setupFeePaid: true,
        },
      });
    } else {
      await tx.business.update({
        where: { id: payment.businessId },
        data: {
          planStatus: "active",
          isLocked: false,
          // Keep current plan until period end; store next plan in settings
          settings: {
            ...((biz.settings as object) || {}),
            scheduledPlanCode: plan.code,
            scheduledPlanAt: start.toISOString(),
          },
        },
      });
    }

    return { paid, sub };
  });

  // Redeem coupon only after successful payment (not at order create)
  if (payment.couponId) {
    await recordCouponRedemption({
      couponId: payment.couponId,
      businessId: payment.businessId,
      paymentId: payment.id,
      userId: payment.userId,
    }).catch((err) => console.error("[billing] coupon redeem failed", err));
  }

  // PDF + emails outside transaction
  let pdfPath: string | null = null;
  try {
    const pdf = await generateBillingInvoicePdf(result.paid.id);
    pdfPath = pdf.absolutePath;
  } catch (err) {
    console.error("[billing] invoice PDF failed", err);
  }

  await recordAudit({
    businessId: payment.businessId,
    actorUserId: payment.userId || undefined,
    action: "saas_subscription_activated",
    entityType: "Subscription",
    entityId: result.sub.id,
    metadata: {
      paymentId: result.paid.id,
      plan: plan.code,
      activatedBy: opts.activatedBy,
      amount: result.paid.amount,
    },
  });

  const owner = await prisma.user.findUnique({
    where: { id: payment.business.ownerUserId },
  });
  const recipient = owner?.email || payment.business.billingEmail;
  if (recipient) {
    const companyName = payment.business.name || "Your company";
    const paidAmount = Number(result.paid.amount);
    const paymentMail = buildPaymentSuccessEmail({
      name: owner?.name,
      companyName,
      planName: plan.name,
      amount: Number.isFinite(paidAmount) ? paidAmount : String(result.paid.amount),
      invoiceNumber: result.paid.invoiceNumber,
      paymentId: opts.razorpayPaymentId,
      validUntil: end,
    });
    void sendEmail({
      to: recipient,
      subject: paymentMail.subject,
      text: paymentMail.text,
      html: paymentMail.html,
      sensitive: false,
    }).catch(() => undefined);

    const subMail = buildSubscriptionActivatedEmail({
      name: owner?.name,
      companyName,
      planName: plan.name,
      validUntil: end,
    });
    void sendEmail({
      to: recipient,
      subject: subMail.subject,
      text: subMail.text,
      html: subMail.html,
    }).catch(() => undefined);

    if (result.paid.invoiceNumber) {
      const invMail = buildInvoiceGeneratedEmail({
        name: owner?.name,
        companyName,
        invoiceNumber: result.paid.invoiceNumber,
        amount: Number.isFinite(paidAmount) ? paidAmount : String(result.paid.amount),
        planName: plan.name,
        periodLabel: `Valid until ${end.toLocaleDateString("en-IN")}`,
      });
      void sendEmail({
        to: recipient,
        subject: invMail.subject,
        text: invMail.text,
        html: invMail.html,
      }).catch(() => undefined);
    }

    // PDF path logged; raw SMTP may not attach yet
    if (pdfPath && fs.existsSync(pdfPath)) {
      console.log(`[billing] Invoice PDF ready: ${pdfPath}`);
    }
  }

  if (payment.userId) {
    await notifyUser(payment.userId, {
      type: "system",
      title: "Subscription activated",
      message: `${plan.name} active until ${end.toLocaleDateString("en-IN")}`,
      entityType: "Subscription",
      entityId: result.sub.id,
    }).catch(() => undefined);
  }

  await notifySuperAdmins({
    title: "Payment received",
    message: `${payment.business.name} paid ₹${result.paid.amount} for ${plan.name}`,
    entityType: "BillingPayment",
    entityId: result.paid.id,
  });

  await notifySuperAdmins({
    title: "Subscription activated",
    message: `${payment.business.name} → ${plan.code} until ${end.toISOString()}`,
    entityType: "Subscription",
    entityId: result.sub.id,
  });

  return {
    alreadyActivated: false,
    payment: result.paid,
    subscription: result.sub,
  };
}
