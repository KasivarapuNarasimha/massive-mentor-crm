import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  securityDashboard,
  mySessions,
  terminateSession,
  terminateOtherSessions,
  loginHistory,
  mySecurityProfile,
} from "../controllers/security.controller.js";

const router: Router = Router();

router.use(requireAuth);

router.get("/dashboard", securityDashboard);
router.get("/history", loginHistory);
router.get("/me", mySecurityProfile);
router.get("/sessions/me", mySessions);
router.delete("/sessions/:id", terminateSession);
router.post("/sessions/terminate-others", terminateOtherSessions);

export default router;
