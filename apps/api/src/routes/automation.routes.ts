import { Router } from "express";
import {
  triggerReminders,
  getUserNotifications,
  markNotificationRead,
  markAllRead,
  logActivityHandler,
  listActivities,
  teamActivityStream,
} from "../controllers/automation.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

router.post("/reminders/trigger", requireAuth, triggerReminders);
router.get("/notifications", requireAuth, getUserNotifications);
// Static path must be registered before :id so "read-all" is never captured as an id
router.post("/notifications/read-all", requireAuth, markAllRead);
router.post("/notifications/:id/read", requireAuth, markNotificationRead);
router.post("/log-activity", requireAuth, logActivityHandler);
router.get("/activity", requireAuth, listActivities);
router.get("/team-activity/stream", requireAuth, teamActivityStream);

export default router;