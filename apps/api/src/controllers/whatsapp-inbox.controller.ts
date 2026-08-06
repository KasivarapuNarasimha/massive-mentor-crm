import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import * as inbox from "../services/whatsapp-inbox.service.js";

function errStatus(message: string): number {
  if (/permission|Only managers|Only Business/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export async function listConversations(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await inbox.listConversations(req.user.id, {
      search: req.query.search ? String(req.query.search) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      assignedTo: req.query.assignedTo ? String(req.query.assignedTo) : undefined,
      unreadOnly: req.query.unreadOnly === "1" || req.query.unreadOnly === "true",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 30,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function getConversation(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.getConversation(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listMessages(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.listMessages(req.user.id, id, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 80,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function sendMessage(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.sendConversationMessage(
      req.user.id,
      id,
      String(req.body?.body || req.body?.text || "")
    );
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function addNote(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.addInternalNote(
      req.user.id,
      id,
      String(req.body?.body || req.body?.note || "")
    );
    res.status(201).json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function assignConversation(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.assignConversation(
      req.user.id,
      id,
      String(req.body?.assignedToUserId || req.body?.userId || "")
    );
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function setStatus(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.setConversationStatus(
      req.user.id,
      id,
      String(req.body?.status || "")
    );
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function followUp(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.createFollowUpReminder(req.user.id, id, {
      dueAt: String(req.body?.dueAt || ""),
      title: req.body?.title ? String(req.body.title) : undefined,
    });
    res.status(201).json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function aiReplies(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.suggestAiReplies(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function summarize(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.summarizeConversation(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function mediaTab(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.getConversationMedia(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function timeline(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await inbox.getConversationTimeline(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function dashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await inbox.getInboxDashboard(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function agents(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await inbox.listAssignableAgents(req.user.id);
    res.json({ success: true, data: { agents: data } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function openForContact(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactId = String(req.body?.contactId || req.params.contactId || "");
    const data = await inbox.openConversationForContact(req.user.id, contactId);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}
