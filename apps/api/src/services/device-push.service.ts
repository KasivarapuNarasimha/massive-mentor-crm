/**
 * Device push token lifecycle (Phase 3).
 *
 * Upsert key: (appId, installId)
 * Token uniqueness: (appId, provider, token)
 * businessId is a last-known workspace HINT only — never used for ACL.
 */
import { prisma } from "../lib/prisma.js";

export const DEFAULT_PUSH_APP_ID = "in.massivementor.crm";

export type RegisterDevicePushInput = {
  userId: string;
  installId: string;
  platform: string;
  token: string;
  provider?: string;
  appId?: string;
  /** Optional last-known workspace hint — NOT authorization */
  businessId?: string | null;
};

function normalizePlatform(platform: string): string {
  const p = String(platform || "").toLowerCase().trim();
  if (p === "android" || p === "ios" || p === "web") return p;
  throw Object.assign(new Error("platform must be android, ios, or web"), { status: 400 });
}

function normalizeInstallId(installId: string): string {
  const id = String(installId || "").trim();
  if (id.length < 8 || id.length > 128) {
    throw Object.assign(new Error("installId must be 8–128 characters"), { status: 400 });
  }
  return id;
}

function normalizeToken(token: string): string {
  const t = String(token || "").trim();
  if (t.length < 20 || t.length > 4096) {
    throw Object.assign(new Error("token length invalid"), { status: 400 });
  }
  return t;
}

/**
 * Register or refresh a device push token for the authenticated user.
 * Upserts by (appId, installId). Re-associates userId on login to the same install.
 */
export async function registerDevicePushToken(input: RegisterDevicePushInput) {
  const appId = (input.appId || DEFAULT_PUSH_APP_ID).trim() || DEFAULT_PUSH_APP_ID;
  const provider = (input.provider || "fcm").toLowerCase().trim() || "fcm";
  const platform = normalizePlatform(input.platform);
  const installId = normalizeInstallId(input.installId);
  const token = normalizeToken(input.token);
  const now = new Date();

  let businessId: string | null = null;
  if (input.businessId) {
    const biz = await prisma.business.findUnique({
      where: { id: input.businessId },
      select: { id: true },
    });
    businessId = biz?.id ?? null;
  }

  // If this exact provider token already exists under a different install, reclaim it
  // (FCM can rotate; unique(appId,provider,token) must not collide).
  const byToken = await prisma.devicePushToken.findUnique({
    where: { appId_provider_token: { appId, provider, token } },
  });
  if (byToken && byToken.installId !== installId) {
    await prisma.devicePushToken.delete({ where: { id: byToken.id } });
  }

  const row = await prisma.devicePushToken.upsert({
    where: { appId_installId: { appId, installId } },
    create: {
      userId: input.userId,
      businessId,
      installId,
      platform,
      provider,
      token,
      appId,
      enabled: true,
      revokedAt: null,
      revokedReason: null,
      lastSeenAt: now,
      lastError: null,
    },
    update: {
      userId: input.userId,
      businessId: businessId !== null ? businessId : undefined,
      platform,
      provider,
      token,
      enabled: true,
      revokedAt: null,
      revokedReason: null,
      lastSeenAt: now,
      lastError: null,
    },
  });

  return row;
}

/** Refresh lastSeenAt / token for an existing install owned by the user. */
export async function refreshDevicePushToken(input: RegisterDevicePushInput) {
  return registerDevicePushToken(input);
}

export type RevokeDevicePushInput = {
  userId: string;
  installId?: string;
  appId?: string;
  /** If true, revoke all installs for this user+app (rare — explicit only) */
  allDevices?: boolean;
  reason?: string;
};

/** Logout / revoke: disable current install only unless allDevices requested. */
export async function revokeDevicePushToken(input: RevokeDevicePushInput) {
  const appId = (input.appId || DEFAULT_PUSH_APP_ID).trim() || DEFAULT_PUSH_APP_ID;
  const now = new Date();
  const reason = input.reason || "logout";

  if (input.allDevices) {
    const result = await prisma.devicePushToken.updateMany({
      where: { userId: input.userId, appId, enabled: true },
      data: {
        enabled: false,
        revokedAt: now,
        revokedReason: reason,
      },
    });
    return { revoked: result.count };
  }

  if (!input.installId) {
    throw Object.assign(new Error("installId is required unless allDevices=true"), { status: 400 });
  }
  const installId = normalizeInstallId(input.installId);

  const result = await prisma.devicePushToken.updateMany({
    where: { userId: input.userId, appId, installId },
    data: {
      enabled: false,
      revokedAt: now,
      revokedReason: reason,
    },
  });
  return { revoked: result.count };
}

/** Mark token invalid after FCM/APNs provider rejection. */
export async function markDevicePushProviderInvalid(opts: {
  id: string;
  error?: string;
}) {
  await prisma.devicePushToken.update({
    where: { id: opts.id },
    data: {
      enabled: false,
      revokedAt: new Date(),
      revokedReason: "provider_invalid",
      lastError: opts.error ? String(opts.error).slice(0, 500) : "provider_invalid",
    },
  });
}

/** Soft-disable all tokens for a disabled user (safe batch). */
export async function disableDevicePushTokensForUser(userId: string, reason = "user_disabled") {
  const result = await prisma.devicePushToken.updateMany({
    where: { userId, enabled: true },
    data: {
      enabled: false,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
  return { disabled: result.count };
}

export async function listEnabledTokensForUser(userId: string, appId = DEFAULT_PUSH_APP_ID) {
  return prisma.devicePushToken.findMany({
    where: { userId, appId, enabled: true, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
  });
}
