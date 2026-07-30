import { Response, Request } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import * as billing from "../services/saas-billing.service.js";
import { evaluateBillingAccess } from "../services/billing-access.service.js";
import { listActivePlans } from "../services/subscription-plan.service.js";
import { processRazorpayWebhook } from "../services/billing-webhook.service.js";
import { validateCoupon } from "../services/billing-coupon.service.js";
import { prisma } from "../lib/prisma.js";
import fs from "node:fs";

export async function getAccess(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const access = await evaluateBillingAccess(req.user.id);
    res.json({ success: true, data: { access } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

/**
 * GET /api/billing/stream — Server-Sent Events for live subscription sync.
 * Super Admin plan changes push here so open CRM tabs refresh in seconds.
 */
export async function subscriptionStream(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { getUserBusinessId } = await import("../services/field-engine.service.js");
    const businessId = await getUserBusinessId(req.user.id);
    if (!businessId) {
      return res.status(400).json({ success: false, error: "No business context" });
    }

    // Disable proxy buffering for nginx (X-Accel-Buffering)
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Connected ack — client may also force-refresh
    writeEvent("connected", {
      businessId,
      at: new Date().toISOString(),
    });

    // Push current snapshot so late-joiners are correct immediately
    try {
      const access = await evaluateBillingAccess(req.user.id);
      writeEvent("subscription", {
        type: "subscription_snapshot",
        businessId,
        at: new Date().toISOString(),
        plan: access.plan,
        planStatus: access.planStatus,
        isTrial: access.isTrial,
        isLocked: access.isLocked,
        subscriptionEndsAt: access.subscriptionEndsAt,
        trialEndsAt: access.trialEndsAt,
        trialDaysRemaining: access.trialDaysRemaining,
        source: "snapshot",
      });
    } catch {
      /* non-fatal */
    }

    const { subscribeSubscriptionChanges } = await import(
      "../services/subscription-realtime.service.js"
    );
    const unsub = subscribeSubscriptionChanges(businessId, (payload) => {
      writeEvent("subscription", payload);
    });

    // Keep-alive (proxies drop idle connections)
    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        /* closed */
      }
    }, 20_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsub();
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  } catch (e) {
    console.error("[billing] subscriptionStream:", e);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Stream failed" });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function getOverview(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await billing.getBillingOverview(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function listPlans(_req: AuthenticatedRequest, res: Response) {
  try {
    const plans = await listActivePlans();
    res.json({
      success: true,
      data: {
        plans,
        razorpayKeyId: billing.getRazorpayPublicKey(),
        razorpayEnabled: billing.razorpayConfigured(),
      },
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function createOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const planCode = String(req.body?.planCode || "");
    if (!planCode) return res.status(400).json({ success: false, error: "planCode is required" });
    const purpose = req.body?.purpose as billing.CheckoutPurpose | undefined;
    const data = await billing.createCheckoutOrder(req.user.id, planCode, {
      couponCode: req.body?.couponCode ? String(req.body.couponCode) : undefined,
      purpose: purpose || "checkout",
      previousPaymentId: req.body?.previousPaymentId
        ? String(req.body.previousPaymentId)
        : undefined,
    });
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

/** Client callback — does not activate; webhook does */
export async function verifyPayment(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await billing.acknowledgeCheckoutPayment(req.user.id, {
      razorpay_order_id: String(req.body?.razorpay_order_id || ""),
      razorpay_payment_id: String(req.body?.razorpay_payment_id || ""),
      razorpay_signature: String(req.body?.razorpay_signature || ""),
      paymentId: req.body?.paymentId ? String(req.body.paymentId) : undefined,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Payment verification failed" });
  }
}

export async function paymentStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await billing.getPaymentStatus(req.user.id, String(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function retryPayment(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await billing.retryPayment(req.user.id, String(req.body?.paymentId || req.params.id));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function validateCouponHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const planCode = String(req.body?.planCode || "");
    const code = String(req.body?.code || "");
    const plans = await listActivePlans();
    const plan = plans.find((p) => p.code === planCode);
    if (!plan) return res.status(400).json({ success: false, error: "Invalid plan" });
    const { toMoneyNumber } = await import("../lib/money.js");
    const data = await validateCoupon({
      code,
      planCode,
      basePrice: toMoneyNumber(plan.price),
    });
    res.json({ success: data.ok, data, error: data.error });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function downloadInvoicePdf(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { getUserBusinessId } = await import("../services/field-engine.service.js");
    const businessId = await getUserBusinessId(req.user.id);
    if (!businessId) {
      return res.status(403).json({ success: false, error: "Business context required" });
    }
    const payment = await prisma.billingPayment.findFirst({
      where: { id: String(req.params.id), businessId },
    });
    if (!payment) {
      return res.status(404).json({ success: false, error: "Invoice not found" });
    }
    if (!payment.invoicePdfPath || !fs.existsSync(payment.invoicePdfPath)) {
      const { generateBillingInvoicePdf } = await import("../services/billing-invoice-pdf.service.js");
      if (payment.status === "paid") {
        const pdf = await generateBillingInvoicePdf(payment.id);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${pdf.invoiceNumber}.pdf"`
        );
        return fs.createReadStream(pdf.absolutePath).pipe(res);
      }
      return res.status(404).json({ success: false, error: "Invoice PDF not found" });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${payment.invoiceNumber || payment.id}.pdf"`
    );
    fs.createReadStream(payment.invoicePdfPath).pipe(res);
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

/** Raw body webhook — mounted with express.raw */
export async function razorpayWebhook(req: Request, res: Response) {
  try {
    const signature = String(req.headers["x-razorpay-signature"] || "");
    const rawBody = (req as Request & { body: Buffer | string }).body;
    const result = await processRazorpayWebhook({
      rawBody: rawBody || "",
      signature,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });
    if (!result.ok && result.message === "Invalid webhook signature") {
      return res.status(400).json({ success: false, error: result.message });
    }
    res.json({ success: result.ok, ...result });
  } catch (e) {
    console.error("[razorpay webhook]", e);
    res.status(500).json({ success: false, error: "Webhook error" });
  }
}
