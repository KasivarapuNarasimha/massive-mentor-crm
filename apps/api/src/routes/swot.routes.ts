import { Router } from "express";
import { generateSWOT, getLatestSWOTAnalysis } from "../controllers/swot.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

router.post("/generate", requireAuth, generateSWOT);
router.get("/latest", requireAuth, getLatestSWOTAnalysis);

export default router;
