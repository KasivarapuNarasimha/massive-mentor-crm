import { Router } from "express";
import {
  getIntegrations,
  configureIntegration,
  toggleIntegrationHandler,
  sendWhatsApp,
  listWhatsAppHistory,
  sendGmailHandler,
  createCalendarEventHandler,
  validateWhatsAppHandler,
} from "@/controllers/integration.controller";
import { requireAuth } from "@/middleware/auth";

const router: Router = Router();

router.get("/", requireAuth, getIntegrations);
router.post("/configure", requireAuth, configureIntegration);
router.post("/toggle", requireAuth, toggleIntegrationHandler);
router.post("/whatsapp/validate", requireAuth, validateWhatsAppHandler);
router.post("/whatsapp/send", requireAuth, sendWhatsApp);
router.get("/whatsapp/history", requireAuth, listWhatsAppHistory);
router.post("/gmail/send", requireAuth, sendGmailHandler);
router.post("/calendar/event", requireAuth, createCalendarEventHandler);

export default router;