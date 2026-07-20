import { Router } from "express";
import { generateMarketing } from "../controllers/marketing.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

// Single endpoint for generating all Marketing AI content
router.post("/generate", requireAuth, generateMarketing);

export default router;
