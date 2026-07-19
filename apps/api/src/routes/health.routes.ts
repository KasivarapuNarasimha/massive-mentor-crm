import { Router } from "express";
import { getHealthScore, recalculateHealthScore } from "@/controllers/health.controller";
import { requireAuth } from "@/middleware/auth";

const router: Router = Router();

router.get("/", requireAuth, getHealthScore);
router.post("/recalculate", requireAuth, recalculateHealthScore);

export default router;
