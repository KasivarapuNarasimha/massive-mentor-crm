import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import {
  bulkEditLeadsHandler,
  bulkDeleteLeadsHandler,
  bulkRestoreLeadsHandler,
} from "@/controllers/crm.controller";

/**
 * Enterprise Leads bulk APIs
 * POST /api/leads/bulk-edit
 * POST /api/leads/bulk-delete
 * POST /api/leads/bulk-restore
 */
const router: Router = Router();

router.post("/bulk-edit", requireAuth, bulkEditLeadsHandler);
router.post("/bulk-delete", requireAuth, bulkDeleteLeadsHandler);
router.post("/bulk-restore", requireAuth, bulkRestoreLeadsHandler);

export default router;
