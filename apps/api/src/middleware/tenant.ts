import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.js";
import { resolveTenantContext } from "../services/business.service.js";

/**
 * Ensures default business exists and attaches TenantContext to the request.
 * Use on routes that must be multi-tenant aware.
 * CRM legacy routes may omit this during dual-scope period (still userId-scoped).
 */
export function requireTenant(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  (async () => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      req.tenant = await resolveTenantContext(req.user.id);
      next();
    } catch (error: unknown) {
      console.error("[tenant] requireTenant failed:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to resolve business context",
      });
    }
  })();
}
