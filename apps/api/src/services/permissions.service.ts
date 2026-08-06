/**
 * Database-driven CRM module permissions.
 * Super Admin assigns modules per BusinessMember; portals/menus/API enforce them.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";

export type MemberPermissionsJson = {
  modules?: string[];
  template?: string;
  customized?: boolean;
};

/** Built-in catalog — seeded to CrmModule; new modules = add here + seed */
export const MODULE_CATALOG: Array<{
  key: string;
  label: string;
  description?: string;
  routePrefix: string;
  apiPrefixes: string[];
  category: string;
  sortOrder: number;
  alwaysOn?: boolean;
}> = [
  { key: "dashboard", label: "Dashboard", routePrefix: "/dashboard", apiPrefixes: ["/api/dashboards"], category: "core", sortOrder: 1 },
  { key: "leads", label: "Leads", routePrefix: "/dashboard/leads", apiPrefixes: ["/api/crm/contacts", "/api/leads"], category: "crm", sortOrder: 2 },
  { key: "clients", label: "Clients", routePrefix: "/dashboard/clients", apiPrefixes: [], category: "crm", sortOrder: 3 },
  { key: "deals", label: "Deals", routePrefix: "/dashboard/deals", apiPrefixes: ["/api/crm/deals"], category: "crm", sortOrder: 4 },
  { key: "tasks", label: "Tasks", routePrefix: "/dashboard/tasks", apiPrefixes: ["/api/crm/tasks"], category: "crm", sortOrder: 5 },
  { key: "meetings", label: "Meetings", routePrefix: "/dashboard/meetings", apiPrefixes: ["/api/crm/meetings"], category: "crm", sortOrder: 6 },
  { key: "notes", label: "Notes", routePrefix: "/dashboard/notes", apiPrefixes: ["/api/crm/notes"], category: "crm", sortOrder: 7 },
  { key: "documents", label: "Documents", routePrefix: "/dashboard/documents", apiPrefixes: ["/api/crm/documents"], category: "crm", sortOrder: 8 },
  {
    key: "media",
    label: "Media Library",
    routePrefix: "/dashboard/media",
    apiPrefixes: ["/api/media"],
    category: "crm",
    sortOrder: 9,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    routePrefix: "/dashboard/whatsapp",
    apiPrefixes: ["/api/whatsapp"],
    category: "crm",
    sortOrder: 10,
  },
  { key: "reports", label: "Reports", routePrefix: "/dashboard/reports", apiPrefixes: ["/api/reports"], category: "insights", sortOrder: 10 },
  { key: "ai_sales", label: "AI Sales", routePrefix: "/dashboard/ai-sales", apiPrefixes: ["/api/crm/ai", "/api/ai"], category: "ai", sortOrder: 11 },
  { key: "mentor", label: "AI Mentor", routePrefix: "/dashboard/mentor", apiPrefixes: ["/api/mentor", "/api/ai"], category: "ai", sortOrder: 12 },
  { key: "marketing", label: "Market AI", routePrefix: "/dashboard/marketing", apiPrefixes: ["/api/marketing"], category: "ai", sortOrder: 13 },
  { key: "swot", label: "SWOT Analysis", routePrefix: "/dashboard/swot", apiPrefixes: ["/api/swot"], category: "strategy", sortOrder: 14 },
  { key: "roadmap", label: "Growth Roadmap", routePrefix: "/dashboard/roadmap", apiPrefixes: ["/api/roadmap"], category: "strategy", sortOrder: 15 },
  { key: "health", label: "Business Health Score", routePrefix: "/dashboard/health", apiPrefixes: ["/api/health-score"], category: "strategy", sortOrder: 16 },
  { key: "finance", label: "Finance", routePrefix: "/dashboard/finance", apiPrefixes: ["/api/finance"], category: "ops", sortOrder: 20 },
  { key: "field_sales", label: "Field Sales", routePrefix: "/dashboard/field-sales", apiPrefixes: ["/api/location"], category: "ops", sortOrder: 21 },
  { key: "integrations", label: "Integrations", routePrefix: "/dashboard/integrations", apiPrefixes: ["/api/integrations"], category: "ops", sortOrder: 22 },
  { key: "approvals", label: "Approvals", routePrefix: "/dashboard/approvals", apiPrefixes: ["/api/approvals"], category: "ops", sortOrder: 23 },
  { key: "activity", label: "Activity", routePrefix: "/dashboard/activity", apiPrefixes: ["/api/automations"], category: "ops", sortOrder: 24 },
  { key: "team", label: "Team Management", routePrefix: "/dashboard/team", apiPrefixes: ["/api/teams", "/api/business-users"], category: "admin", sortOrder: 30 },
  { key: "billing", label: "Billing", routePrefix: "/dashboard/billing", apiPrefixes: ["/api/billing"], category: "admin", sortOrder: 31 },
  { key: "settings", label: "Settings", routePrefix: "/dashboard/security", apiPrefixes: ["/api/security"], category: "admin", sortOrder: 32 },
  { key: "backups", label: "Backups", routePrefix: "/dashboard/backups", apiPrefixes: ["/api/backups"], category: "admin", sortOrder: 33 },
  { key: "profile", label: "Profile", routePrefix: "/dashboard/profile", apiPrefixes: ["/api/profile"], category: "personal", sortOrder: 90, alwaysOn: true },
  { key: "appearance", label: "Appearance", routePrefix: "/dashboard/settings/appearance", apiPrefixes: [], category: "personal", sortOrder: 91, alwaysOn: true },
];

/** Role templates → default modules */
export const ROLE_TEMPLATE_DEFAULTS: Array<{
  roleKey: string;
  label: string;
  modules: string[];
  sortOrder: number;
}> = [
  {
    roleKey: "ceo",
    label: "CEO",
    sortOrder: 1,
    modules: MODULE_CATALOG.filter((m) => !["backups"].includes(m.key) || true).map((m) => m.key),
  },
  {
    roleKey: "business_admin",
    label: "Business Admin",
    sortOrder: 2,
    modules: MODULE_CATALOG.map((m) => m.key),
  },
  {
    roleKey: "sales_manager",
    label: "Sales Manager",
    sortOrder: 3,
    modules: [
      "dashboard", "leads", "clients", "deals", "tasks", "meetings", "notes", "documents", "media", "whatsapp",
      "reports", "ai_sales", "mentor", "field_sales", "activity", "team", "profile", "appearance",
    ],
  },
  {
    roleKey: "sales_executive",
    label: "Sales Executive",
    sortOrder: 4,
    modules: [
      "dashboard", "leads", "clients", "deals", "tasks", "meetings", "notes", "media", "whatsapp",
      "ai_sales", "mentor", "field_sales", "activity", "profile", "appearance",
    ],
  },
  {
    roleKey: "marketing",
    label: "Marketing",
    sortOrder: 5,
    modules: [
      "dashboard", "leads", "clients", "marketing", "reports", "mentor", "activity", "profile", "appearance",
    ],
  },
  {
    roleKey: "finance",
    label: "Finance",
    sortOrder: 6,
    modules: [
      "dashboard", "clients", "deals", "finance", "reports", "approvals", "activity", "profile", "appearance",
    ],
  },
  {
    roleKey: "support",
    label: "Support",
    sortOrder: 7,
    modules: [
      "dashboard", "clients", "tasks", "meetings", "notes", "mentor", "activity", "profile", "appearance",
    ],
  },
];

// CEO gets everything except maybe backups is fine too
ROLE_TEMPLATE_DEFAULTS[0].modules = MODULE_CATALOG.map((m) => m.key);

export async function ensurePermissionCatalogSeeded(): Promise<void> {
  for (const m of MODULE_CATALOG) {
    await prisma.crmModule.upsert({
      where: { key: m.key },
      create: {
        key: m.key,
        label: m.label,
        description: m.description || null,
        routePrefix: m.routePrefix,
        apiPrefixes: m.apiPrefixes,
        category: m.category,
        sortOrder: m.sortOrder,
        alwaysOn: !!m.alwaysOn,
        isActive: true,
      },
      update: {
        label: m.label,
        routePrefix: m.routePrefix,
        apiPrefixes: m.apiPrefixes,
        category: m.category,
        sortOrder: m.sortOrder,
        alwaysOn: !!m.alwaysOn,
        isActive: true,
      },
    });
  }
  for (const t of ROLE_TEMPLATE_DEFAULTS) {
    await prisma.rolePermissionTemplate.upsert({
      where: { roleKey: t.roleKey },
      create: {
        roleKey: t.roleKey,
        label: t.label,
        modules: t.modules,
        sortOrder: t.sortOrder,
        isActive: true,
      },
      update: {
        label: t.label,
        modules: t.modules,
        sortOrder: t.sortOrder,
        isActive: true,
      },
    });
  }
  console.log(
    `[permissions] catalog modules=${MODULE_CATALOG.length} templates=${ROLE_TEMPLATE_DEFAULTS.length}`
  );
}

export async function listPermissionCatalog() {
  const modules = await prisma.crmModule.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const templates = await prisma.rolePermissionTemplate.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return {
    modules: modules.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      routePrefix: m.routePrefix,
      apiPrefixes: (m.apiPrefixes as string[]) || [],
      category: m.category,
      alwaysOn: m.alwaysOn,
      sortOrder: m.sortOrder,
    })),
    templates: templates.map((t) => ({
      roleKey: t.roleKey,
      label: t.label,
      modules: (t.modules as string[]) || [],
      sortOrder: t.sortOrder,
    })),
  };
}

export function parseMemberPermissions(raw: unknown): MemberPermissionsJson {
  if (!raw || typeof raw !== "object") return {};
  return raw as MemberPermissionsJson;
}

export function alwaysOnModules(): string[] {
  return MODULE_CATALOG.filter((m) => m.alwaysOn).map((m) => m.key);
}

/** Resolve modules for a role template key */
export function modulesForTemplate(roleKey: string): string[] {
  const t =
    ROLE_TEMPLATE_DEFAULTS.find((r) => r.roleKey === roleKey) ||
    ROLE_TEMPLATE_DEFAULTS.find((r) => r.roleKey === "sales_executive");
  return Array.from(new Set([...(t?.modules || []), ...alwaysOnModules()]));
}

/**
 * Effective module keys for a user in their business.
 * Priority: member.permissions.modules → template for role → sales_executive defaults.
 */
export async function getMemberModuleKeys(
  userId: string,
  businessId?: string | null
): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformRole: true, role: true },
  });
  if (!user) return alwaysOnModules();
  if (user.platformRole === "super_admin") {
    return MODULE_CATALOG.map((m) => m.key);
  }

  const bid = businessId || (await getUserBusinessId(userId));
  if (!bid) return alwaysOnModules();

  const member = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: bid, userId } },
  });
  const role = member?.role || user.role || "sales_executive";
  const parsed = parseMemberPermissions(member?.permissions);
  let keys: string[];
  if (Array.isArray(parsed.modules) && parsed.modules.length > 0) {
    keys = Array.from(new Set([...parsed.modules, ...alwaysOnModules()]));
  } else if (["owner", "admin", "ceo", "business_admin"].includes(role)) {
    // Legacy: owner/admin/ceo without modules JSON → full template for role
    keys = modulesForTemplate(
      role === "owner" || role === "admin" ? "business_admin" : role
    );
  } else {
    keys = modulesForTemplate(role);
  }

  // Sales CRM users with leads always receive Media Library + WhatsApp Inbox
  if (
    (keys.includes("leads") || keys.includes("clients")) &&
    !keys.includes("media")
  ) {
    keys.push("media");
  }
  if (
    (keys.includes("leads") || keys.includes("clients") || keys.includes("media")) &&
    !keys.includes("whatsapp")
  ) {
    keys.push("whatsapp");
  }

  return keys;
}

export async function memberHasModule(
  userId: string,
  moduleKey: string,
  businessId?: string | null
): Promise<boolean> {
  if (!moduleKey) return true;
  const keys = await getMemberModuleKeys(userId, businessId);
  return keys.includes(moduleKey);
}

/** Longest-prefix match route → module key */
export function moduleKeyForRoute(pathname: string): string | null {
  const path = (pathname || "").split("?")[0] || "";
  if (!path.startsWith("/dashboard")) return null;
  // Always-on personal routes
  if (path.startsWith("/dashboard/settings/appearance")) return "appearance";
  if (path === "/dashboard/profile" || path.startsWith("/dashboard/profile/")) return "profile";
  if (path === "/dashboard" || path === "/dashboard/") return "dashboard";

  let best: { key: string; len: number } | null = null;
  for (const m of MODULE_CATALOG) {
    if (!m.routePrefix || m.routePrefix === "/dashboard") continue;
    if (path === m.routePrefix || path.startsWith(m.routePrefix + "/")) {
      if (!best || m.routePrefix.length > best.len) {
        best = { key: m.key, len: m.routePrefix.length };
      }
    }
  }
  return best?.key || null;
}

/** API path → module key (first matching prefix) */
export function moduleKeyForApiPath(apiPath: string): string | null {
  const p = (apiPath.split("?")[0] || "").replace(/\/$/, "") || apiPath;
  // Billing stream / access always needed for lock screens
  if (p.startsWith("/api/billing")) {
    // Allow access/stream/overview for subscription UX even without billing module?
    // Product: billing module required for /api/billing except access + stream
    if (
      p === "/api/billing/access" ||
      p === "/api/billing/stream" ||
      p.startsWith("/api/billing/stream")
    ) {
      return null; // no module gate
    }
    return "billing";
  }
  let best: { key: string; len: number } | null = null;
  for (const m of MODULE_CATALOG) {
    for (const prefix of m.apiPrefixes) {
      if (p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix + "?")) {
        if (!best || prefix.length > best.len) {
          best = { key: m.key, len: prefix.length };
        }
      }
    }
  }
  // contacts type leads vs clients — same API; gated by leads/clients on frontend, API allows if either
  if (p.startsWith("/api/crm/contacts")) {
    return "__crm_contacts__"; // special: need leads OR clients
  }
  // Generic AI helper — allow if user has any AI module
  if (p.startsWith("/api/ai")) {
    return "__ai_any__";
  }
  return best?.key || null;
}

export async function setMemberModules(input: {
  actorUserId: string;
  businessId: string;
  userId: string;
  role?: string;
  modules: string[];
  template?: string;
  customized?: boolean;
}) {
  const member = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: {
        businessId: input.businessId,
        userId: input.userId,
      },
    },
  });
  if (!member) throw new Error("User is not a member of this business");

  const validKeys = new Set(MODULE_CATALOG.map((m) => m.key));
  const modules = Array.from(
    new Set([
      ...input.modules.filter((k) => validKeys.has(k)),
      ...alwaysOnModules(),
    ])
  );

  const permissions: MemberPermissionsJson = {
    modules,
    template: input.template || input.role || member.role,
    customized: input.customized !== false,
  };

  const data: { permissions: object; role?: string } = {
    permissions: permissions as object,
  };
  if (input.role) {
    data.role = input.role;
    await prisma.user.update({
      where: { id: input.userId },
      data: { role: input.role },
    }).catch(() => undefined);
  }

  const updated = await prisma.businessMember.update({
    where: { id: member.id },
    data,
  });

  const { recordAudit } = await import("./audit.service.js");
  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    action: "platform_set_member_permissions",
    entityType: "user",
    entityId: input.userId,
    metadata: {
      modules,
      template: permissions.template,
      role: input.role || member.role,
    },
  });

  return {
    userId: input.userId,
    role: updated.role,
    modules,
    template: permissions.template,
  };
}

export function filterMenusByModules<
  T extends { route?: string; key?: string; enabled?: boolean }
>(menus: T[], moduleKeys: string[]): T[] {
  const set = new Set(moduleKeys);
  return menus.filter((m) => {
    if (m.enabled === false) return false;
    const route = m.route || "";
    const mod = moduleKeyForRoute(route);
    if (!mod) return true; // unknown routes stay (or deny — allow for safety of profile)
    return set.has(mod);
  });
}
