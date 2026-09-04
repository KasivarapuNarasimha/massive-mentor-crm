/**
 * Bridge between existing notification poll (DashboardShell) and Team Activity
 * toaster — used only as SSE fallback. Does NOT create a second network poll.
 */
export const TEAM_ACTIVITY_NOTIF_EVENT = "mm:team-activity-notif";

export type TeamActivityNotifDetail = {
  id: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  createdAt?: string;
};

export function emitTeamActivityFromNotification(detail: TeamActivityNotifDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TEAM_ACTIVITY_NOTIF_EVENT, { detail })
  );
}
