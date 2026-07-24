/**
 * Block CRM API access when trial/subscription is expired or business locked.
 * Allows billing, auth, and profile so user can subscribe.
 * Resolves JWT itself (runs before route-level requireAuth).
 */
import { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { verifyToken } from "../services/auth.service.js";
import {
  evaluateBillingAccess,
  enforceLockIfNeeded,
} from "../services/billing-access.service.js";

const ALLOW_PREFIXES = [
  "/api/auth",
  "/api/billing",
  "/api/payments",
  "/api/profile",
  "/api/portal",
  "/api/templates",
  "/health",
  "/ready",
  "/api/platform",
  "/api/demo",
  // Meta WhatsApp Cloud API webhook (public GET challenge + POST events)
  "/api/integrations/whatsapp/webhook",
];

function isAllowedPath(path: string): boolean {
  const p = path.split("?")[0] || path;
  if (p === "/api/integrations/whatsapp/webhook") return true;
  return ALLOW_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix + "/")
  );
}

const CRM_PREFIXES = [
  "/api/crm",
  "/api/leads",
  "/api/dashboards",
  "/api/finance",
  "/api/reports",
  "/api/ai",
  "/api/mentor",
  "/api/swot",
  "/api/roadmap",
  "/api/marketing",
  "/api/location",
  "/api/approvals",
  "/api/teams",
  "/api/business-users",
  "/api/health-score",
  "/api/automations",
  "/api/integrations",
  "/api/backups",
  "/api/businesses",
];

export async function requireBillingAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const path = req.originalUrl || req.path || "";
    if (isAllowedPath(path)) return next();

    const isCrmRoute = CRM_PREFIXES.some(
      (p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?")
    );
    if (!isCrmRoute) return next();

    let userId = req.user?.id;
    if (!userId) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return next(); // let requireAuth 401
      try {
        const decoded = verifyToken(authHeader.substring(7));
        if (decoded.portal === "admin") return next();
        userId = decoded.userId;
      } catch {
        return next();
      }
    }

    if (!userId) return next();

    const access = await evaluateBillingAccess(userId);
    if (access.allowed) return next();

    await enforceLockIfNeeded(access);

    return res.status(402).json({
      success: false,
      error: "Subscription required",
      code: "SUBSCRIPTION_REQUIRED",
      reason: access.reason,
      access,
      redirectTo: "/subscription-required",
    });
  } catch (err) {
    console.error("[requireBillingAccess]", err);
    // Fail closed — never unlock CRM when subscription evaluation errors
    return res.status(503).json({
      success: false,
      error: "Unable to verify subscription. Please try again.",
      code: "BILLING_CHECK_FAILED",
    });
  }
}
