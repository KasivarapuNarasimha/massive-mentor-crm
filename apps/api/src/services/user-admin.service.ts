import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ensureDefaultBusiness } from "@/services/business.service";
import { recordAudit } from "@/services/audit.service";
import { getBusinessConfig } from "@/services/template.service";

/** Roles Business Admin may assign (from portal/config — not industry-specific) */
export const ASSIGNABLE_ROLES = [
  "ceo",
  "business_admin",
  "sales_manager",
  "sales_executive",
  "support_manager",
  "support_executive",
  "support",
  "hr",
  "finance",
  "marketing",
  "viewer",
  "manager",
  "admin",
  "owner",
] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const ADMIN_ROLES = new Set(["business_admin", "admin", "owner", "ceo", "super_admin"]);

export type BusinessUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  membershipRole: string;
  membershipId: string;
  isDisabled: boolean;
  status: "active" | "disabled";
  createdAt: Date;
  isOwner: boolean;
  lastLoginAt?: Date | null;
  activeSessions?: number;
  deviceCount?: number;
  passwordChangedAt?: Date | null;
};

/**
 * Resolve admin capability from User.role OR BusinessMember.role OR platformRole.
 * Fixes false empty Switch User when portal role is admin but User.role lagged.
 */
export async function assertCanManageUsers(actorUserId: string): Promise<{
  businessId: string;
  actorRole: string;
}> {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, platformRole: true, isDisabled: true },
  });
  if (!actor) throw new Error("Not authenticated");
  if (actor.isDisabled) throw new Error("Account is disabled");

  const biz = await ensureDefaultBusiness(actorUserId);
  const membership = await prisma.businessMember.findFirst({
    where: { userId: actorUserId, businessId: biz.id },
  });
  const actorRole = membership?.role || actor.role || "";

  if (actor.platformRole === "super_admin") {
    return { businessId: biz.id, actorRole: "super_admin" };
  }
  if (!ADMIN_ROLES.has(actorRole) && !ADMIN_ROLES.has(actor.role || "")) {
    throw new Error("Only Business Admin can manage users");
  }
  return { businessId: biz.id, actorRole };
}

async function resolveAllowedRoles(businessId: string): Promise<string[]> {
  const config = await getBusinessConfig(businessId);
  const configRoles = Array.isArray(config?.roles)
    ? (config!.roles as Array<{ key: string }>).map((r) => r.key)
    : [];
  return configRoles.length > 0 ? configRoles : [...ASSIGNABLE_ROLES];
}

/**
 * Business Admin creates a user with login credentials + role, joined to the same business.
 */
export async function createBusinessUser(opts: {
  actorUserId: string;
  email: string;
  password: string;
  name?: string;
  role: string;
}) {
  const { businessId } = await assertCanManageUsers(opts.actorUserId);

  const role = opts.role.trim();
  const allowed = await resolveAllowedRoles(businessId);
  if (!allowed.includes(role) && !ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new Error(`Invalid role. Allowed: ${allowed.join(", ")}`);
  }

  const email = opts.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const mem = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: existing.id } },
    });
    if (mem) {
      throw new Error(
        "This email is already registered as a user in your business. Each employee must use a unique email."
      );
    }
    // One email = one global user: may join this business only if not already a member.
    // Prefer creating distinct employees with their own passwords when possible.
    await prisma.businessMember.create({
      data: { businessId, userId: existing.id, role },
    });
    await prisma.user.update({
      where: { id: existing.id },
      data: { role, isDisabled: false },
    });
    await recordAudit({
      businessId,
      actorUserId: opts.actorUserId,
      action: "create",
      entityType: "business_member",
      entityId: existing.id,
      metadata: { email, role, existingUser: true },
    });
    return {
      user: {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role,
      },
      created: false,
    };
  }

  if (!opts.password || opts.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(opts.password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: opts.name?.trim() || null,
      role,
      platformRole: "user",
      isDisabled: false,
      businessMembers: {
        create: {
          businessId,
          role,
        },
      },
    },
    select: { id: true, email: true, name: true, role: true },
  });

  await recordAudit({
    businessId,
    actorUserId: opts.actorUserId,
    action: "create",
    entityType: "user",
    entityId: user.id,
    metadata: { email, role },
  });

  return { user, created: true };
}

/**
 * List every BusinessMember for the current business (real DB rows only).
 */
export async function listBusinessUsers(actorUserId: string): Promise<{
  businessId: string;
  users: BusinessUserRow[];
}> {
  const { businessId } = await assertCanManageUsers(actorUserId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { ownerUserId: true },
  });

  const members = await prisma.businessMember.findMany({
    where: { businessId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isDisabled: true,
          createdAt: true,
          lastLoginAt: true,
          passwordChangedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const { getUserSessionStats } = await import("@/services/session.service");
  const stats = await getUserSessionStats(members.map((m) => m.user.id));

  return {
    businessId,
    users: members.map((m) => {
      const isDisabled = !!m.user.isDisabled;
      const st = stats.get(m.user.id);
      return {
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role || m.user.role,
        membershipRole: m.role,
        membershipId: m.id,
        isDisabled,
        status: isDisabled ? ("disabled" as const) : ("active" as const),
        createdAt: m.user.createdAt,
        isOwner: m.user.id === business?.ownerUserId,
        lastLoginAt: m.user.lastLoginAt ?? st?.lastLoginAt ?? null,
        activeSessions: st?.activeSessions ?? 0,
        deviceCount: st?.deviceCount ?? 0,
        passwordChangedAt: m.user.passwordChangedAt ?? null,
      };
    }),
  };
}

export async function updateBusinessUser(opts: {
  actorUserId: string;
  userId: string;
  name?: string | null;
  email?: string;
  role?: string;
  password?: string;
}) {
  const { businessId } = await assertCanManageUsers(opts.actorUserId);
  const mem = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: opts.userId } },
  });
  if (!mem) throw new Error("User is not a member of this business");

  const data: {
    name?: string | null;
    email?: string;
    role?: string;
    passwordHash?: string;
  } = {};

  if (opts.name !== undefined) data.name = opts.name?.trim() || null;
  if (opts.email) {
    const email = opts.email.toLowerCase().trim();
    const clash = await prisma.user.findFirst({
      where: { email, NOT: { id: opts.userId } },
    });
    if (clash) throw new Error("Email already in use");
    data.email = email;
  }
  if (opts.role) {
    const allowed = await resolveAllowedRoles(businessId);
    if (!allowed.includes(opts.role) && !ASSIGNABLE_ROLES.includes(opts.role as AssignableRole)) {
      throw new Error(`Invalid role. Allowed: ${allowed.join(", ")}`);
    }
    data.role = opts.role;
    await prisma.businessMember.update({
      where: { id: mem.id },
      data: { role: opts.role },
    });
  }
  if (opts.password) {
    if (opts.password.length < 8) throw new Error("Password must be at least 8 characters");
    data.passwordHash = await bcrypt.hash(opts.password, 12);
  }

  const user = await prisma.user.update({
    where: { id: opts.userId },
    data: {
      ...data,
      ...(opts.password
        ? { tokenVersion: { increment: 1 }, passwordChangedAt: new Date() }
        : {}),
    },
    select: { id: true, email: true, name: true, role: true, isDisabled: true },
  });

  if (opts.password) {
    try {
      const { revokeAllUserSessions, recordLoginEvent } = await import(
        "@/services/session.service"
      );
      await revokeAllUserSessions(opts.userId, "password_change");
      await recordLoginEvent({
        userId: opts.userId,
        businessId,
        eventType: "password_changed",
        success: true,
        metadata: { via: "admin_reset", actorUserId: opts.actorUserId },
      });
    } catch {
      /* non-fatal */
    }
  }

  await recordAudit({
    businessId,
    actorUserId: opts.actorUserId,
    action: "update",
    entityType: "user",
    entityId: opts.userId,
    metadata: {
      name: opts.name !== undefined,
      email: !!opts.email,
      role: opts.role,
      password: !!opts.password,
    },
  });

  return user;
}

export async function updateBusinessUserRole(opts: {
  actorUserId: string;
  userId: string;
  role: string;
}) {
  return updateBusinessUser({
    actorUserId: opts.actorUserId,
    userId: opts.userId,
    role: opts.role,
  }).then((u) => ({ userId: u.id, role: u.role }));
}

export async function setBusinessUserDisabled(opts: {
  actorUserId: string;
  userId: string;
  disabled: boolean;
}) {
  const { businessId } = await assertCanManageUsers(opts.actorUserId);
  if (opts.actorUserId === opts.userId) {
    throw new Error("You cannot disable your own account");
  }

  const mem = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: opts.userId } },
  });
  if (!mem) throw new Error("User is not a member of this business");

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (business?.ownerUserId === opts.userId && opts.disabled) {
    throw new Error("Cannot disable the business owner");
  }

  await prisma.user.update({
    where: { id: opts.userId },
    data: {
      isDisabled: opts.disabled,
      ...(opts.disabled ? { tokenVersion: { increment: 1 } } : {}),
    },
  });

  if (opts.disabled) {
    try {
      const { revokeAllUserSessions } = await import("@/services/session.service");
      await revokeAllUserSessions(opts.userId, "disabled");
    } catch {
      /* non-fatal */
    }
  }

  await recordAudit({
    businessId,
    actorUserId: opts.actorUserId,
    action: "update",
    entityType: "user",
    entityId: opts.userId,
    metadata: { action: opts.disabled ? "disable" : "enable" },
  });

  return { userId: opts.userId, isDisabled: opts.disabled };
}

/**
 * Remove user from this business. If they have no other memberships, delete the User row.
 * Business owner cannot be deleted.
 */
export async function deleteBusinessUser(opts: {
  actorUserId: string;
  userId: string;
}) {
  const { businessId } = await assertCanManageUsers(opts.actorUserId);
  if (opts.actorUserId === opts.userId) {
    throw new Error("You cannot delete your own account");
  }

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (business?.ownerUserId === opts.userId) {
    throw new Error("Cannot delete the business owner");
  }

  const mem = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: opts.userId } },
  });
  if (!mem) throw new Error("User is not a member of this business");

  await prisma.businessMember.delete({ where: { id: mem.id } });

  const remaining = await prisma.businessMember.count({
    where: { userId: opts.userId },
  });
  let userDeleted = false;
  if (remaining === 0) {
    // Only delete user account if they own no businesses
    const owned = await prisma.business.count({ where: { ownerUserId: opts.userId } });
    if (owned === 0) {
      await prisma.user.delete({ where: { id: opts.userId } });
      userDeleted = true;
    } else {
      await prisma.user.update({
        where: { id: opts.userId },
        data: { isDisabled: true },
      });
    }
  }

  await recordAudit({
    businessId,
    actorUserId: opts.actorUserId,
    action: "delete",
    entityType: "user",
    entityId: opts.userId,
    metadata: { userDeleted, removedFromBusiness: true },
  });

  return { userId: opts.userId, userDeleted };
}
