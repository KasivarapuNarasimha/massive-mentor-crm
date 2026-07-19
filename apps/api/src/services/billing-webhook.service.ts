/**
 * Razorpay webhook processing — sole path for production subscription activation.
 * Idempotent via RazorpayWebhookEvent.eventId.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { activateSubscriptionFromPayment } from "@/services/billing-activation.service";
import { recordAudit } from "@/services/audit.service";
import { notifySuperAdmins } from "@/services/billing-notify.service";

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  // Production: require dedicated webhook secret (never fall back to API key secret)
  const dedicated = (env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  const secret =
    dedicated ||
    (env.NODE_ENV !== "production" ? (env.RAZORPAY_KEY_SECRET || "").trim() : "");
  if (!secret || !signature) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function extractEventId(headers: Record<string, string | string[] | undefined>, payload: unknown): string {
  const h =
    headers["x-razorpay-event-id"] ||
    headers["X-Razorpay-Event-Id"] ||
    headers["x-razorpay-event-id".toLowerCase()];
  if (typeof h === "string" && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]) return String(h[0]);
  // Fallback stable hash
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 40);
}

export async function processRazorpayWebhook(opts: {
  rawBody: Buffer | string;
  signature: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{ ok: boolean; duplicate?: boolean; message: string }> {
  if (!verifyWebhookSignature(opts.rawBody, opts.signature)) {
    return { ok: false, message: "Invalid webhook signature" };
  }

  let payload: {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  try {
    const text = typeof opts.rawBody === "string" ? opts.rawBody : opts.rawBody.toString("utf8");
    payload = JSON.parse(text);
  } catch {
    return { ok: false, message: "Invalid JSON body" };
  }

  const eventType = payload.event || "unknown";
  const eventId = extractEventId(opts.headers, payload);

  const existing = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId } });
  if (existing?.processed) {
    return { ok: true, duplicate: true, message: "Already processed" };
  }

  const row =
    existing ||
    (await prisma.razorpayWebhookEvent.create({
      data: {
        eventId,
        eventType,
        payload: payload as object,
        processed: false,
      },
    }));

  try {
    let result = "ignored";

    if (
      eventType === "payment.captured" ||
      eventType === "order.paid"
    ) {
      const paymentEntity =
        payload.payload?.payment?.entity ||
        (payload.payload as { payment?: { entity?: Record<string, unknown> } })?.payment?.entity;
      const orderEntity = payload.payload?.order?.entity;

      const razorpayPaymentId = String(
        paymentEntity?.id || (orderEntity as { id?: string } | undefined)?.id || ""
      );
      const orderId = String(
        paymentEntity?.order_id || orderEntity?.id || ""
      );
      const notes = (paymentEntity?.notes || orderEntity?.notes || {}) as Record<string, string>;
      const ourPaymentId = notes.paymentId || notes.payment_id;

      let payment = null as Awaited<ReturnType<typeof prisma.billingPayment.findFirst>>;
      if (ourPaymentId) {
        payment = await prisma.billingPayment.findUnique({ where: { id: ourPaymentId } });
      }
      if (!payment && orderId) {
        payment = await prisma.billingPayment.findFirst({
          where: { razorpayOrderId: orderId },
        });
      }
      if (!payment && razorpayPaymentId.startsWith("pay_")) {
        payment = await prisma.billingPayment.findFirst({
          where: { razorpayPaymentId },
        });
      }

      if (!payment) {
        result = "payment_not_found";
      } else if (payment.status === "paid" && payment.activatedAt) {
        result = "already_activated";
      } else {
        await activateSubscriptionFromPayment({
          paymentId: payment.id,
          razorpayPaymentId: razorpayPaymentId.startsWith("pay_")
            ? razorpayPaymentId
            : payment.razorpayPaymentId || razorpayPaymentId,
          razorpayOrderId: orderId || payment.razorpayOrderId || undefined,
          activatedBy: "webhook",
          webhookEventId: eventId,
        });
        result = "activated";
      }
    } else if (eventType === "payment.failed") {
      const entity = payload.payload?.payment?.entity;
      const orderId = String(entity?.order_id || "");
      const notes = (entity?.notes || {}) as Record<string, string>;
      const payment =
        (notes.paymentId
          ? await prisma.billingPayment.findUnique({ where: { id: notes.paymentId } })
          : null) ||
        (orderId
          ? await prisma.billingPayment.findFirst({ where: { razorpayOrderId: orderId } })
          : null);
      if (payment && payment.status !== "paid") {
        await prisma.billingPayment.update({
          where: { id: payment.id },
          data: {
            status: "failed",
            metadata: {
              ...((payment.metadata as object) || {}),
              failReason: entity?.error_description || entity?.error_code || "failed",
              webhookEventId: eventId,
            },
          },
        });
        await recordAudit({
          businessId: payment.businessId,
          action: "saas_payment_failed",
          entityType: "BillingPayment",
          entityId: payment.id,
          metadata: { webhookEventId: eventId },
        });
        await notifySuperAdmins({
          title: "Payment failed",
          message: `Billing payment ${payment.invoiceNumber || payment.id} failed`,
          entityType: "BillingPayment",
          entityId: payment.id,
        });
        result = "marked_failed";
      } else {
        result = "fail_no_payment";
      }
    } else if (eventType === "refund.processed") {
      const entity = payload.payload?.refund?.entity || payload.payload?.payment?.entity;
      const payId = String(
        (entity as { payment_id?: string })?.payment_id || entity?.id || ""
      );
      const payment = await prisma.billingPayment.findFirst({
        where: {
          OR: [{ razorpayPaymentId: payId }, { id: payId }],
        },
      });
      if (payment) {
        await prisma.billingPayment.update({
          where: { id: payment.id },
          data: { status: "refunded" },
        });
        await prisma.business.update({
          where: { id: payment.businessId },
          data: {
            isLocked: true,
            planStatus: "suspended",
            licenseStatus: "expired",
          },
        });
        await recordAudit({
          businessId: payment.businessId,
          action: "saas_payment_refunded",
          entityType: "BillingPayment",
          entityId: payment.id,
          metadata: { webhookEventId: eventId },
        });
        await notifySuperAdmins({
          title: "Refund processed",
          message: `Payment ${payment.invoiceNumber} refunded — CRM locked`,
          entityType: "BillingPayment",
          entityId: payment.id,
        });
        result = "refunded_locked";
      } else {
        result = "refund_no_payment";
      }
    }

    await prisma.razorpayWebhookEvent.update({
      where: { id: row.id },
      data: {
        processed: true,
        processedAt: new Date(),
        result,
        eventType,
      },
    });

    return { ok: true, message: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook processing failed";
    await prisma.razorpayWebhookEvent.update({
      where: { id: row.id },
      data: { error: msg, result: "error" },
    });
    return { ok: false, message: msg };
  }
}
