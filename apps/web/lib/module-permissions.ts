/**
 * Client-side module permission helpers (mirrors API catalog keys).
 * Source of truth remains the API / portal.modules list.
 */

export const ROUTE_MODULE: Record<string, string> = {
  "/dashboard": "dashboard",
  "/dashboard/leads": "leads",
  "/dashboard/assignments": "leads",
  "/dashboard/media": "media",
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

/**
 * @param modules - null/undefined = portal not loaded yet
 * @param opts.loaded - when true, empty modules fail closed (except profile/appearance)
 */
export function canAccessPath(
  pathname: string,
  modules: string[] | null | undefined,
  opts?: { loaded?: boolean }
): boolean {
  const loaded = opts?.loaded === true;
  // Not loaded yet — allow render shell; ModuleGate should wait
  if (modules === null || modules === undefined) {
    return !loaded;
  }
  const key = moduleKeyForPath(pathname);
  // Personal surfaces always allowed once authenticated
  if (key === "profile" || key === "appearance") return true;
  // Unknown CRM path after load → deny (prevents accidental exposure)
  if (!key) return !loaded;
  // Explicit empty grant list (should still include always-on from API)
  if (modules.length === 0) return false;
  if (modules.includes(key)) return true;
  // Media Library is core CRM: allow when user has media, leads, or documents
  if (key === "media") {
    return modules.includes("media") || modules.includes("leads") || modules.includes("documents");
  }
  return false;
}

export function filterNavByModules<T extends { href: string }>(
  items: T[],
  modules: string[] | null | undefined
): T[] {
  // Until portal loads, hide non-personal nav (fail closed for UX security)
  if (modules === null || modules === undefined) {
    return items.filter((item) => {
      const k = moduleKeyForPath(item.href);
      return k === "profile" || k === "appearance" || item.href === "/dashboard";
    });
  }
  return items.filter((item) => canAccessPath(item.href, modules, { loaded: true }));
}
