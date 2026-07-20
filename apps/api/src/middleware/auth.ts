import { Response, NextFunction } from "express";
import { Request } from "express";
import { verifyToken, getUserById, type PortalAudience } from "../services/auth.service.js";
import type { TenantContext } from "../types/tenant.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
    platformRole?: string;
  };
  /** Populated when requireTenant runs (Phase 1+) */
  tenant?: TenantContext;
  /** JWT portal audience — customer | admin | demo */
  portal?: PortalAudience;
  supportMode?: boolean;
  supportActorId?: string;
  /** Bound UserSession.id from JWT sid claim */
  sessionId?: string;
}

async function loadAndValidateUser(
  userId: string,
  jwtTv: number | undefined,
  sessionId?: string | null
): Promise<
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUserById>>> }
  | { ok: false; status: number; error: string }
> {
  const user = await getUserById(userId);
  if (!user) {
    return { ok: false, status: 401, error: "User no longer exists" };
  }
  if (user.isDisabled) {
    return { ok: false, status: 401, error: "This account has been disabled" };
  }
  // Session revocation: password reset increments tokenVersion
  const currentTv = user.tokenVersion ?? 0;
  const tokenTv = typeof jwtTv === "number" ? jwtTv : 0;
  if (tokenTv !== currentTv) {
    return {
      ok: false,
      status: 401,
      error: "Session expired. Please sign in again (password was changed).",
    };
  }

  // Enterprise session binding (JWT sid). Legacy tokens without sid still accepted once.
  if (sessionId) {
    try {
      const { touchSession } = await import("../services/session.service.js");
      const ok = await touchSession(sessionId);
      if (!ok) {
        return {
          ok: false,
          status: 401,
          error: "This session was ended. Please sign in again.",
        };
      }
    } catch {
      /* non-fatal if session table unavailable during deploy */
    }
  }

  return { ok: true, user };
}

/**
 * Workspace auth for CRM routes (customer + demo portals).
 * Super Admin platform tokens are rejected — they must use /api/platform/*.
 * Support-mode customer tokens (issued after audited impersonation) are allowed.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  (async () => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          error: "Missing or invalid authorization header",
        });
      }

      const token = authHeader.substring(7);
      const decoded = verifyToken(token);

      // Super Admin platform session cannot hit customer CRM APIs
      if (decoded.portal === "admin") {
        return res.status(403).json({
          success: false,
          error:
            "Super Admin sessions cannot access customer CRM APIs. Use /api/platform/* or Support Mode.",
        });
      }

      const loaded = await loadAndValidateUser(decoded.userId, decoded.tv, decoded.sid);
      if (!loaded.ok) {
        return res.status(loaded.status).json({ success: false, error: loaded.error });
      }
      const user = loaded.user;

      req.user = {
        id: user.id,
        email: user.email,
        role: user.role || "sales_executive",
        platformRole: user.platformRole || "user",
      };
      req.portal = decoded.portal;
      req.supportMode = !!decoded.supportMode;
      req.supportActorId = decoded.supportActorId;
      req.sessionId = decoded.sid;

      next();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid or expired token";
      return res.status(401).json({
        success: false,
        error: message,
      });
    }
  })();
}

/** Super Admin portal APIs only */
export function requirePlatformAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  (async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
      }
      const token = authHeader.substring(7);
      const decoded = verifyToken(token, "admin");
      const loaded = await loadAndValidateUser(decoded.userId, decoded.tv, decoded.sid);
      if (!loaded.ok) {
        return res.status(loaded.status).json({ success: false, error: loaded.error });
      }
      const user = loaded.user;
      if (user.platformRole !== "super_admin") {
        return res.status(403).json({ success: false, error: "Super Admin access required" });
      }
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role || "super_admin",
        platformRole: "super_admin",
      };
      req.portal = "admin";
      req.sessionId = decoded.sid;
      next();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid or expired token";
      return res.status(401).json({ success: false, error: message });
    }
  })();
}

/** Demo portal APIs only */
export function requireDemoAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  (async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
      }
      const token = authHeader.substring(7);
      const decoded = verifyToken(token, "demo");
      const loaded = await loadAndValidateUser(decoded.userId, decoded.tv, decoded.sid);
      if (!loaded.ok) {
        return res.status(loaded.status).json({ success: false, error: loaded.error });
      }
      const user = loaded.user;
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role || "business_admin",
        platformRole: user.platformRole || "user",
      };
      req.portal = "demo";
      req.sessionId = decoded.sid;
      next();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid or expired token";
      return res.status(401).json({ success: false, error: message });
    }
  })();
}

export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    (async () => {
      if (!req.user) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      try {
        const { resolveActorRole } = await import("../services/tenant-scope.service.js");
        const role = await resolveActorRole(req.user.id);
        if (
          role === "super_admin" ||
          allowedRoles.includes(role) ||
          allowedRoles.includes(req.user.role || "")
        ) {
          return next();
        }
      } catch {
        const userRole = req.user.role || "sales_executive";
        if (allowedRoles.includes(userRole)) return next();
      }
      return res.status(403).json({ success: false, error: "Insufficient permissions" });
    })();
  };
}
