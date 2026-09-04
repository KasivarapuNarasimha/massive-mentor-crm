/**
 * In-process pub/sub for live team CRM activity toasts (Admin).
 * Pattern mirrors subscription-realtime.service.ts (single PM2 process).
 *
 * Visibility: Business Admin + CEO only.
 *
 * Role-key mapping (from portals / DEFAULT_ROLES — not inventing new roles):
 * - CEO portal roles: ["ceo", "owner"]  → owner is CEO-equivalent
 * - Business Admin portal roles: ["business_admin", "admin"] → admin is BA legacy alias
 * - super_admin is platformRole (platform operator), NOT a tenant BA/CEO → excluded
 *
 * Sales Manager / Sales Executive and other roles must not subscribe or receive.
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

/**
 * Roles allowed to view Team Activity / Member Activity / live toast+sound.
 * Exact product requirement: Business Admin + CEO (with intentional key aliases only).
 */
export const TEAM_ACTIVITY_VIEWER_ROLES = new Set([
  "ceo",
  "owner", // CEO portal alias — same portal/dashboard as ceo
  "business_admin",
  "admin", // Business Admin legacy alias — same portal/dashboard as business_admin
]);

export function canViewTeamActivity(role: string | null | undefined): boolean {
  return TEAM_ACTIVITY_VIEWER_ROLES.has(String(role || "").toLowerCase());
}

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
  "note_added",
  "assigned",
  "won",
  "lost",
  "payment_recorded",
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
    et === "client" ||
    et === "note"
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
  if (opts.action === "note_added") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} added a note on ${label}: ${detailTitle}`
        : `${name} added a note`,
    };
  }
  if (opts.action === "assigned") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} changed assignment on ${label}: ${detailTitle}`
        : `${name} changed a ${label} assignment`,
    };
  }
  if (opts.action === "won") {
    return {
      title: "New Team Activity",
      message: detailTitle ? `${name} won deal: ${detailTitle}` : `${name} won a deal`,
    };
  }
  if (opts.action === "lost") {
    return {
      title: "New Team Activity",
      message: detailTitle ? `${name} marked deal lost: ${detailTitle}` : `${name} lost a deal`,
    };
  }
  if (opts.action === "payment_recorded") {
    return {
      title: "New Team Activity",
      message: detailTitle
        ? `${name} recorded a payment${detailTitle ? ` (${detailTitle})` : ""}`
        : `${name} recorded a payment`,
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
    const ch = channel(payload.businessId);
    const listeners = bus.listenerCount(ch);
    // If 0, Admins will still get the bell (DB notify) but no live toast.
    if (listeners === 0) {
      console.warn(
        "[team-activity-realtime] publish with 0 SSE listeners businessId=%s action=%s",
        payload.businessId,
        payload.action
      );
    }
    bus.emit(ch, payload);
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

/**
 * Businesses this user should listen on for live team-activity toasts.
 *
 * IMPORTANT: Do NOT use only getUserBusinessId(). Multi-business admins may have
 * a "primary" resolved business that differs from the workspace where teammates
 * are acting — notifications still fan out by membership, so SSE must too.
 *
 * Only memberships where the member role is a Team Activity viewer are included.
 * Do not fall back to primary business for non-viewers (that leaked SSE access).
 */
export async function listTeamActivityListenBusinessIds(
  userId: string
): Promise<string[]> {
  const { prisma } = await import("../lib/prisma.js");
  const members = await prisma.businessMember.findMany({
    where: {
      userId,
      business: {
        isDemo: false,
        NOT: { portalKind: "demo" },
        status: { not: "deleted" },
      },
    },
    include: {
      user: { select: { role: true } },
      business: { select: { id: true, status: true } },
    },
  });

  const ids: string[] = [];
  for (const m of members) {
    const role = String(m.role || m.user?.role || "").toLowerCase();
    if (!canViewTeamActivity(role)) continue;
    ids.push(m.businessId);
  }

  // If the actor is a Team Activity viewer but membership role fields were empty,
  // include primary business only after confirming resolveActorRole allows them.
  if (ids.length === 0) {
    try {
      const { resolveActorRole } = await import("./tenant-scope.service.js");
      const actorRole = await resolveActorRole(userId);
      if (canViewTeamActivity(actorRole)) {
        const { getUserBusinessId } = await import("./field-engine.service.js");
        const primary = await getUserBusinessId(userId);
        if (primary) ids.push(primary);
      }
    } catch {
      /* ignore */
    }
  }

  return [...new Set(ids)];
}
