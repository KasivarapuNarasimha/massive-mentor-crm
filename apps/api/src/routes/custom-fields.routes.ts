import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listCustomFields,
  createCustomField,
  updateCustomField,
  deactivateCustomField,
  setCustomFieldOptions,
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

/** Admin-class roles manage definitions */
router.post("/", requireAuth, manage, createCustomField);
router.patch("/:key", requireAuth, manage, updateCustomField);
router.delete("/:key", requireAuth, manage, deactivateCustomField);
router.put("/:key/options", requireAuth, manage, setCustomFieldOptions);

export default router;
