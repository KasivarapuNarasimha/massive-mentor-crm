import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getCurrentPortal, listPortals } from "../controllers/portal.controller.js";

const router: Router = Router();

router.get("/current", requireAuth, getCurrentPortal);
router.get("/", requireAuth, listPortals);

export default router;
