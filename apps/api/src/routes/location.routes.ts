import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import {
  postLocationEvent,
  postFieldStart,
  postFieldEnd,
  postMeetingCheckIn,
  postMeetingCheckOut,
  getLiveLocations,
  getHistory,
  getMyStatus,
  getInsights,
  putOffice,
  getReport,
} from "@/controllers/location.controller";

const router: Router = Router();

router.post("/events", requireAuth, postLocationEvent);
router.post("/field/start", requireAuth, postFieldStart);
router.post("/field/end", requireAuth, postFieldEnd);
router.post("/meetings/:meetingId/check-in", requireAuth, postMeetingCheckIn);
router.post("/meetings/:meetingId/check-out", requireAuth, postMeetingCheckOut);
router.get("/live", requireAuth, getLiveLocations);
router.get("/history", requireAuth, getHistory);
router.get("/me", requireAuth, getMyStatus);
router.get("/insights", requireAuth, getInsights);
router.put("/office", requireAuth, putOffice);
router.get("/reports", requireAuth, getReport);

export default router;
