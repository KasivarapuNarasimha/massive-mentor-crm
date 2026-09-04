import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  checkAndSendReminders,
  logCrmActivity,
} from "../services/automation.service.js";
import { createNotification, getNotifications, markAsRead, markAllAsRead } from "../services/notification.service.js";
import { logActivity, getActivityTimeline } from "../services/activity.service.js";

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
    const { processDueReminders } = await import("../services/notification.service.js");
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

/** GET /api/automations/team-activity/stream — SSE for Admin team activity toasts */
export async function teamActivityStream(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const { resolveActorRole } = await import("../services/tenant-scope.service.js");
    const {
      canViewTeamActivity,
      subscribeTeamActivity,
      listTeamActivityListenBusinessIds,
    } = await import("../services/team-activity-realtime.service.js");
    const role = await resolveActorRole(req.user.id);
    if (!canViewTeamActivity(role)) {
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    }

    // Listen on EVERY admin membership workspace (not only getUserBusinessId).
    // Multi-business admins otherwise miss toasts while still receiving bell notifications.
    const businessIds = await listTeamActivityListenBusinessIds(req.user.id);
    if (!businessIds.length) {
      return res.status(400).json({ success: false, error: "No business context" });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // Push through Node / proxy buffers when flush is available (e.g. compression)
      const flush = (res as { flush?: () => void }).flush;
      if (typeof flush === "function") {
        try {
          flush.call(res);
        } catch {
          /* ignore */
        }
      }
    };

    writeEvent("connected", {
      businessId: businessIds[0],
      businessIds,
      at: new Date().toISOString(),
    });

    const viewerId = req.user.id;
    const unsubs = businessIds.map((businessId) =>
      subscribeTeamActivity(businessId, (payload) => {
        // Never toast the actor about their own action
        if (payload.actorUserId === viewerId) return;
        writeEvent("team_activity", payload);
      })
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
        const flush = (res as { flush?: () => void }).flush;
        if (typeof flush === "function") flush.call(res);
      } catch {
        /* closed */
      }
    }, 20_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      for (const unsub of unsubs) unsub();
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
  } catch (error: unknown) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Stream failed",
      });
    }
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
    const { searchAuditLog } = await import("../services/activity.service.js");
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