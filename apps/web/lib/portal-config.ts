/**
 * Production multi-portal configuration.
 *
 * demo.massivementor.in  → Demo product tour (sample data)
 * admin.massivementor.in → Super Admin platform ops
 * crm.massivementor.in    → Customer CRM (primary)
 * app.massivementor.in    → Customer CRM (legacy alias)
 *
 * Local dev uses path prefixes: /demo, /admin, /dashboard
 */

export type PortalId = "customer" | "admin" | "demo";

export const PORTAL_TOKENS: Record<PortalId, string> = {
  customer: "massive_mentor_token",
  admin: "massive_mentor_admin_token",
  demo: "massive_mentor_demo_token",
};

export const PORTAL_USER_KEYS: Record<PortalId, string> = {
  customer: "massive_mentor_user",
  admin: "massive_mentor_admin_user",
  demo: "massive_mentor_demo_user",
};

export function portalFromHostname(host: string): PortalId | null {
  const h = host.toLowerCase().split(":")[0];
  if (h.startsWith("demo.") || h.startsWith("demo-") || h.includes(".demo.")) return "demo";
  if (h.startsWith("admin.") || h.startsWith("admin-") || h.startsWith("platform.")) return "admin";
  if (h.startsWith("app.") || h.startsWith("crm.")) return "customer";
  return null;
}

export function portalFromPath(pathname: string): PortalId | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/demo" || pathname.startsWith("/demo/")) return "demo";
  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/login" ||
    pathname === "/register"
  ) {
    return "customer";
  }
  return null;
}

export function resolvePortal(host: string, pathname: string): PortalId {
  return portalFromHostname(host) || portalFromPath(pathname) || "customer";
}

export const PORTAL_HOME: Record<PortalId, string> = {
  customer: "/dashboard",
  admin: "/admin",
  demo: "/dashboard",
};

export const PORTAL_LOGIN: Record<PortalId, string> = {
  customer: "/login",
  admin: "/admin/login",
  demo: "/demo/login",
};
