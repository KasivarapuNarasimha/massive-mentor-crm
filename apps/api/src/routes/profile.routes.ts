import { Router } from "express";
import { getBusinessProfile, updateBusinessProfile } from "../controllers/profile.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

router.get("/", requireAuth, getBusinessProfile);
router.put("/", requireAuth, updateBusinessProfile);

export default router;
