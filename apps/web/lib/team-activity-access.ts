/**
 * Client-side Team Activity / Member Activity access.
 * Must stay aligned with apps/api team-activity-realtime.service canViewTeamActivity.
 *
 * Product requirement: Business Admin + CEO only.
 *
 * Intentional key aliases (portal definitions):
 * - owner → CEO portal (roles: ["ceo", "owner"])
 * - admin → Business Admin portal (roles: ["business_admin", "admin"])
 *
 * Excluded:
 * - super_admin → platform operator (platformRole), not tenant BA/CEO
 * - sales_manager, manager, sales_executive, and all other team roles
 */
export const TEAM_ACTIVITY_VIEWER_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
]);

export function canViewTeamActivity(role: string | null | undefined): boolean {
  return TEAM_ACTIVITY_VIEWER_ROLES.has(String(role || "").toLowerCase());
}
