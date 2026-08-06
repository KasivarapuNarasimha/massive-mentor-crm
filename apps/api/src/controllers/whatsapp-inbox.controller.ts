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
      label: req.query.label ? String(req.query.label) : undefined,
      includeSnoozed:
        req.query.includeSnoozed === "1" || req.query.includeSnoozed === "true",
      includeSpam: req.query.includeSpam === "1" || req.query.includeSpam === "true",
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

export async function setLabels(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const labels = Array.isArray(req.body?.labels) ? (req.body.labels as string[]) : [];
    const data = await ent.setConversationLabels(req.user.id, id, labels);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function togglePin(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.togglePin(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function snooze(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    let until = req.body?.until ? String(req.body.until) : "";
    const preset = String(req.body?.preset || "");
    if (!until && preset) {
      const d = new Date();
      if (preset === "1h") d.setHours(d.getHours() + 1);
      else if (preset === "tomorrow") {
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
      } else if (preset === "next_week") {
        d.setDate(d.getDate() + 7);
        d.setHours(9, 0, 0, 0);
      } else d.setHours(d.getHours() + 1);
      until = d.toISOString();
    }
    const data = await ent.snoozeConversation(req.user.id, id, until);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function react(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const messageId = Array.isArray(req.params.messageId)
      ? req.params.messageId[0]
      : req.params.messageId;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.toggleReaction(
      req.user.id,
      messageId,
      String(req.body?.emoji || "")
    );
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function typing(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    if (req.method === "GET") {
      const data = await ent.getTyping(id);
      return res.json({ success: true, data });
    }
    const data = await ent.setTyping(req.user.id, id, req.body?.isTyping !== false);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function merge(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.mergeConversations(
      req.user.id,
      id,
      String(req.body?.secondaryId || "")
    );
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function exportConv(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const format = String(req.query.format || "txt") as "pdf" | "xlsx" | "txt" | "csv";
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const file = await ent.exportConversation(req.user.id, id, format);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`
    );
    res.send(file.body);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function markSpam(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.markSpam(req.user.id, id, {
      block: !!req.body?.block,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function transcribe(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const messageId = Array.isArray(req.params.messageId)
      ? req.params.messageId[0]
      : req.params.messageId;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.transcribeVoiceMessage(req.user.id, messageId);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listRules(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.listAssignRules(req.user.id);
    res.json({ success: true, data: { rules: data } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function saveRule(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.saveAssignRule(req.user.id, {
      id: req.body?.id ? String(req.body.id) : undefined,
      name: String(req.body?.name || ""),
      priority: req.body?.priority != null ? Number(req.body.priority) : undefined,
      isActive: req.body?.isActive,
      conditions: req.body?.conditions || {},
      assignToUserId: req.body?.assignToUserId || null,
      assignToUserIds: Array.isArray(req.body?.assignToUserIds)
        ? req.body.assignToUserIds
        : undefined,
    });
    res.json({ success: true, data: { rule: data } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function deleteRule(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.deleteAssignRule(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function slaGet(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.getSlaPolicy(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function slaUpdate(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.updateSlaPolicy(req.user.id, {
      isActive: req.body?.isActive,
      escalateManagerMinutes: req.body?.escalateManagerMinutes,
      escalateAdminMinutes: req.body?.escalateAdminMinutes,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listBroadcasts(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.listBroadcasts(req.user.id);
    res.json({ success: true, data: { broadcasts: data } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function createBroadcast(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.createBroadcast(req.user.id, {
      name: String(req.body?.name || "Broadcast"),
      body: String(req.body?.body || ""),
      templateName: req.body?.templateName ? String(req.body.templateName) : undefined,
      audienceFilter: req.body?.audienceFilter || { type: "lead" },
      sendNow: req.body?.sendNow !== false,
    });
    res.status(201).json({ success: true, data: { broadcast: data } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function enterpriseAnalytics(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const ent = await import("../services/whatsapp-enterprise.service.js");
    const data = await ent.getEnterpriseAnalytics(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}
