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
import { requireAuth } from "../middleware/auth.js";

const router: Router = Router();

// WhatsApp webhook GET+POST are mounted in index.ts BEFORE requireBillingAccess
// so they are fully public (no JWT / billing). Do not re-register them here.

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