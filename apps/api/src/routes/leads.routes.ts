import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  bulkEditLeadsHandler,
  bulkDeleteLeadsHandler,
  bulkAssignLeadsHandler,
  bulkRestoreLeadsHandler,
  sendLeadEmailHandler,
} from "../controllers/crm.controller.js";

/**
 * Enterprise Leads bulk APIs
 * POST /api/leads/bulk-edit
 * POST /api/leads/bulk-delete
 * POST /api/leads/bulk-assign
 * POST /api/leads/bulk-restore
 * POST /api/leads/send-email
 */
const router: Router = Router();

router.post("/bulk-edit", requireAuth, bulkEditLeadsHandler);
router.post("/bulk-delete", requireAuth, bulkDeleteLeadsHandler);
router.post("/bulk-assign", requireAuth, bulkAssignLeadsHandler);
router.post("/bulk-restore", requireAuth, bulkRestoreLeadsHandler);
router.post("/send-email", requireAuth, sendLeadEmailHandler);

export default router;
