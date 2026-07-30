/**
 * In-process pub/sub for live subscription updates to open CRM sessions.
 * Super Admin plan changes → publish(businessId) → SSE clients refresh immediately.
 *
 * Note: multi-instance API deploys need a shared bus (Redis) later; single PM2 process is fine.
 */
import { EventEmitter } from "node:events";

export type SubscriptionRealtimePayload = {
  type: "subscription_changed";
  businessId: string;
  at: string;
  plan?: string | null;
  planStatus?: string | null;
  isTrial?: boolean;
  licenseStatus?: string | null;
  isLocked?: boolean;
  subscriptionEndsAt?: string | null;
  trialEndsAt?: string | null;
  action?: string;
  source?: string;
};

const bus = new EventEmitter();
// Many concurrent CRM tabs per tenant
bus.setMaxListeners(500);

const channel = (businessId: string) => `sub:${businessId}`;

export function publishSubscriptionChange(
  businessId: string,
  payload: Omit<SubscriptionRealtimePayload, "type" | "businessId" | "at"> & {
    type?: string;
  } = {}
): void {
  if (!businessId) return;
  const full: SubscriptionRealtimePayload = {
    type: "subscription_changed",
    businessId,
    at: new Date().toISOString(),
    plan: payload.plan ?? null,
    planStatus: payload.planStatus ?? null,
    isTrial: payload.isTrial,
    licenseStatus: payload.licenseStatus ?? null,
    isLocked: payload.isLocked,
    subscriptionEndsAt: payload.subscriptionEndsAt ?? null,
    trialEndsAt: payload.trialEndsAt ?? null,
    action: payload.action,
    source: payload.source,
  };
  try {
    bus.emit(channel(businessId), full);
    // Global debug channel (optional listeners)
    bus.emit("subscription_changed", full);
    console.log(
      `[subscription-realtime] publish businessId=${businessId} plan=${full.plan} status=${full.planStatus} isTrial=${full.isTrial} source=${full.source || "n/a"}`
    );
  } catch (e) {
    console.warn(
      "[subscription-realtime] publish failed:",
      e instanceof Error ? e.message : e
    );
  }
}

export function subscribeSubscriptionChanges(
  businessId: string,
  listener: (payload: SubscriptionRealtimePayload) => void
): () => void {
  const ch = channel(businessId);
  bus.on(ch, listener);
  return () => {
    bus.off(ch, listener);
  };
}
