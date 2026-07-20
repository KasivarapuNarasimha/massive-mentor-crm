/**
 * Enterprise security dashboard + session administration.
 */
import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { assertCanManageUsers } from "../services/user-admin.service.js";
import {
  getSecurityDashboard,
  listActiveSessionsForUser,
  revokeSession,
  revokeAllUserSessions,
  getSessionById,
} from "../services/session.service.js";
import { prisma } from "../lib/prisma.js";

/** GET /api/security/dashboard — business admins */
export async function securityDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { businessId } = await assertCanManageUsers(req.user.id);
    const data = await getSecurityDashboard({ businessId });
    res.json({
      success: true,
      data: {
        ...data,
        currentSessionId: req.sessionId || null,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to load security dashboard";
    const status = /Only Business Admin/i.test(msg) ? 403 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

/** GET /api/security/sessions/me — own active sessions */
export async function mySessions(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const sessions = await listActiveSessionsForUser(req.user.id);
    res.json({
      success: true,
      data: {
        sessions: sessions.map((s) => ({
          ...s,
          isCurrent: s.id === req.sessionId,
        })),
        currentSessionId: req.sessionId || null,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list sessions",
    });
  }
}

/** DELETE /api/security/sessions/:id — terminate one session */
export async function terminateSession(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const sessionId = String(req.params.id || "");
    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Session id required" });
    }
    const session = await getSessionById(sessionId);
    if (!session || session.revokedAt) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    // Own session or admin of same business
    let allowed = session.userId === req.user.id;
    if (!allowed) {
      try {
        const { businessId } = await assertCanManageUsers(req.user.id);
        const mem = await prisma.businessMember.findUnique({
          where: {
            businessId_userId: { businessId, userId: session.userId },
          },
        });
        allowed = !!mem;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: "Not allowed to terminate this session" });
    }

    await revokeSession(sessionId, "force_logout", req.user.id);
    res.json({ success: true, data: { terminated: sessionId } });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to terminate session",
    });
  }
}

/** POST /api/security/sessions/terminate-others — keep current, kill rest (self or target user for admin) */
export async function terminateOtherSessions(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const targetUserId =
      typeof req.body?.userId === "string" && req.body.userId
        ? req.body.userId
        : req.user.id;

    if (targetUserId !== req.user.id) {
      const { businessId } = await assertCanManageUsers(req.user.id);
      const mem = await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId, userId: targetUserId } },
      });
      if (!mem) {
        return res.status(404).json({ success: false, error: "User not in business" });
      }
      const count = await revokeAllUserSessions(targetUserId, "force_logout");
      return res.json({ success: true, data: { terminated: count } });
    }

    const except = req.sessionId || null;
    const count = await revokeAllUserSessions(req.user.id, "force_logout", except);
    res.json({ success: true, data: { terminated: count } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    const status = /Only Business Admin/i.test(msg) ? 403 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

/** GET /api/security/history */
export async function loginHistory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { businessId } = await assertCanManageUsers(req.user.id);
    const dash = await getSecurityDashboard({
      businessId,
      historyLimit: Math.min(200, Number(req.query.limit) || 100),
    });
    res.json({ success: true, data: { history: dash.loginHistory } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    const status = /Only Business Admin/i.test(msg) ? 403 : 500;
    res.status(status).json({ success: false, error: msg });
  }
}

/** GET /api/security/me — personal security profile */
export async function mySecurityProfile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        lastLoginAt: true,
        lastLoginIp: true,
        passwordChangedAt: true,
        mfaEnabled: true,
        mfaEnrolledAt: true,
        createdAt: true,
      },
    });
    const sessions = await listActiveSessionsForUser(req.user.id);
    const recent = await prisma.loginEvent.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({
      success: true,
      data: {
        profile: user,
        activeSessions: sessions.map((s) => ({
          ...s,
          isCurrent: s.id === req.sessionId,
        })),
        recentEvents: recent,
        mfa: {
          enabled: !!user?.mfaEnabled,
          enrolledAt: user?.mfaEnrolledAt || null,
          /** Architecture placeholder — UI can show "Coming soon" */
          available: false,
        },
      },
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}
