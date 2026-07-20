import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  listTemplates,
  listTemplateCatalog,
  getTemplate,
  installTemplate,
  getCurrentConfig,
  reseedTemplates,
} from "../controllers/template.controller.js";

const router: Router = Router();

/** Public catalog for business registration industry picker */
router.get("/catalog", listTemplateCatalog);
router.get("/", requireAuth, listTemplates);
router.get("/config/current", requireAuth, getCurrentConfig);
router.post("/install", requireAuth, installTemplate);
router.post("/seed", requireAuth, reseedTemplates);
router.get("/:idOrSlug", requireAuth, getTemplate);

export default router;
