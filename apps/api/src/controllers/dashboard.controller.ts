import { Response } from "express";
import { AuthenticatedRequest } from "@/middleware/auth";
import { evaluateDashboard, listDashboardsForUser } from "@/services/dashboard-engine.service";
import { ensureDefaultBusiness } from "@/services/business.service";
import { ensureBusinessConfig } from "@/services/template.service";
import { prisma } from "@/lib/prisma";

const WORKSPACE_ADMIN = new Set(["business_admin", "admin", "owner", "ceo", "super_admin"]);

async function resolveDashboardRole(userId: string, userRole: string | undefined, queryRole?: string) {
  const actual = userRole || "sales_executive";
  const requested = (queryRole || "").trim();
  if (!requested || requested === actual) return actual;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, platformRole: true },
  });
  const mem = await prisma.businessMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  const can =
    user?.platformRole === "super_admin" ||
    WORKSPACE_ADMIN.has(user?.role || "") ||
    WORKSPACE_ADMIN.has(mem?.role || "") ||
    WORKSPACE_ADMIN.has(actual);
  if (!can) return actual;
  return requested;
}

export async function listDashboards(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const biz = await ensureDefaultBusiness(req.user.id);
    await ensureBusinessConfig(biz.id, req.user.id);
    // Admin may preview another role's dashboards; data always tenant-scoped to their business
    const role = await resolveDashboardRole(
      req.user.id,
      req.user.role,
      req.query.role ? String(req.query.role) : undefined
    );
    const data = await listDashboardsForUser(req.user.id, role);
    res.json({
      success: true,
      data: {
        role,
        businessId: data.businessId,
        dashboards: data.dashboards.map((d) => ({
          key: d.key,
          label: d.label,
          description: d.description,
          roles: d.roles,
          isDefault: d.isDefault,
          widgetCount: d.widgets?.length || 0,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("[dashboard] list error:", error);
    res.status(500).json({ success: false, error: "Failed to list dashboards" });
  }
}

export async function getDashboardData(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const biz = await ensureDefaultBusiness(req.user.id);
    await ensureBusinessConfig(biz.id, req.user.id);

    const key = String(req.params.key || "main");
    const role = await resolveDashboardRole(
      req.user.id,
      req.user.role,
      req.query.role ? String(req.query.role) : undefined
    );
    const preset = req.query.preset ? String(req.query.preset) : undefined;
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    const result = await evaluateDashboard(req.user.id, role, key, {
      preset: (preset as "all" | "7d" | "30d" | "90d" | "ytd" | "custom") || "all",
      from,
      to,
    });

    if (!result.dashboard) {
      return res.status(404).json({ success: false, error: "Dashboard not found for role" });
    }

    res.json({
      success: true,
      data: {
        role,
        dashboard: {
          key: result.dashboard.key,
          label: result.dashboard.label,
          description: result.dashboard.description,
        },
        widgets: result.widgets,
        range: { preset: preset || "all", from, to },
      },
    });
  } catch (error: unknown) {
    console.error("[dashboard] data error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to load dashboard data",
    });
  }
}
