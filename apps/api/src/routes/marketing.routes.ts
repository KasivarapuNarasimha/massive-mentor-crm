import { Router } from "express";
import { generateMarketing } from "@/controllers/marketing.controller";
import { requireAuth } from "@/middleware/auth";

const router: Router = Router();

// Single endpoint for generating all Marketing AI content
router.post("/generate", requireAuth, generateMarketing);

export default router;
