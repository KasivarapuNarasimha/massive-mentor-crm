import { Router } from "express";
import {
  listContacts,
  getContact,
  createContactHandler,
  updateContactHandler,
  deleteContactHandler,
  listDeals,
  createDealHandler,
  updateDealHandler,
  deleteDealHandler,
  listTasks,
  createTaskHandler,
  updateTaskHandler,
  deleteTaskHandler,
  listMeetings,
  createMeetingHandler,
  updateMeetingHandler,
  deleteMeetingHandler,
  listNotes,
  createNoteHandler,
  updateNoteHandler,
  deleteNoteHandler,
  listDocuments,
  createDocumentHandler,
  updateDocumentHandler,
  deleteDocumentHandler,
  aiLeadScore,
  aiFollowUpSuggestions,
  aiWhatsApp,
  aiEmail,
  aiProposal,
  aiSalesForecast,
  aiNextBestAction,
  aiMeetingSummary,
  aiReminders,
  aiWhatsappHistory,
  aiFollowupEngineList,
  aiFollowupEngineSummary,
  aiFollowupEngineContact,
  aiFollowupEngineRefresh,
  aiFollowupEngineAct,
  aiFollowupEngineMap,
  bulkEditLeadsHandler,
  bulkDeleteLeadsHandler,
  bulkAssignLeadsHandler,
  bulkRestoreLeadsHandler,
  sendLeadEmailHandler,
  listAssignableMembersHandler,
  leadAssignmentSummaryHandler,
  memberActivitySummaryHandler,
  adminLeadVisibilitySearchHandler,
  sendTeamDailyReportHandler,
  listLeadAssignmentsHandler,
  getLeadAssignmentHandler,
  moveLeadAssignmentHandler,
} from "../controllers/crm.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireAiQuota } from "../middleware/aiQuota.js";

const router: Router = Router();

// Enterprise lead bulk actions (also mounted at /api/leads/*)
router.post("/leads/bulk-edit", requireAuth, bulkEditLeadsHandler);
router.post("/leads/bulk-delete", requireAuth, bulkDeleteLeadsHandler);
router.post("/leads/bulk-assign", requireAuth, bulkAssignLeadsHandler);
router.get("/leads/assignable-members", requireAuth, listAssignableMembersHandler);
router.get("/leads/assignment-summary", requireAuth, leadAssignmentSummaryHandler);
router.get("/leads/member-activity-summary", requireAuth, memberActivitySummaryHandler);
router.get("/leads/admin-visibility-search", requireAuth, adminLeadVisibilitySearchHandler);
router.post("/leads/team-daily-report/send", requireAuth, sendTeamDailyReportHandler);
router.get("/leads/assignments", requireAuth, listLeadAssignmentsHandler);
router.get("/leads/assignments/:id", requireAuth, getLeadAssignmentHandler);
router.post("/leads/assignments/:id/move", requireAuth, moveLeadAssignmentHandler);
router.post("/leads/bulk-restore", requireAuth, bulkRestoreLeadsHandler);
router.post("/leads/send-email", requireAuth, sendLeadEmailHandler);

// =====================
// Contacts (Leads + Clients)
// =====================
router.get("/contacts", requireAuth, listContacts);
router.post("/contacts", requireAuth, createContactHandler);
router.get("/contacts/:id", requireAuth, getContact);
router.put("/contacts/:id", requireAuth, updateContactHandler);
router.delete(
  "/contacts/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager"]),
  deleteContactHandler
);

// =====================
// Deals (Pipeline)
// =====================
router.get("/deals", requireAuth, listDeals);
router.post("/deals", requireAuth, createDealHandler);
router.put("/deals/:id", requireAuth, updateDealHandler);
router.delete(
  "/deals/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager"]),
  deleteDealHandler
);

// =====================
// Tasks
// =====================
router.get("/tasks", requireAuth, listTasks);
router.post("/tasks", requireAuth, createTaskHandler);
router.put("/tasks/:id", requireAuth, updateTaskHandler);
router.delete(
  "/tasks/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager", "sales_executive"]),
  deleteTaskHandler
);

// =====================
// Meetings
// =====================
router.get("/meetings", requireAuth, listMeetings);
router.post("/meetings", requireAuth, createMeetingHandler);
router.put("/meetings/:id", requireAuth, updateMeetingHandler);
router.delete(
  "/meetings/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager", "sales_executive"]),
  deleteMeetingHandler
);

// =====================
// Notes (polymorphic)
// =====================
router.get("/notes", requireAuth, listNotes);
router.post("/notes", requireAuth, createNoteHandler);
router.put("/notes/:id", requireAuth, updateNoteHandler);
router.delete(
  "/notes/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager", "sales_executive"]),
  deleteNoteHandler
);

// =====================
// Documents
// =====================
router.get("/documents", requireAuth, listDocuments);
router.post("/documents", requireAuth, createDocumentHandler);
router.put("/documents/:id", requireAuth, updateDocumentHandler);
router.delete(
  "/documents/:id",
  requireAuth,
  requireRole(["manager", "admin", "business_admin", "ceo", "owner", "sales_manager", "sales_executive"]),
  deleteDocumentHandler
);

// =====================
// AI CRM & Sales Intelligence (Batch 4)
// =====================
router.post("/ai/lead-score", requireAuth, requireAiQuota("lead_score"), aiLeadScore);
router.post("/ai/follow-up", requireAuth, requireAiQuota("followup"), aiFollowUpSuggestions);
router.post("/ai/whatsapp", requireAuth, requireAiQuota("whatsapp"), aiWhatsApp);
router.get("/ai/whatsapp/history", requireAuth, aiWhatsappHistory);
router.post("/ai/email", requireAuth, requireAiQuota("email"), aiEmail);
router.post("/ai/proposal", requireAuth, requireAiQuota("proposal"), aiProposal);
router.post("/ai/forecast", requireAuth, requireAiQuota("forecast"), aiSalesForecast);
router.post("/ai/next-action", requireAuth, requireAiQuota("next_action"), aiNextBestAction);
router.post("/ai/meeting-summary", requireAuth, requireAiQuota("meeting_summary"), aiMeetingSummary);
router.post("/ai/reminders", requireAuth, requireAiQuota("reminders"), aiReminders);

// AI Follow-up Engine (persistent, data-driven recommendations)
router.get("/ai/followup-engine", requireAuth, aiFollowupEngineList);
router.get("/ai/followup-engine/summary", requireAuth, aiFollowupEngineSummary);
router.get("/ai/followup-engine/contact/:id", requireAuth, aiFollowupEngineContact);
router.post("/ai/followup-engine/refresh", requireAuth, aiFollowupEngineRefresh);
router.post("/ai/followup-engine/map", requireAuth, aiFollowupEngineMap);
router.post("/ai/followup-engine/:id/act", requireAuth, aiFollowupEngineAct);

export default router;