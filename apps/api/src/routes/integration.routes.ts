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
} from "../controllers/integration.controller.js";
import {
  whatsAppWebhookVerify,
  whatsAppWebhookReceive,
} from "../controllers/whatsapp-webhook.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

// —— Public Meta Cloud API webhook (no JWT; Meta cannot send Authorization) ——
router.get("/whatsapp/webhook", whatsAppWebhookVerify);
router.post("/whatsapp/webhook", whatsAppWebhookReceive);

router.get("/", requireAuth, getIntegrations);
router.post("/configure", requireAuth, configureIntegration);
router.post("/toggle", requireAuth, toggleIntegrationHandler);
router.post("/whatsapp/validate", requireAuth, validateWhatsAppHandler);
router.post("/whatsapp/send", requireAuth, sendWhatsApp);
router.get("/whatsapp/history", requireAuth, listWhatsAppHistory);
router.post("/gmail/send", requireAuth, sendGmailHandler);
router.post("/calendar/event", requireAuth, createCalendarEventHandler);

export default router;