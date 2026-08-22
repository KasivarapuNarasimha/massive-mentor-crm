import { Router } from "express";
import { requireDemoAuth } from "../middleware/auth.js";
import { demoAuthLimiter } from "../middleware/rateLimiter.js";
import * as ctrl from "../controllers/demo.controller.js";

const router: Router = Router();

// Demo-only auth — never production customer login
router.post("/auth/login", demoAuthLimiter, ctrl.demoLogin);
router.post("/auth/enter", demoAuthLimiter, ctrl.demoEnter);
router.get("/info", ctrl.demoInfo);

router.get("/auth/me", requireDemoAuth, ctrl.demoMe);
router.post("/reset", requireDemoAuth, ctrl.demoReset);

export default router;
