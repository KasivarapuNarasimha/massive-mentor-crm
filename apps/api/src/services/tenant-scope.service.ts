import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";

/** Roles that only see contacts assigned to them or created by them */
const OWN_DATA_ONLY_ROLES = new Set([
  "sales_executive",
  "support_executive",
]);

/**
 * Sales managers: own + assigned leads + leads assigned to reporting team members.
 * NOT full workspace visibility.
 */
const TEAM_SCOPED_ROLES = new Set([
  "sales_manager",
  "manager",
]);

/** Roles that see full business CRM data (admin / leadership / ops) */
const BUSINESS_WIDE_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
  "finance",
  "hr",
  "marketing",
  "support_manager",
  "support",
  "viewer",
]);

export type CrmScope = {
  businessId: string | null;
  role: string;
  userId: string;
  /**
   * True when contact queries must restrict by assignee / owner list
   * (Sales Executive, Sales Manager team scope).
   */
  ownDataOnly: boolean;
  /**
   * When non-null, contacts must be owned by or assigned to one of these user ids.
   * null = business-wide (admin roles).
   */
  visibleUserIds: string[] | null;
  where: Record<string, unknown>;
};

/**
 * Resolve actor role from membership in the *active* customer workspace
 * (same businessId as getUserBusinessId), not the oldest membership row.
 * Falls back to any membership / user.role for single-business and legacy users.
 */
export async function resolveActorRole(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, platformRole: true },
  });
  if (user?.platformRole === "super_admin") return "super_admin";

  // Prefer role on the active workspace (multi-business safe)
  const activeBusinessId = await getUserBusinessId(userId);
  if (activeBusinessId) {
    const activeMem = await prisma.businessMember.findFirst({
      where: { userId, businessId: activeBusinessId },
      select: { role: true },
    });
    if (activeMem?.role) return activeMem.role;
  }

  const mem = await prisma.businessMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true },
  });
  return mem?.role || user?.role || "sales_executive";
}

/**
 * Tenant-only where clause (no role field filters).
 * Safe for Contact, Deal, Task, Meeting, Document — does NOT include `assignedTo`.
 */
export function tenantWhereClause(
  userId: string,
  businessId: string | null
): Record<string, unknown> {
  if (!businessId) return { userId };
  return {
    OR: [{ businessId }, { userId, businessId: null }],
  };
}

/**
 * User ids a Sales Manager may "see" leads for:
 * - themselves
 * - members of teams they own
 * - members of teams where they are admin/manager
 *
 * When no team hierarchy exists, only themselves (leads assigned directly to them).
 */
export async function getManagedTeamUserIds(
  managerUserId: string,
  businessId?: string | null
): Promise<string[]> {
  const ids = new Set<string>([managerUserId]);

  const [asMember, ownedTeams] = await Promise.all([
    prisma.teamMember.findMany({
      where: {
        userId: managerUserId,
        role: { in: ["admin", "manager"] },
      },
      select: { teamId: true },
    }),
    prisma.team.findMany({
      where: { ownerId: managerUserId },
      select: { id: true },
    }),
  ]);

  const teamIds = [
    ...new Set([
      ...asMember.map((m) => m.teamId),
      ...ownedTeams.map((t) => t.id),
    ]),
  ];

  if (teamIds.length) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: { in: teamIds } },
      select: { userId: true },
    });
    for (const m of members) ids.add(m.userId);
  }

  // If business is known, keep only users who are members of the same business
  // (avoid leaking team members from another workspace if shared by mistake)
  if (businessId) {
    const bizMembers = await prisma.businessMember.findMany({
      where: {
        businessId,
        userId: { in: [...ids] },
      },
      select: { userId: true },
    });
    const allowed = new Set(bizMembers.map((b) => b.userId));
    // Always keep the manager themselves
    allowed.add(managerUserId);
    return [...allowed];
  }

  return [...ids];
}

function contactVisibilityWhere(visibleUserIds: string[]): Record<string, unknown> {
  return {
    OR: [
      { userId: { in: visibleUserIds } },
      { assignedTo: { in: visibleUserIds } },
    ],
  };
}

/**
 * Multi-tenant + role data isolation for **Contact** (Lead/Client).
 *
 * - Always restrict to the actor's business (or legacy user-owned rows).
 * - Sales Executive: userId OR assignedTo = actor only.
 * - Sales Manager: actor + team reports (assigned / owned).
 * - Business Admin / CEO / etc.: full business.
 *
 * ⚠️ Do NOT use this where clause on Deal / Task / Meeting / Document —
 * those models have no `assignedTo` field. Use `buildOwnedEntityScope` instead.
 */
export async function buildCrmScope(userId: string): Promise<CrmScope> {
  const businessId = await getUserBusinessId(userId);
  const role = await resolveActorRole(userId);
  const tenant = tenantWhereClause(userId, businessId);

  // Super admin platform ops may still be bound to a customer business via membership
  if (role === "super_admin" && !businessId) {
    return {
      businessId: null,
      role,
      userId,
      ownDataOnly: false,
      visibleUserIds: null,
      where: tenant,
    };
  }

  // Sales Manager / manager — team-scoped (NOT full business).
  // Must run BEFORE any role.includes("admin") checks.
  if (TEAM_SCOPED_ROLES.has(role)) {
    const visibleUserIds = await getManagedTeamUserIds(userId, businessId);
    return {
      businessId,
      role,
      userId,
      ownDataOnly: true,
      visibleUserIds,
      where: {
        AND: [tenant, contactVisibilityWhere(visibleUserIds)],
      },
    };
  }

  // Sales Executive / support executive — self only
  if (OWN_DATA_ONLY_ROLES.has(role)) {
    const visibleUserIds = [userId];
    return {
      businessId,
      role,
      userId,
      ownDataOnly: true,
      visibleUserIds,
      where: {
        AND: [tenant, contactVisibilityWhere(visibleUserIds)],
      },
    };
  }

  // Business-wide (admin, ceo, finance, marketing, …)
  if (
    BUSINESS_WIDE_ROLES.has(role) ||
    role.includes("admin") ||
    role.includes("owner") ||
    role.includes("ceo")
  ) {
    return {
      businessId,
      role,
      userId,
      ownDataOnly: false,
      visibleUserIds: null,
      where: tenant,
    };
  }

  // Fail closed: unknown roles get SE-level isolation (never full workspace)
  const visibleUserIds = [userId];
  return {
    businessId,
    role,
    userId,
    ownDataOnly: true,
    visibleUserIds,
    where: {
      AND: [tenant, contactVisibilityWhere(visibleUserIds)],
    },
  };
}

/**
 * Scope for entities **without** Contact.assignedTo (deals, tasks, meetings, documents).
 * SE / SM: only records they own (userId) or that are linked to contacts they can see
 * is harder without joins — restrict to userId for field staff.
 * Admins: full tenant.
 * Never injects `assignedTo` into Prisma where (that caused Invalid prisma.deal.findFirst).
 */
export async function buildOwnedEntityScope(userId: string): Promise<CrmScope> {
  const businessId = await getUserBusinessId(userId);
  const role = await resolveActorRole(userId);
  const tenant = tenantWhereClause(userId, businessId);

  // Managers + executives: only their own created records (deals/tasks/meetings)
  if (OWN_DATA_ONLY_ROLES.has(role) || TEAM_SCOPED_ROLES.has(role)) {
    return {
      businessId,
      role,
      userId,
      ownDataOnly: true,
      visibleUserIds: [userId],
      where: {
        AND: [tenant, { userId }],
      },
    };
  }

  if (
    BUSINESS_WIDE_ROLES.has(role) ||
    role.includes("admin") ||
    role.includes("owner") ||
    role.includes("ceo")
  ) {
    return {
      businessId,
      role,
      userId,
      ownDataOnly: false,
      visibleUserIds: null,
      where: tenant,
    };
  }

  // Fail closed
  return {
    businessId,
    role,
    userId,
    ownDataOnly: true,
    visibleUserIds: [userId],
    where: {
      AND: [tenant, { userId }],
    },
  };
}

/** Merge tenant/role scope with additional filters (AND composition). */
export function andTenant(
  tenantWhere: Record<string, unknown>,
  extra?: Record<string, unknown> | null
): Record<string, unknown> {
  if (!extra || Object.keys(extra).length === 0) return tenantWhere;
  return { AND: [tenantWhere, extra] };
}

/**
 * Contact-scoped tenant filter (may include assignedTo for SE/SM).
 * Prefer `buildCrmScope` for new code.
 */
export async function buildTenantScope(userId: string) {
  const s = await buildCrmScope(userId);
  return { businessId: s.businessId, where: s.where };
}

/**
 * Non-contact entity tenant filter — never uses assignedTo.
 * Prefer `buildOwnedEntityScope` for new code.
 */
export async function buildOwnedTenantScope(userId: string) {
  const s = await buildOwnedEntityScope(userId);
  return { businessId: s.businessId, where: s.where };
}

export {
  OWN_DATA_ONLY_ROLES,
  TEAM_SCOPED_ROLES,
  BUSINESS_WIDE_ROLES,
};
