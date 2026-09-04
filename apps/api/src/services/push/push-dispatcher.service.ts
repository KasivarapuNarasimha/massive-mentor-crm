/**
 * PushDispatcher — called after notifyUser persists an inbox row.
 *
 * Authorization rules (critical):
 * - Personal types (lead_assigned, etc.): push to recipient userId's enabled tokens.
 * - team_activity: re-check membership for event businessId + canViewTeamActivity(role).
 *   NEVER trust DevicePushToken.businessId. NEVER use platformRole shortcuts.
 * - Disabled users: no push.
 * - Provider-invalid tokens: enabled=false, revokedReason=provider_invalid.
 */
import { prisma } from "../../lib/prisma.js";
import { canViewTeamActivity } from "../team-activity-realtime.service.js";
import {
  listEnabledTokensForUser,
  markDevicePushProviderInvalid,
} from "../device-push.service.js";
import { fcmPushProvider } from "./fcm.provider.js";
import type { PushProvider } from "./push-provider.js";

export type DispatchPushInput = {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  /** Required for team_activity ACL — the event's businessId */
  businessId?: string | null;
  notificationId?: string;
};

const providers: PushProvider[] = [fcmPushProvider];

function deepLinkPath(opts: DispatchPushInput): string {
  const et = (opts.entityType || "").toLowerCase();
  if (et === "contact" || et === "lead" || et === "client") {
    return opts.entityId ? `/dashboard/leads?id=${encodeURIComponent(opts.entityId)}` : "/dashboard/leads";
  }
  if (et === "deal") {
    return opts.entityId ? `/dashboard/pipeline?deal=${encodeURIComponent(opts.entityId)}` : "/dashboard/pipeline";
  }
  if (et === "task") return "/dashboard/tasks";
  if (et === "meeting") return "/dashboard/meetings";
  if (opts.type === "team_activity") return "/dashboard/team-activity";
  return "/dashboard";
}

/**
 * Resolve membership role for a specific business — never fall back to platformRole.
 */
async function membershipRoleForBusiness(
  userId: string,
  businessId: string
): Promise<string | null> {
  const mem = await prisma.businessMember.findFirst({
    where: { userId, businessId },
    select: { role: true },
  });
  return mem?.role ?? null;
}

async function assertMayReceivePush(input: DispatchPushInput): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, isDisabled: true },
  });
  if (!user || user.isDisabled) return false;

  if (input.type === "team_activity") {
    if (!input.businessId) {
      // Without event businessId we cannot authorize — skip push (inbox row already created by caller).
      console.warn("[push] team_activity missing businessId — skipping push");
      return false;
    }
    const role = await membershipRoleForBusiness(input.userId, input.businessId);
    if (!role) return false; // membership removed → no Team Activity push
    if (!canViewTeamActivity(role)) return false; // SM/SE blocked
    return true;
  }

  // Personal / other notification types: recipient is already chosen by notifyUser caller
  return true;
}

export async function dispatchPushForNotification(input: DispatchPushInput): Promise<{
  attempted: number;
  sent: number;
  skipped: string | null;
}> {
  try {
    const allowed = await assertMayReceivePush(input);
    if (!allowed) {
      return { attempted: 0, sent: 0, skipped: "not_authorized_or_disabled" };
    }

    const tokens = await listEnabledTokensForUser(input.userId);
    if (!tokens.length) {
      return { attempted: 0, sent: 0, skipped: "no_tokens" };
    }

    const path = deepLinkPath(input);
    const data: Record<string, string> = {
      type: input.type,
      path,
      entityType: input.entityType || "",
      entityId: input.entityId || "",
      notificationId: input.notificationId || "",
      businessId: input.businessId || "",
    };

    let sent = 0;
    for (const row of tokens) {
      const provider =
        providers.find((p) => p.name === row.provider) ||
        (row.provider === "fcm" || row.provider === "apns" ? fcmPushProvider : null);
      if (!provider || !provider.isConfigured()) {
        // Dev: no credentials — skip silently (registration APIs still work)
        continue;
      }
      const result = await provider.send(row.token, {
        title: input.title,
        body: input.message,
        data,
      });
      if (result.ok) {
        sent++;
        await prisma.devicePushToken
          .update({
            where: { id: row.id },
            data: { lastPushAt: new Date(), lastError: null },
          })
          .catch(() => undefined);
      } else if (result.invalidToken) {
        await markDevicePushProviderInvalid({ id: row.id, error: result.error }).catch(
          () => undefined
        );
      } else if (result.error) {
        await prisma.devicePushToken
          .update({
            where: { id: row.id },
            data: { lastError: result.error.slice(0, 500) },
          })
          .catch(() => undefined);
      }
    }

    return { attempted: tokens.length, sent, skipped: null };
  } catch (e) {
    console.warn("[push] dispatch failed", e instanceof Error ? e.message : e);
    return { attempted: 0, sent: 0, skipped: "dispatch_error" };
  }
}

/** Test helper — expose ACL check */
export async function __testCanReceiveTeamActivityPush(
  userId: string,
  businessId: string
): Promise<boolean> {
  return assertMayReceivePush({
    userId,
    type: "team_activity",
    title: "t",
    message: "m",
    businessId,
  });
}
