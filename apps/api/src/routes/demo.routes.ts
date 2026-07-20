import { Router } from "express";
import { requireDemoAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/demo.controller.js";

const router: Router = Router();

// Demo-only auth — never production
router.post("/auth/login", ctrl.demoLogin);
router.get("/info", ctrl.demoInfo);

router.get("/auth/me", requireDemoAuth, ctrl.demoMe);
router.post("/reset", requireDemoAuth, ctrl.demoReset);

export default router;
