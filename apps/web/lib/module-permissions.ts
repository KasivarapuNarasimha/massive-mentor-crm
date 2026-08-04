/**
 * Client-side module permission helpers (mirrors API catalog keys).
 * Source of truth remains the API / portal.modules list.
 */

export const ROUTE_MODULE: Record<string, string> = {
  "/dashboard": "dashboard",
  "/dashboard/leads": "leads",
  "/dashboard/clients": "clients",
  "/dashboard/deals": "deals",
  "/dashboard/tasks": "tasks",
  "/dashboard/meetings": "meetings",
  "/dashboard/notes": "notes",
  "/dashboard/documents": "documents",
  "/dashboard/reports": "reports",
  "/dashboard/ai-sales": "ai_sales",
  "/dashboard/mentor": "mentor",
  "/dashboard/marketing": "marketing",
  "/dashboard/swot": "swot",
  "/dashboard/roadmap": "roadmap",
  "/dashboard/health": "health",
  "/dashboard/finance": "finance",
  "/dashboard/field-sales": "field_sales",
  "/dashboard/integrations": "integrations",
  "/dashboard/approvals": "approvals",
  "/dashboard/activity": "activity",
  "/dashboard/team": "team",
  "/dashboard/billing": "billing",
  "/dashboard/security": "settings",
  "/dashboard/backups": "backups",
  "/dashboard/profile": "profile",
  "/dashboard/settings/appearance": "appearance",
};

/** Longest-prefix module for a path */
export function moduleKeyForPath(pathname: string): string | null {
  const path = (pathname || "").split("?")[0] || "";
  if (path.startsWith("/dashboard/settings/appearance")) return "appearance";
  if (path === "/dashboard" || path === "/dashboard/") return "dashboard";
  let best: { key: string; len: number } | null = null;
  for (const [route, key] of Object.entries(ROUTE_MODULE)) {
    if (route === "/dashboard") continue;
    if (path === route || path.startsWith(route + "/")) {
      if (!best || route.length > best.len) best = { key, len: route.length };
    }
  }
  return best?.key || null;
}

export function canAccessPath(pathname: string, modules: string[] | null | undefined): boolean {
  if (!modules || modules.length === 0) return true; // until loaded
  const key = moduleKeyForPath(pathname);
  if (!key) return true;
  // personal always if missing from list (safety)
  if (key === "profile" || key === "appearance") return true;
  return modules.includes(key);
}

export function filterNavByModules<T extends { href: string }>(
  items: T[],
  modules: string[] | null | undefined
): T[] {
  if (!modules || modules.length === 0) return items;
  return items.filter((item) => canAccessPath(item.href, modules));
}
