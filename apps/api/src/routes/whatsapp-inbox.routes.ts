import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  listConversations,
  getConversation,
  listMessages,
  sendMessage,
  addNote,
  assignConversation,
  setStatus,
  followUp,
  aiReplies,
  summarize,
  mediaTab,
  timeline,
  dashboard,
  agents,
  openForContact,
} from "../controllers/whatsapp-inbox.controller.js";

const router: Router = Router();
router.use(requireAuth);

router.get("/dashboard", dashboard);
router.get("/agents", agents);
router.get("/conversations", listConversations);
router.post("/conversations/open", openForContact);
router.get("/conversations/:id", getConversation);
router.get("/conversations/:id/messages", listMessages);
router.post("/conversations/:id/messages", sendMessage);
router.post("/conversations/:id/notes", addNote);
router.post("/conversations/:id/assign", assignConversation);
router.post("/conversations/:id/status", setStatus);
router.post("/conversations/:id/follow-up", followUp);
router.get("/conversations/:id/ai-replies", aiReplies);
router.post("/conversations/:id/summarize", summarize);
router.get("/conversations/:id/media", mediaTab);
router.get("/conversations/:id/timeline", timeline);

export default router;
