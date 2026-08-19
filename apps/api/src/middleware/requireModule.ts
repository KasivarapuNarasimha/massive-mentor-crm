/**
 * Enforce CRM module permissions on API routes.
 * Super Admin platform routes are not mounted under these CRM prefixes.
 */
import { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import {
  getMemberModuleKeys,
  moduleKeyForApiPath,
} from "../services/permissions.service.js";

/** Explicit module key(s) required — any match allows. */
export function requireModule(...moduleKeys: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      if (req.user.platformRole === "super_admin") {
        return next();
      }
      const keys = await getMemberModuleKeys(req.user.id);
      const ok = moduleKeys.some((k) => keys.includes(k));
      if (!ok) {
        return res.status(403).json({
          success: false,
          error: "You do not have permission to access this resource.",
          code: "MODULE_FORBIDDEN",
          required: moduleKeys,
        });
      }
      return next();
    } catch (e) {
      console.error("[requireModule]", e);
      return res.status(500).json({ success: false, error: "Permission check failed" });
    }
  };
}

/**
 * Auto-resolve module from request path (use after requireAuth on CRM routers).
 * Special case: /api/crm/contacts needs leads OR clients.
 */
export async function requireModuleFromPath(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    if (req.user.platformRole === "super_admin") {
      return next();
    }
    const path = req.originalUrl || req.path || "";
    const apiPath = path.startsWith("/api") ? path.split("?")[0] : `/api${path.split("?")[0]}`;
    const mod = moduleKeyForApiPath(apiPath);
    if (!mod) return next();

    const keys = await getMemberModuleKeys(req.user.id);
    if (mod === "__crm_contacts__") {
      if (keys.includes("leads") || keys.includes("clients")) return next();
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["leads", "clients"],
      });
    }
    if (mod === "__ai_any__") {
      if (
        keys.includes("mentor") ||
        keys.includes("ai_sales") ||
        keys.includes("marketing") ||
        keys.includes("swot") ||
        keys.includes("roadmap")
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["mentor", "ai_sales"],
      });
    }
    // Media Library is core CRM sharing: allow with media OR leads OR clients OR documents
    if (mod === "media") {
      if (
        keys.includes("media") ||
        keys.includes("leads") ||
        keys.includes("clients") ||
        keys.includes("documents")
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["media", "leads"],
      });
    }
    // WhatsApp Conversation Center — same sales access as media/leads
    if (mod === "whatsapp") {
      if (
        keys.includes("whatsapp") ||
        keys.includes("media") ||
        keys.includes("leads") ||
        keys.includes("clients")
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["whatsapp", "leads"],
      });
    }
    // ERP Phase 1 shell — finance/approvals roles keep access before erp is granted
    if (mod === "erp") {
      if (
        keys.includes("erp") ||
        keys.includes("finance") ||
        keys.includes("approvals")
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["erp", "finance"],
      });
    }
    // ERP Phase 2 ops modules — allow erp / finance umbrella grants
    if (
      mod === "erp_products" ||
      mod === "erp_inventory" ||
      mod === "erp_vendors" ||
      mod === "erp_purchases" ||
      mod === "erp_sales"
    ) {
      if (
        keys.includes(mod) ||
        keys.includes("erp") ||
        keys.includes("finance")
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: [mod, "erp", "finance"],
      });
    }
    if (!keys.includes(mod)) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: [mod],
      });
    }
    return next();
  } catch (e) {
    console.error("[requireModuleFromPath]", e);
    return res.status(500).json({ success: false, error: "Permission check failed" });
  }
}
