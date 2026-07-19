import { Router } from "express";
import { getBusinessProfile, updateBusinessProfile } from "@/controllers/profile.controller";
import { requireAuth } from "@/middleware/auth";

const router: Router = Router();

router.get("/", requireAuth, getBusinessProfile);
router.put("/", requireAuth, updateBusinessProfile);

export default router;
