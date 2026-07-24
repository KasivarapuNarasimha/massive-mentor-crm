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
  testWhatsAppConnectionHandler,
} from "../controllers/integration.controller.js";
import { whatsAppWebhookVerify } from "../controllers/whatsapp-webhook.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

// GET verification only (no raw body). POST is mounted in index.ts with express.raw
// so X-Hub-Signature-256 can be verified against the exact request bytes.
router.get("/whatsapp/webhook", whatsAppWebhookVerify);

router.get("/", requireAuth, getIntegrations);
router.post("/configure", requireAuth, configureIntegration);
router.post("/toggle", requireAuth, toggleIntegrationHandler);
router.post("/whatsapp/validate", requireAuth, validateWhatsAppHandler);
router.post("/whatsapp/test-connection", requireAuth, testWhatsAppConnectionHandler);
router.post("/whatsapp/send", requireAuth, sendWhatsApp);
router.get("/whatsapp/history", requireAuth, listWhatsAppHistory);
router.post("/gmail/send", requireAuth, sendGmailHandler);
router.post("/calendar/event", requireAuth, createCalendarEventHandler);

export default router;