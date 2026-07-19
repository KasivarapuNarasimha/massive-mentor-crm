import { Response } from "express";
import { AuthenticatedRequest } from "@/middleware/auth";
import {
  checkAndSendReminders,
  logCrmActivity,
} from "@/services/automation.service";
import { createNotification, getNotifications, markAsRead, markAllAsRead } from "@/services/notification.service";
import { logActivity, getActivityTimeline } from "@/services/activity.service";

export async function triggerReminders(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const result = await checkAndSendReminders(req.user.id);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to process reminders" });
  }
}

export async function getUserNotifications(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const unreadOnly = req.query.unread === "true";
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 30;
    // Process due reminders on poll (lightweight real-time)
    const { processDueReminders } = await import("@/services/notification.service");
    await processDueReminders(req.user.id).catch(() => {});
    const result = await getNotifications(req.user.id, {
      unreadOnly,
      page,
      pageSize,
    });
    res.json({
      success: true,
      data: {
        notifications: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
        unreadCount: result.unreadCount,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
}

export async function markNotificationRead(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await markAsRead(req.user.id, id);
    res.json({ success: true, data: { message: "Marked as read" } });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

export async function markAllRead(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await markAllAsRead(req.user.id);
    res.json({ success: true, data: { message: "All marked as read" } });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

// For logging from other parts (can be called internally too)
export async function logActivityHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { entityType, entityId, action, details } = req.body;
    await logActivity({ userId: req.user.id, entityType, entityId, action, details });
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to log" });
  }
}

export async function listActivities(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const et = req.query.entityType;
    const ei = req.query.entityId;
    const entityType = (Array.isArray(et) ? et[0] : et) as string | undefined;
    const entityId = (Array.isArray(ei) ? ei[0] : ei) as string | undefined;
    const activities = await getActivityTimeline(req.user.id, entityType, entityId);
    // Full audit log (create/update/delete/login/etc.)
    const { searchAuditLog } = await import("@/services/activity.service");
    const audit = await searchAuditLog(req.user.id, {
      action: req.query.action ? String(req.query.action) : undefined,
      entityType: entityType,
      search: req.query.search ? String(req.query.search) : undefined,
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      pageSize: req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 50,
    });
    res.json({
      success: true,
      data: {
        activities,
        audit: audit.items,
        auditTotal: audit.total,
        auditPage: audit.page,
        auditTotalPages: audit.totalPages,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to fetch activities" });
  }
}