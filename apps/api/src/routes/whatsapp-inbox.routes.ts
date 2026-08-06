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
  setLabels,
  togglePin,
  snooze,
  react,
  typing,
  merge,
  exportConv,
  markSpam,
  transcribe,
  listRules,
  saveRule,
  deleteRule,
  slaGet,
  slaUpdate,
  listBroadcasts,
  createBroadcast,
  enterpriseAnalytics,
} from "../controllers/whatsapp-inbox.controller.js";

const router: Router = Router();
router.use(requireAuth);

router.get("/dashboard", dashboard);
router.get("/analytics", enterpriseAnalytics);
router.get("/agents", agents);
router.get("/rules", listRules);
router.post("/rules", saveRule);
router.delete("/rules/:id", deleteRule);
router.get("/sla", slaGet);
router.patch("/sla", slaUpdate);
router.get("/broadcasts", listBroadcasts);
router.post("/broadcasts", createBroadcast);

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
router.post("/conversations/:id/labels", setLabels);
router.post("/conversations/:id/pin", togglePin);
router.post("/conversations/:id/snooze", snooze);
router.get("/conversations/:id/typing", typing);
router.post("/conversations/:id/typing", typing);
router.post("/conversations/:id/merge", merge);
router.get("/conversations/:id/export", exportConv);
router.post("/conversations/:id/spam", markSpam);
router.post("/messages/:messageId/react", react);
router.post("/messages/:messageId/transcribe", transcribe);

export default router;
