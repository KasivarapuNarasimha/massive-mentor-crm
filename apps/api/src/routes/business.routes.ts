import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { getCurrentBusiness } from "@/controllers/business.controller";

const router: Router = Router();

/** Active business + tenant context (ensures default business on first access) */
router.get("/current", requireAuth, getCurrentBusiness);

export default router;
