import { Router } from "express";
import { chatWithMentor, getMentorHistory } from "@/controllers/mentor.controller";
import { requireAuth } from "@/middleware/auth";
import { mentorChatLimiter } from "@/middleware/rateLimiter";
import { requireAiQuota } from "@/middleware/aiQuota";

const router: Router = Router();

// Rate limit + per-business quota for costly AI Mentor calls
router.post("/chat", requireAuth, mentorChatLimiter, requireAiQuota("mentor"), chatWithMentor);
router.get("/history", requireAuth, getMentorHistory);

export default router;
