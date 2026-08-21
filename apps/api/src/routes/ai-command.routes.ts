import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAiQuota } from "../middleware/aiQuota.js";
import {
  runAiCommandHandler,
  confirmAiCommandHandler,
} from "../controllers/ai-command.controller.js";

const router: Router = Router();

router.post("/run", requireAuth, requireAiQuota("ai_command"), runAiCommandHandler);
router.post("/confirm", requireAuth, requireAiQuota("ai_command"), confirmAiCommandHandler);

export default router;
