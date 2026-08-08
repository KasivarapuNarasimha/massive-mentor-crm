import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/finance.controller.js";

const router: Router = Router();

router.get("/dashboard", requireAuth, ctrl.dashboard);
router.get("/invoices", requireAuth, ctrl.listInvoices);
router.post("/invoices", requireAuth, ctrl.createInvoice);
router.put("/invoices/:id", requireAuth, ctrl.updateInvoice);
router.delete("/invoices/:id", requireAuth, ctrl.deleteInvoice);
router.get("/expenses", requireAuth, ctrl.listExpenses);
router.post("/expenses", requireAuth, ctrl.createExpense);
router.put("/expenses/:id", requireAuth, ctrl.updateExpense);
router.delete("/expenses/:id", requireAuth, ctrl.deleteExpense);
router.get("/payments", requireAuth, ctrl.listPayments);
router.post("/payments", requireAuth, ctrl.createPayment);
router.delete("/payments/:id", requireAuth, ctrl.deletePayment);
/** Explicit Client → Finance (Revenue Received) */
router.post("/crm/client-revenue", requireAuth, ctrl.recordClientRevenue);

export default router;
