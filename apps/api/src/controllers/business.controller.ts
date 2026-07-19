import { Response } from "express";
import { AuthenticatedRequest } from "@/middleware/auth";
import {
  ensureDefaultBusiness,
  getCurrentBusinessForUser,
  resolveTenantContext,
} from "@/services/business.service";

export async function getCurrentBusiness(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    // Ensure tenant exists (idempotent) then return
    const business = await ensureDefaultBusiness(req.user.id);
    const tenant = await resolveTenantContext(req.user.id);

    res.json({
      success: true,
      data: {
        business,
        tenant: {
          businessId: tenant.businessId,
          businessRole: tenant.businessRole,
          permissions: tenant.permissions,
          platformRole: tenant.platformRole,
          businessName: tenant.businessName,
        },
      },
    });
  } catch (error: unknown) {
    console.error("[business] getCurrentBusiness error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to load business",
    });
  }
}

export async function getCurrentBusinessOptional(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const business = await getCurrentBusinessForUser(req.user.id);
    res.json({ success: true, data: { business } });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to load business" });
  }
}
