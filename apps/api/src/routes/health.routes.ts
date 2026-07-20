import { Router } from "express";
import { getHealthScore, recalculateHealthScore } from "../controllers/health.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

router.get("/", requireAuth, getHealthScore);
router.post("/recalculate", requireAuth, recalculateHealthScore);

export default router;
