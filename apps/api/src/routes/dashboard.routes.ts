import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listDashboards, getDashboardData } from "../controllers/dashboard.controller.js";

const router: Router = Router();

router.get("/", requireAuth, listDashboards);
router.get("/:key", requireAuth, getDashboardData);

export default router;
