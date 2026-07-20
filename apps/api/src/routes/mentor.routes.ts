import { Router } from "express";
import { chatWithMentor, getMentorHistory } from "../controllers/mentor.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { mentorChatLimiter } from "../middleware/rateLimiter.js";
import { requireAiQuota } from "../middleware/aiQuota.js";

const router: Router = Router();

// Rate limit + per-business quota for costly AI Mentor calls
router.post("/chat", requireAuth, mentorChatLimiter, requireAiQuota("mentor"), chatWithMentor);
router.get("/history", requireAuth, getMentorHistory);

export default router;
