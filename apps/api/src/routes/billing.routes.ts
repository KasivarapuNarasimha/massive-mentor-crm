import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import * as ctrl from "@/controllers/billing.controller";

const router = Router();

router.get("/access", requireAuth, ctrl.getAccess);
router.get("/overview", requireAuth, ctrl.getOverview);
router.get("/plans", requireAuth, ctrl.listPlans);
router.post("/checkout/order", requireAuth, ctrl.createOrder);
router.post("/checkout/verify", requireAuth, ctrl.verifyPayment);
router.get("/payments/:id/status", requireAuth, ctrl.paymentStatus);
router.post("/payments/retry", requireAuth, ctrl.retryPayment);
router.post("/coupons/validate", requireAuth, ctrl.validateCouponHandler);
router.get("/invoices/:id/pdf", requireAuth, ctrl.downloadInvoicePdf);

export default router;
