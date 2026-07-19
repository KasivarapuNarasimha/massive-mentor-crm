import { prisma } from "@/lib/prisma";
import { getUserBusinessId } from "@/services/field-engine.service";

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
 * Multi-tenant + role data isolation.
 *
 * - Always restrict to the actor's business (or legacy user-owned rows).
 * - Sales Executive (and similar): further restrict to userId OR assignedTo = actor.
 */
export async function buildCrmScope(userId: string): Promise<CrmScope> {
  const businessId = await getUserBusinessId(userId);
  const role = await resolveActorRole(userId);
  const ownDataOnly = OWN_DATA_ONLY_ROLES.has(role);

  let tenant: Record<string, unknown>;
  if (!businessId) {
    tenant = { userId };
  } else {
    tenant = {
      OR: [{ businessId }, { userId, businessId: null }],
    };
  }

  let where: Record<string, unknown> = tenant;
  if (ownDataOnly) {
    // Own records: created by user OR assigned to user (contacts)
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
 * Scope for entities without assignedTo (deals, tasks, meetings, documents).
 * SE: only userId match within tenant.
 */
export async function buildOwnedEntityScope(userId: string): Promise<CrmScope> {
  const base = await buildCrmScope(userId);
  if (!base.ownDataOnly) return base;

  const tenant =
    base.businessId != null
      ? { OR: [{ businessId: base.businessId }, { userId, businessId: null }] }
      : { userId };

  return {
    ...base,
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

/** @deprecated use buildCrmScope — kept for callers still importing buildTenantScope */
export async function buildTenantScope(userId: string) {
  const s = await buildCrmScope(userId);
  return { businessId: s.businessId, where: s.where };
}

export { OWN_DATA_ONLY_ROLES, BUSINESS_WIDE_ROLES };
