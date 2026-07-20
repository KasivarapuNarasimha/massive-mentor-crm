import { prisma } from "../lib/prisma.js";
import { ensureDefaultBusiness } from "./business.service.js";
import { ensureBusinessConfig, getBusinessConfig } from "./template.service.js";

export type PortalMenu = {
  key: string;
  label: string;
  route: string;
  order: number;
  enabled: boolean;
  permissions?: string[];
  icon?: string;
};

export type PortalAction = {
  key: string;
  label: string;
  type: string;
  route?: string;
  featureKey?: string;
  permission?: string;
  order?: number;
};

export type PortalDef = {
  key: string;
  label: string;
  description?: string;
  roles: string[];
  homeRoute: string;
  defaultDashboardKey: string;
  menus: PortalMenu[];
  actions?: PortalAction[];
  reportKeys?: string[];
  dashboardKeys?: string[];
};

export type WorkspaceRoleOption = { key: string; label: string };

export type ResolvedPortal = {
  portal: PortalDef;
  role: string;
  /** Authenticated user's real membership role (never changes with preview) */
  actualRole: string;
  platformRole: string;
  permissions: string[];
  businessId: string;
  businessName: string;
  menus: PortalMenu[];
  actions: PortalAction[];
  homeRoute: string;
  defaultDashboardKey: string;
  /** Business Admin may switch workspace view by role without changing user */
  canSwitchWorkspace: boolean;
  /** True when admin is previewing a role that is not their actual role */
  isWorkspacePreview: boolean;
  workspaceRoles: WorkspaceRoleOption[];
};

const WORKSPACE_ADMIN_ROLES = new Set([
  "business_admin",
  "admin",
  "owner",
  "ceo",
  "super_admin",
]);

/** Canonical workspace roles (plus any from BusinessConfig) */
export const DEFAULT_WORKSPACE_ROLES: WorkspaceRoleOption[] = [
  { key: "ceo", label: "CEO" },
  { key: "business_admin", label: "Business Admin" },
  { key: "sales_manager", label: "Sales Manager" },
  { key: "sales_executive", label: "Sales Executive" },
  { key: "marketing", label: "Marketing" },
  { key: "support", label: "Support" },
  { key: "hr", label: "HR" },
  { key: "finance", label: "Finance" },
];

function labelForRole(key: string): string {
  const hit = DEFAULT_WORKSPACE_ROLES.find((r) => r.key === key);
  if (hit) return hit.label;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function permissionsForRoleKey(
  rolesConfig: Array<{ key: string; permissions: string[] }> | unknown,
  role: string
): string[] {
  if (!Array.isArray(rolesConfig)) return [];
  const hit = rolesConfig.find((r) => r && r.key === role);
  return hit?.permissions || [];
}

/**
 * Map membership/platform role → portal definition from BusinessConfig.portals.
 * Never hardcodes industry; only matches role keys in config.
 */
export function matchPortal(
  portals: PortalDef[],
  role: string,
  platformRole: string
): PortalDef | null {
  if (!Array.isArray(portals) || portals.length === 0) return null;

  // Platform super admin first
  if (platformRole === "super_admin") {
    const sa = portals.find((p) => p.roles.includes("super_admin") || p.key === "super_admin");
    if (sa) return sa;
  }

  // Exact role match
  const exact = portals.find((p) => p.roles.includes(role) || p.key === role);
  if (exact) return exact;

  // Legacy aliases
  const aliases: Record<string, string[]> = {
    admin: ["business_admin", "admin", "owner"],
    owner: ["business_admin", "owner", "ceo"],
    manager: ["sales_manager", "manager"],
    support: ["support_executive", "support"],
  };
  for (const p of portals) {
    for (const pr of p.roles) {
      if (aliases[role]?.includes(pr) || aliases[pr]?.includes(role)) return p;
    }
  }

  // Fallback: sales_executive or first portal
  return (
    portals.find((p) => p.key === "sales_executive" || p.roles.includes("sales_executive")) ||
    portals[0] ||
    null
  );
}

function filterMenusByPermission(menus: PortalMenu[], permissions: string[]): PortalMenu[] {
  return (menus || [])
    .filter((m) => m.enabled !== false)
    .filter((m) => {
      if (!m.permissions || m.permissions.length === 0) return true;
      return m.permissions.some((p) => permissions.includes(p));
    })
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function filterActions(actions: PortalAction[] | undefined, permissions: string[]): PortalAction[] {
  return (actions || [])
    .filter((a) => !a.permission || permissions.includes(a.permission))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Resolve the portal for the authenticated user from DB config + role.
 * Business Admin may pass previewRole to view another role's workspace
 * (same user/session/business — NOT a user switch).
 */
export async function resolveUserPortal(
  userId: string,
  opts?: { previewRole?: string | null }
): Promise<ResolvedPortal> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, platformRole: true },
  });
  if (!user) throw new Error("User not found");

  const business = await ensureDefaultBusiness(userId);
  await ensureBusinessConfig(business.id, userId);
  const config = await getBusinessConfig(business.id);

  const membership = await prisma.businessMember.findFirst({
    where: { userId, businessId: business.id },
  });
  const actualRole = membership?.role || user.role || "sales_executive";
  const platformRole = user.platformRole || "user";
  const canSwitchWorkspace =
    platformRole === "super_admin" ||
    WORKSPACE_ADMIN_ROLES.has(actualRole) ||
    WORKSPACE_ADMIN_ROLES.has(user.role || "");

  // Build role options: defaults + config roles + portal roles
  const roleMap = new Map<string, string>();
  for (const r of DEFAULT_WORKSPACE_ROLES) roleMap.set(r.key, r.label);
  if (Array.isArray(config?.roles)) {
    for (const r of config.roles as Array<{ key: string; label?: string }>) {
      if (r?.key && r.key !== "super_admin") {
        roleMap.set(r.key, r.label || labelForRole(r.key));
      }
    }
  }
  const portals = (config?.portals as PortalDef[]) || [];
  for (const p of portals) {
    for (const rk of p.roles || []) {
      if (rk && rk !== "super_admin") roleMap.set(rk, labelForRole(rk));
    }
  }
  const workspaceRoles: WorkspaceRoleOption[] = Array.from(roleMap.entries()).map(
    ([key, label]) => ({ key, label })
  );

  let role = actualRole;
  let isWorkspacePreview = false;
  const requested = (opts?.previewRole || "").trim();
  if (requested && requested !== actualRole) {
    if (!canSwitchWorkspace) {
      throw new Error("Only Business Admin can switch workspace role view");
    }
    role = requested;
    isWorkspacePreview = true;
  }

  let portal = matchPortal(portals, role, isWorkspacePreview ? "user" : platformRole);

  // Minimal fallback portal if config empty (backward compatible shell)
  if (!portal) {
    portal = {
      key: "default",
      label: "Business Portal",
      roles: [role],
      homeRoute: "/dashboard",
      defaultDashboardKey: "main",
      menus: [
        { key: "overview", label: "Overview", route: "/dashboard", order: 1, enabled: true },
        { key: "leads", label: "Leads", route: "/dashboard/leads", order: 2, enabled: true },
        { key: "reports", label: "Reports", route: "/dashboard/reports", order: 3, enabled: true },
      ],
      actions: [],
      dashboardKeys: ["main"],
    };
  }

  const permissions =
    permissionsForRoleKey(config?.roles, role).length > 0
      ? permissionsForRoleKey(config?.roles, role)
      : business.role === "owner"
        ? [
            "contacts.read",
            "contacts.write",
            "deals.read",
            "deals.write",
            "tasks.read",
            "tasks.write",
            "reports.read",
            "reports.export",
            "reports.import",
            "ai.use",
            "config.edit",
            "members.manage",
            "audit.read",
          ]
        : ["contacts.read", "contacts.write", "deals.read", "tasks.read", "reports.read", "ai.use"];

  // Super admin: full permissions for portal menus
  if (platformRole === "super_admin") {
    permissions.push("config.edit", "members.manage", "audit.read", "reports.export");
  }

  // Unique routes only (avoids React duplicate keys when same path had multiple labels)
  const rawMenus = filterMenusByPermission(portal.menus || [], permissions);
  const seenRoutes = new Set<string>();
  const menus = rawMenus.filter((m) => {
    if (!m.route || seenRoutes.has(m.route)) return false;
    seenRoutes.add(m.route);
    return true;
  });
  const rawActions = filterActions(portal.actions, permissions);
  const seenActionRoutes = new Set<string>();
  const actions = rawActions.filter((a) => {
    const route = a.route || a.key;
    if (seenActionRoutes.has(route)) return false;
    seenActionRoutes.add(route);
    return true;
  });

  return {
    portal,
    role,
    actualRole,
    platformRole,
    permissions: Array.from(new Set(permissions)),
    businessId: business.id,
    businessName: business.name,
    menus,
    actions,
    homeRoute: portal.homeRoute || "/dashboard",
    defaultDashboardKey: portal.defaultDashboardKey || "main",
    canSwitchWorkspace,
    isWorkspacePreview,
    workspaceRoles,
  };
}

/**
 * List all portals defined for the business (admin customization later).
 */
export async function listBusinessPortals(userId: string) {
  const business = await ensureDefaultBusiness(userId);
  await ensureBusinessConfig(business.id, userId);
  const config = await getBusinessConfig(business.id);
  return {
    businessId: business.id,
    portals: (config?.portals as PortalDef[]) || [],
    roles: config?.roles || [],
  };
}
