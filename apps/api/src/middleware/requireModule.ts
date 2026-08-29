/**
 * Enforce CRM module permissions on API routes.
 * Super Admin platform routes are not mounted under these CRM prefixes.
 */
import { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import {
  getMemberModuleKeys,
  isBusinessModulePolicyCustomized,
  moduleKeyForApiPath,
} from "../services/permissions.service.js";
import { getUserBusinessId } from "../services/field-engine.service.js";

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

    const bid = await getUserBusinessId(req.user.id);
    const keys = await getMemberModuleKeys(req.user.id, bid);
    const policyCustomized = bid ? await isBusinessModulePolicyCustomized(bid) : false;

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
    // Media: explicit grant, or soft CRM sharing when business policy is not customized
    if (mod === "media") {
      if (keys.includes("media")) return next();
      if (
        !policyCustomized &&
        (keys.includes("leads") || keys.includes("clients") || keys.includes("documents"))
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["media"],
      });
    }
    // WhatsApp: effective keys already include auto-grants when allowed; do not bypass business OFF
    if (mod === "whatsapp") {
      if (keys.includes("whatsapp")) return next();
      if (
        !policyCustomized &&
        (keys.includes("media") || keys.includes("leads") || keys.includes("clients"))
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["whatsapp"],
      });
    }
    // ERP shell — finance umbrella only for legacy tenants without business module policy
    if (mod === "erp") {
      if (keys.includes("erp")) return next();
      if (
        !policyCustomized &&
        (keys.includes("finance") || keys.includes("approvals"))
      ) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: ["erp"],
      });
    }
    // ERP submodules — parent erp umbrella; finance only when no business policy
    if (
      mod === "erp_products" ||
      mod === "erp_inventory" ||
      mod === "erp_vendors" ||
      mod === "erp_purchases" ||
      mod === "erp_sales"
    ) {
      if (keys.includes(mod) || keys.includes("erp")) return next();
      if (!policyCustomized && keys.includes("finance")) return next();
      return res.status(403).json({
        success: false,
        error: "You do not have permission to access this resource.",
        code: "MODULE_FORBIDDEN",
        required: [mod, "erp"],
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
