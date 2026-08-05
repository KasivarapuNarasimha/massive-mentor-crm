import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";

/** Roles that may only see records they own or are assigned to */
const OWN_DATA_ONLY_ROLES = new Set([
  "sales_executive",
  "support_executive",
]);

/** Roles that see full business CRM data */
const BUSINESS_WIDE_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "sales_manager",
  "manager",
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
  /** True when queries must restrict to this user's records only */
  ownDataOnly: boolean;
  where: Record<string, unknown>;
};

/**
 * Resolve actor role from membership (preferred) or user.role.
 */
export async function resolveActorRole(userId: string): Promise<string> {
  const [user, mem] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, platformRole: true },
    }),
    prisma.businessMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { role: true },
    }),
  ]);
  if (user?.platformRole === "super_admin") return "super_admin";
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
 * Multi-tenant + role data isolation for **Contact** (Lead/Client).
 *
 * - Always restrict to the actor's business (or legacy user-owned rows).
 * - Sales Executive (and similar): further restrict to userId OR assignedTo = actor.
 *
 * ⚠️ Do NOT use this where clause on Deal / Task / Meeting / Document —
 * those models have no `assignedTo` field. Use `buildOwnedEntityScope` instead.
 */
export async function buildCrmScope(userId: string): Promise<CrmScope> {
  const businessId = await getUserBusinessId(userId);
  const role = await resolveActorRole(userId);
  const ownDataOnly = OWN_DATA_ONLY_ROLES.has(role);
  const tenant = tenantWhereClause(userId, businessId);

  let where: Record<string, unknown> = tenant;
  if (ownDataOnly) {
    // Contact only: created by user OR assigned to user
    where = {
      AND: [
        tenant,
        {
          OR: [{ userId }, { assignedTo: userId }],
        },
      ],
    };
  }

  return { businessId, role, userId, ownDataOnly, where };
}

/**
 * Scope for entities **without** Contact.assignedTo (deals, tasks, meetings, documents).
 * SE: only userId match within tenant.
 * Never injects `assignedTo` into Prisma where (that caused Invalid prisma.deal.findFirst).
 */
export async function buildOwnedEntityScope(userId: string): Promise<CrmScope> {
  const businessId = await getUserBusinessId(userId);
  const role = await resolveActorRole(userId);
  const ownDataOnly = OWN_DATA_ONLY_ROLES.has(role);
  const tenant = tenantWhereClause(userId, businessId);

  if (!ownDataOnly) {
    return { businessId, role, userId, ownDataOnly, where: tenant };
  }

  return {
    businessId,
    role,
    userId,
    ownDataOnly,
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
 * Contact-scoped tenant filter (may include assignedTo for SE).
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

export { OWN_DATA_ONLY_ROLES, BUSINESS_WIDE_ROLES };
