import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/billing.controller.js";

const router: Router = Router();

router.get("/access", requireAuth, ctrl.getAccess);
/** Live subscription sync (SSE) — Super Admin changes push here */
router.get("/stream", requireAuth, ctrl.subscriptionStream);
router.get("/overview", requireAuth, ctrl.getOverview);
router.get("/plans", requireAuth, ctrl.listPlans);
router.post("/checkout/order", requireAuth, ctrl.createOrder);
router.post("/checkout/verify", requireAuth, ctrl.verifyPayment);
router.get("/payments/:id/status", requireAuth, ctrl.paymentStatus);
router.post("/payments/retry", requireAuth, ctrl.retryPayment);
router.post("/coupons/validate", requireAuth, ctrl.validateCouponHandler);
router.get("/invoices/:id/pdf", requireAuth, ctrl.downloadInvoicePdf);

export default router;
