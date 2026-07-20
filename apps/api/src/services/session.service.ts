/**
 * Enterprise session management + login security.
 * Tracks devices, concurrent session limits by plan, login history, force logout.
 * MFA-ready: session meta + User.mfaEnabled reserved; login can later return mfaRequired.
 */
import { prisma } from "../lib/prisma.js";
import { notifyUser } from "./notification.service.js";
import { recordAudit } from "./audit.service.js";

export type DeviceInfo = {
  userAgent?: string | null;
  ipAddress?: string | null;
  countryCode?: string | null;
  locationLabel?: string | null;
};

export type ParsedDevice = {
  deviceName: string;
  browser: string;
  os: string;
  userAgent: string | null;
  ipAddress: string | null;
  locationLabel: string | null;
  countryCode: string | null;
};

export type ActiveSessionView = {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string | null;
  deviceName: string | null;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  locationLabel: string | null;
  loginTime: Date;
  lastActivity: Date;
  portal: string;
  isCurrent?: boolean;
};

/** Concurrent sessions allowed per subscription plan. */
export function maxConcurrentSessionsForPlan(plan: string | null | undefined): number {
  const p = (plan || "trial").toLowerCase().trim();
  if (p === "enterprise" || p === "ent") return 0; // 0 = unlimited
  if (p === "professional" || p === "pro" || p === "growth") return 3;
  if (p === "starter" || p === "basic" || p === "trial" || p === "free") return 1;
  // Paid unknown codes: default professional-like
  if (p && p !== "trial") return 3;
  return 1;
}

export function parseUserAgent(uaRaw?: string | null): {
  browser: string;
  os: string;
  deviceName: string;
} {
  const ua = (uaRaw || "").trim();
  if (!ua) {
    return { browser: "Unknown browser", os: "Unknown OS", deviceName: "Unknown device" };
  }

  let browser = "Browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/msie|trident/i.test(ua)) browser = "Internet Explorer";

  let os = "Unknown OS";
  if (/windows nt 10/i.test(ua)) os = "Windows 10/11";
  else if (/windows nt/i.test(ua)) os = "Windows";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";
  else if (/cros/i.test(ua)) os = "Chrome OS";

  const mobile = /mobile|android|iphone|ipad/i.test(ua);
  const deviceName = `${browser} on ${os}${mobile ? " (Mobile)" : ""}`;

  return { browser, os, deviceName };
}

export function buildDeviceInfo(input: DeviceInfo): ParsedDevice {
  const parsed = parseUserAgent(input.userAgent);
  const country = (input.countryCode || "").toUpperCase() || null;
  let locationLabel = input.locationLabel?.trim() || null;
  if (!locationLabel && country) locationLabel = country;
  if (!locationLabel) locationLabel = "Location unavailable";

  return {
    ...parsed,
    userAgent: input.userAgent?.slice(0, 1000) || null,
    ipAddress: input.ipAddress?.slice(0, 80) || null,
    locationLabel,
    countryCode: country,
  };
}

export async function resolveBusinessPlan(businessId: string | null | undefined): Promise<string> {
  if (!businessId) return "trial";
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { plan: true, isTrial: true, planStatus: true },
  });
  if (!b) return "trial";
  if (b.isTrial || b.planStatus === "trial") return "trial";
  return b.plan || "trial";
}

export async function countActiveSessions(userId: string): Promise<number> {
  const now = new Date();
  return prisma.userSession.count({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
}

export async function listActiveSessionsForUser(userId: string): Promise<ActiveSessionView[]> {
  const now = new Date();
  const rows = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { lastActivityAt: "desc" },
  });
  return rows.map((s) => ({
    id: s.id,
    userId: s.userId,
    deviceName: s.deviceName,
    browser: s.browser,
    os: s.os,
    ipAddress: s.ipAddress,
    locationLabel: s.locationLabel,
    loginTime: s.createdAt,
    lastActivity: s.lastActivityAt,
    portal: s.portal,
  }));
}

export class SessionLimitError extends Error {
  code = "SESSION_LIMIT" as const;
  sessions: ActiveSessionView[];
  maxSessions: number;

  constructor(sessions: ActiveSessionView[], maxSessions: number) {
    super("This account is already active on another device.");
    this.name = "SessionLimitError";
    this.sessions = sessions;
    this.maxSessions = maxSessions;
  }
}

/**
 * Create a session after successful credential check.
 * If over plan limit and forceNewSession=false → throws SessionLimitError.
 */
export async function createUserSession(opts: {
  userId: string;
  businessId?: string | null;
  portal: string;
  device: DeviceInfo;
  forceNewSession?: boolean;
  /** JWT lifetime days (default 7) */
  ttlDays?: number;
  supportMode?: boolean;
}): Promise<{ sessionId: string; device: ParsedDevice; isNewDevice: boolean }> {
  const device = buildDeviceInfo(opts.device);
  const plan = await resolveBusinessPlan(opts.businessId || null);
  const max = maxConcurrentSessionsForPlan(plan);
  const active = await listActiveSessionsForUser(opts.userId);

  // Support-mode tokens: do not enforce seat sharing limits
  if (!opts.supportMode && max > 0 && active.length >= max) {
    if (!opts.forceNewSession) {
      throw new SessionLimitError(active, max);
    }
    // Takeover: revoke enough oldest sessions to free a seat
    const toRevoke = active
      .slice()
      .sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime())
      .slice(0, active.length - max + 1);
    for (const s of toRevoke) {
      await revokeSession(s.id, "takeover");
    }
  }

  const ttlDays = opts.ttlDays ?? 7;
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);

  // New device? (no prior successful login event with same browser+os fingerprint)
  const fingerprint = `${device.browser}|${device.os}`;
  const priorDevice = await prisma.loginEvent.findFirst({
    where: {
      userId: opts.userId,
      eventType: { in: ["login", "new_device"] },
      success: true,
      browser: device.browser,
      os: device.os,
    },
    select: { id: true },
  });
  const isNewDevice = !priorDevice;

  const session = await prisma.userSession.create({
    data: {
      userId: opts.userId,
      businessId: opts.businessId || null,
      portal: opts.portal,
      deviceName: device.deviceName,
      browser: device.browser,
      os: device.os,
      userAgent: device.userAgent,
      ipAddress: device.ipAddress,
      locationLabel: device.locationLabel,
      countryCode: device.countryCode,
      expiresAt,
      meta: opts.supportMode ? { supportMode: true } : { fingerprint },
    },
  });

  await prisma.user.update({
    where: { id: opts.userId },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: device.ipAddress,
    },
  });

  await recordLoginEvent({
    userId: opts.userId,
    businessId: opts.businessId,
    sessionId: session.id,
    eventType: "login",
    success: true,
    device,
    metadata: { portal: opts.portal, forceNewSession: !!opts.forceNewSession },
  });

  if (isNewDevice) {
    await recordLoginEvent({
      userId: opts.userId,
      businessId: opts.businessId,
      sessionId: session.id,
      eventType: "new_device",
      success: true,
      device,
      metadata: { portal: opts.portal },
    });
    void notifyBusinessAdminsOfSecurityEvent({
      businessId: opts.businessId || null,
      title: "New device login",
      message: `A user signed in from a new device: ${device.deviceName} (${device.ipAddress || "unknown IP"}).`,
      userId: opts.userId,
    });
  }

  // Multi-device burst detection
  if (active.length >= 1) {
    const recent = await prisma.loginEvent.count({
      where: {
        userId: opts.userId,
        eventType: "login",
        success: true,
        createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });
    if (recent >= 2) {
      void notifyBusinessAdminsOfSecurityEvent({
        businessId: opts.businessId || null,
        title: "Multiple device logins",
        message: `Account activity from multiple devices within 15 minutes (possible credential sharing).`,
        userId: opts.userId,
      });
    }
  }

  // Location change (if we have country codes)
  if (device.countryCode) {
    const lastGeo = await prisma.loginEvent.findFirst({
      where: {
        userId: opts.userId,
        eventType: "login",
        success: true,
        countryCode: { not: null },
        NOT: { sessionId: session.id },
      },
      orderBy: { createdAt: "desc" },
      select: { countryCode: true },
    });
    if (lastGeo?.countryCode && lastGeo.countryCode !== device.countryCode) {
      void notifyBusinessAdminsOfSecurityEvent({
        businessId: opts.businessId || null,
        title: "Login from new location",
        message: `Login country changed ${lastGeo.countryCode} → ${device.countryCode} (${device.deviceName}).`,
        userId: opts.userId,
      });
    }
  }

  return { sessionId: session.id, device, isNewDevice };
}

export async function recordLoginEvent(opts: {
  userId?: string | null;
  businessId?: string | null;
  sessionId?: string | null;
  eventType: string;
  success?: boolean;
  device?: ParsedDevice | DeviceInfo | null;
  metadata?: Record<string, unknown>;
}) {
  const device = opts.device
    ? "deviceName" in opts.device && opts.device.deviceName
      ? (opts.device as ParsedDevice)
      : buildDeviceInfo(opts.device as DeviceInfo)
    : null;

  await prisma.loginEvent.create({
    data: {
      userId: opts.userId || null,
      businessId: opts.businessId || null,
      sessionId: opts.sessionId || null,
      eventType: opts.eventType,
      success: opts.success !== false,
      ipAddress: device?.ipAddress || null,
      userAgent: device?.userAgent || null,
      deviceName: device?.deviceName || null,
      browser: device?.browser || null,
      os: device?.os || null,
      locationLabel: device?.locationLabel || null,
      countryCode: device?.countryCode || null,
      metadata: (opts.metadata ?? undefined) as object | undefined,
    },
  });
}

export async function revokeSession(
  sessionId: string,
  reason: string,
  actorUserId?: string
): Promise<boolean> {
  const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt) return false;

  await prisma.userSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

  await recordLoginEvent({
    userId: session.userId,
    businessId: session.businessId,
    sessionId,
    eventType: reason === "logout" ? "logout" : "force_logout",
    success: true,
    device: {
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      locationLabel: session.locationLabel,
      countryCode: session.countryCode,
    },
    metadata: { reason, actorUserId },
  });

  return true;
}

export async function revokeAllUserSessions(
  userId: string,
  reason: string,
  exceptSessionId?: string | null
): Promise<number> {
  const now = new Date();
  const active = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    select: { id: true },
  });
  for (const s of active) {
    await revokeSession(s.id, reason);
  }
  return active.length;
}

export async function getSessionById(sessionId: string) {
  return prisma.userSession.findUnique({ where: { id: sessionId } });
}

/** Throttled last-activity update (returns false if session invalid) */
export async function touchSession(sessionId: string): Promise<boolean> {
  const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: "expired" },
    });
    return false;
  }
  const last = session.lastActivityAt.getTime();
  // Update at most every 2 minutes
  if (Date.now() - last > 2 * 60 * 1000) {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
  }
  return true;
}

export async function notifyBusinessAdminsOfSecurityEvent(opts: {
  businessId: string | null;
  title: string;
  message: string;
  userId?: string;
}) {
  if (!opts.businessId) return;
  const admins = await prisma.businessMember.findMany({
    where: {
      businessId: opts.businessId,
      role: { in: ["business_admin", "admin", "owner", "ceo"] },
    },
    select: { userId: true },
  });
  const owner = await prisma.business.findUnique({
    where: { id: opts.businessId },
    select: { ownerUserId: true },
  });
  const ids = new Set(admins.map((a) => a.userId));
  if (owner?.ownerUserId) ids.add(owner.ownerUserId);

  for (const id of ids) {
    // Don't spam the same user who just logged in about themselves excessively
    if (opts.userId && id === opts.userId && opts.title === "New device login") {
      await notifyUser(id, {
        type: "system",
        title: opts.title,
        message: opts.message,
        entityType: "Security",
        entityId: opts.userId,
      }).catch(() => undefined);
      continue;
    }
    await notifyUser(id, {
      type: "system",
      title: opts.title,
      message: opts.message,
      entityType: "Security",
      entityId: opts.userId,
    }).catch(() => undefined);
  }

  await recordAudit({
    businessId: opts.businessId,
    actorUserId: opts.userId,
    action: "security_alert",
    entityType: "Security",
    entityId: opts.userId,
    metadata: { title: opts.title, message: opts.message },
  }).catch(() => undefined);
}

/** Security dashboard aggregate for a business */
export async function getSecurityDashboard(opts: {
  businessId: string;
  /** Limit history */
  historyLimit?: number;
}) {
  const memberIds = (
    await prisma.businessMember.findMany({
      where: { businessId: opts.businessId },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  const now = new Date();
  const [sessions, history, failedCount, users] = await Promise.all([
    prisma.userSession.findMany({
      where: {
        userId: { in: memberIds },
        revokedAt: null,
        expiresAt: { gt: now },
        OR: [{ businessId: opts.businessId }, { businessId: null }],
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { lastActivityAt: "desc" },
      take: 100,
    }),
    prisma.loginEvent.findMany({
      where: {
        OR: [{ businessId: opts.businessId }, { userId: { in: memberIds } }],
      },
      orderBy: { createdAt: "desc" },
      take: opts.historyLimit ?? 50,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.loginEvent.count({
      where: {
        userId: { in: memberIds },
        eventType: "failed_login",
        createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
      },
    }),
    prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: {
        id: true,
        email: true,
        name: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        mfaEnabled: true,
      },
    }),
  ]);

  // Devices fingerprint summary
  const devicesMap = new Map<
    string,
    { key: string; browser: string; os: string; count: number; lastSeen: Date; users: Set<string> }
  >();
  for (const s of sessions) {
    const key = `${s.browser || "?"}|${s.os || "?"}`;
    const cur = devicesMap.get(key) || {
      key,
      browser: s.browser || "Unknown",
      os: s.os || "Unknown",
      count: 0,
      lastSeen: s.lastActivityAt,
      users: new Set<string>(),
    };
    cur.count += 1;
    cur.users.add(s.userId);
    if (s.lastActivityAt > cur.lastSeen) cur.lastSeen = s.lastActivityAt;
    devicesMap.set(key, cur);
  }

  return {
    activeSessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.user.email,
      userName: s.user.name,
      deviceName: s.deviceName,
      browser: s.browser,
      os: s.os,
      ipAddress: s.ipAddress,
      locationLabel: s.locationLabel,
      loginTime: s.createdAt,
      lastActivity: s.lastActivityAt,
      portal: s.portal,
    })),
    loginHistory: history.map((h) => ({
      id: h.id,
      userId: h.userId,
      userEmail: h.user?.email || null,
      userName: h.user?.name || null,
      eventType: h.eventType,
      success: h.success,
      ipAddress: h.ipAddress,
      deviceName: h.deviceName,
      browser: h.browser,
      os: h.os,
      locationLabel: h.locationLabel,
      createdAt: h.createdAt,
      metadata: h.metadata,
    })),
    devices: Array.from(devicesMap.values()).map((d) => ({
      browser: d.browser,
      os: d.os,
      activeSessions: d.count,
      userCount: d.users.size,
      lastSeen: d.lastSeen,
    })),
    failedLoginsLast7Days: failedCount,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      lastLoginAt: u.lastLoginAt,
      passwordChangedAt: u.passwordChangedAt,
      mfaEnabled: u.mfaEnabled,
    })),
    sessionPolicy: {
      plan: await resolveBusinessPlan(opts.businessId),
      maxConcurrentSessions: maxConcurrentSessionsForPlan(
        await resolveBusinessPlan(opts.businessId)
      ),
    },
  };
}

/** Per-user session stats for Manage Users table */
export async function getUserSessionStats(userIds: string[]): Promise<
  Map<
    string,
    { activeSessions: number; deviceCount: number; lastLoginAt: Date | null }
  >
> {
  const map = new Map<
    string,
    { activeSessions: number; deviceCount: number; lastLoginAt: Date | null }
  >();
  for (const id of userIds) {
    map.set(id, { activeSessions: 0, deviceCount: 0, lastLoginAt: null });
  }
  if (!userIds.length) return map;

  const now = new Date();
  const sessions = await prisma.userSession.findMany({
    where: {
      userId: { in: userIds },
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { userId: true, browser: true, os: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, lastLoginAt: true },
  });

  const deviceSets = new Map<string, Set<string>>();
  for (const s of sessions) {
    const cur = map.get(s.userId)!;
    cur.activeSessions += 1;
    const set = deviceSets.get(s.userId) || new Set();
    set.add(`${s.browser}|${s.os}`);
    deviceSets.set(s.userId, set);
  }
  for (const [uid, set] of deviceSets) {
    const cur = map.get(uid)!;
    cur.deviceCount = set.size;
  }
  for (const u of users) {
    const cur = map.get(u.id)!;
    cur.lastLoginAt = u.lastLoginAt;
  }
  return map;
}
