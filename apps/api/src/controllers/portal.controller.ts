import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { listBusinessPortals, resolveUserPortal } from "../services/portal.service.js";
import { listEnabledAiFeatures } from "../services/ai-pack.service.js";

export async function getCurrentPortal(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const previewRole = req.query.role ? String(req.query.role) : null;
    const resolved = await resolveUserPortal(req.user.id, { previewRole });
    const aiFeatures = await listEnabledAiFeatures(req.user.id);

    res.json({
      success: true,
      data: {
        portalKey: resolved.portal.key,
        portalLabel: resolved.portal.label,
        description: resolved.portal.description,
        role: resolved.role,
        actualRole: resolved.actualRole,
        platformRole: resolved.platformRole,
        permissions: resolved.permissions,
        modules: resolved.modules,
        businessId: resolved.businessId,
        businessName: resolved.businessName,
        homeRoute: resolved.homeRoute,
        defaultDashboardKey: resolved.defaultDashboardKey,
        menus: resolved.menus,
        actions: resolved.actions,
        dashboardKeys: resolved.portal.dashboardKeys || [resolved.defaultDashboardKey],
        reportKeys: resolved.portal.reportKeys || [],
        canSwitchWorkspace: resolved.canSwitchWorkspace,
        isWorkspacePreview: resolved.isWorkspacePreview,
        workspaceRoles: resolved.workspaceRoles,
        aiFeatures: aiFeatures.map((f) => ({
          key: f.key,
          label: f.label,
          output: f.output,
          ui: f.ui,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("[portal] getCurrentPortal error:", error);
    const message = error instanceof Error ? error.message : "Failed to resolve portal";
    const status = message.includes("Only Business Admin") ? 403 : 500;
    res.status(status).json({
      success: false,
      error: message,
    });
  }
}

export async function listPortals(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await listBusinessPortals(req.user.id);
    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: "Failed to list portals" });
  }
}
