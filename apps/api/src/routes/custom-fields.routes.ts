import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listCustomFields,
  createCustomField,
  updateCustomField,
  deactivateCustomField,
  setCustomFieldOptions,
  updateStandardField,
  listLeadPipelineStatuses,
  addLeadPipelineStatus,
  updateLeadPipelineStatus,
  archiveLeadPipelineStatus,
  reorderLeadPipelineStatuses,
  setLeadPipelineDefaultStatus,
} from "../controllers/custom-fields.controller.js";

const router: Router = Router();

const manage = requireRole([
  "super_admin",
  "business_admin",
  "ceo",
  "owner",
  "admin",
  "manager",
]);

/** Any authenticated member can list defs (needed to render forms) */
router.get("/", requireAuth, listCustomFields);

/** Standard / coreMap field safe updates (label, required, visibility, default, active) */
router.patch("/standard/:key", requireAuth, manage, updateStandardField);

/** Lead pipeline statuses (BusinessConfig.pipelines) — list before /:key */
router.get("/pipelines/lead/statuses", requireAuth, listLeadPipelineStatuses);
router.post("/pipelines/lead/statuses", requireAuth, manage, addLeadPipelineStatus);
router.put("/pipelines/lead/statuses/reorder", requireAuth, manage, reorderLeadPipelineStatuses);
router.patch("/pipelines/lead/statuses/:statusKey", requireAuth, manage, updateLeadPipelineStatus);
router.delete("/pipelines/lead/statuses/:statusKey", requireAuth, manage, archiveLeadPipelineStatus);
router.patch("/pipelines/lead", requireAuth, manage, setLeadPipelineDefaultStatus);

/** Admin-class roles manage definitions */
router.post("/", requireAuth, manage, createCustomField);
router.patch("/:key", requireAuth, manage, updateCustomField);
router.delete("/:key", requireAuth, manage, deactivateCustomField);
router.put("/:key/options", requireAuth, manage, setCustomFieldOptions);

export default router;
