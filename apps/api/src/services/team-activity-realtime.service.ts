/**
 * In-process pub/sub for live team CRM activity toasts (Admin).
 * Pattern mirrors subscription-realtime.service.ts (single PM2 process).
 */
import { EventEmitter } from "node:events";

export type TeamActivityRealtimePayload = {
  type: "team_activity";
  businessId: string;
  at: string;
  eventId: string;
  actorUserId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  title: string;
  message: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(500);

const channel = (businessId: string) => `team-activity:${businessId}`;

const MEANINGFUL = new Set([
  "created",
  "updated",
  "bulk_updated",
  "email_sent",
  "task_completed",
  "auto_created_from_lead",
]);

export function isMeaningfulTeamActivity(action: string, entityType: string): boolean {
  if (!MEANINGFUL.has(action)) return false;
  const et = (entityType || "").toLowerCase();
  return (
    et === "contact" ||
    et === "deal" ||
    et === "task" ||
    et === "meeting" ||
    et === "lead" ||
    et === "client"
  );
}

export function formatTeamActivityCopy(opts: {
  actorName: string;
  action: string;
  entityType: string;
  details?: Record<string, unknown> | null;
}): { title: string; message: string } {
  const name = opts.actorName || "A teammate";
  const et = (opts.entityType || "").toLowerCase();
  const label =
    et === "contact" || et === "lead"
      ? "Lead"
      : et === "client"
        ? "Client"
        : et === "deal"
          ? "Deal"
          : et === "task"
            ? "Task"
            : et === "meeting"
              ? "Meeting"
              : "record";
  const detailTitle =
    typeof opts.details?.title === "string" && opts.details.title.trim()
      ? opts.details.title.trim()
      : typeof opts.details?.name === "string" && opts.details.name.trim()
        ? opts.details.name.trim()
        : "";

  if (opts.action === "created" || opts.action === "auto_created_from_lead") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} created a ${label}: ${detailTitle}`
        : `${name} created a ${label}`,
    };
  }
  if (opts.action === "updated" || opts.action === "bulk_updated") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} updated ${label}: ${detailTitle}`
        : `${name} updated a ${label}`,
    };
  }
  if (opts.action === "email_sent") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} sent an email for ${label}: ${detailTitle}`
        : `${name} sent an email`,
    };
  }
  if (opts.action === "task_completed") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} completed a follow-up: ${detailTitle}`
        : `${name} completed a follow-up task`,
    };
  }
  return {
    title: "New Team Activity",
    message: `${name} performed ${opts.action} on a ${label}`,
  };
}

export function publishTeamActivity(payload: TeamActivityRealtimePayload): void {
  if (!payload.businessId) return;
  try {
    bus.emit(channel(payload.businessId), payload);
  } catch (e) {
    console.warn(
      "[team-activity-realtime] publish failed:",
      e instanceof Error ? e.message : e
    );
  }
}

export function subscribeTeamActivity(
  businessId: string,
  listener: (payload: TeamActivityRealtimePayload) => void
): () => void {
  const ch = channel(businessId);
  bus.on(ch, listener);
  return () => {
    bus.off(ch, listener);
  };
}
