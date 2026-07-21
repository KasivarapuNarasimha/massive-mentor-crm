/**
 * Production multi-portal architecture.
 * Three completely separate surfaces — never role-switch in one UI.
 *
 * demo.massivementor.in  → product demonstration (sample data only)
 * admin.massivementor.in → Super Admin platform management
 * crm.massivementor.in  → Customer CRM workspaces (primary)
 * app.massivementor.in   → Customer CRM (legacy alias)
 */
export type PortalAudience = "customer" | "admin" | "demo";

export const PORTAL_HOST_HINTS: Record<PortalAudience, string[]> = {
  demo: ["demo.", "demo-"],
  admin: ["admin.", "admin-", "platform."],
  customer: ["app.", "crm.", "www."],
};

export function portalFromHost(host?: string | null): PortalAudience | null {
  if (!host) return null;
  const h = host.toLowerCase().split(":")[0];
  if (PORTAL_HOST_HINTS.demo.some((p) => h.startsWith(p) || h.includes(".demo."))) return "demo";
  if (PORTAL_HOST_HINTS.admin.some((p) => h.startsWith(p) || h.includes(".admin."))) return "admin";
  if (PORTAL_HOST_HINTS.customer.some((p) => h.startsWith(p))) return "customer";
  return null;
}
