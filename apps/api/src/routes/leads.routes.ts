import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  bulkEditLeadsHandler,
  bulkDeleteLeadsHandler,
  bulkAssignLeadsHandler,
  bulkRestoreLeadsHandler,
  sendLeadEmailHandler,
  listAssignableMembersHandler,
  listLeadAssignmentsHandler,
  getLeadAssignmentHandler,
  moveLeadAssignmentHandler,
} from "../controllers/crm.controller.js";

/**
 * Enterprise Leads bulk APIs + assignment history
 */
const router: Router = Router();

router.post("/bulk-edit", requireAuth, bulkEditLeadsHandler);
router.post("/bulk-delete", requireAuth, bulkDeleteLeadsHandler);
router.post("/bulk-assign", requireAuth, bulkAssignLeadsHandler);
router.get("/assignable-members", requireAuth, listAssignableMembersHandler);
router.get("/assignments", requireAuth, listLeadAssignmentsHandler);
router.get("/assignments/:id", requireAuth, getLeadAssignmentHandler);
router.post("/assignments/:id/move", requireAuth, moveLeadAssignmentHandler);
router.post("/bulk-restore", requireAuth, bulkRestoreLeadsHandler);
router.post("/send-email", requireAuth, sendLeadEmailHandler);

export default router;
