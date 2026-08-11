import { prisma } from "../lib/prisma.js";
import { recordAudit } from "./audit.service.js";
import {
  ensureBusinessConfig,
  seedIndustryTemplates,
  provisionTemplateToBusiness,
} from "./template.service.js";
import type { PlatformRole, TenantContext } from "../types/tenant.js";

export type BusinessSummary = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  ownerUserId: string;
  templateId: string | null;
  templateSlug: string | null;
  templateVersion: number | null;
  role: string;
  createdAt: Date;
};

/**
 * Create a new Business for a registering owner and apply industry template fully.
 * Used by registration — applies fields, pipelines, dashboards, portals, AI pack, etc.
 */
export async function createBusinessWithTemplate(opts: {
  ownerUserId: string;
  businessName: string;
  templateSlug: string;
  memberRole?: string;
}): Promise<BusinessSummary> {
  await seedIndustryTemplates();

  const memberRole = opts.memberRole || "business_admin";
  const business = await prisma.business.create({
    data: {
      name: opts.businessName.trim() || "My Business",
      ownerUserId: opts.ownerUserId,
      status: "active",
      templateSlug: opts.templateSlug,
      // Customer portal workspace (demo sets isDemo/portalKind after create)
      portalKind: "customer",
      isDemo: false,
      plan: "trial",
      planStatus: "trial",
      licenseStatus: "trial",
      isTrial: true,
      isLocked: false,
      trialDays: 3,
      trialStartDate: new Date(),
      trialEndsAt: new Date(Date.now() + 3 * 86400000),
      members: {
        create: {
          userId: opts.ownerUserId,
          role: memberRole,
        },
      },
    },
  });

  await backfillUserCrmToBusiness(opts.ownerUserId, business.id);

  await provisionTemplateToBusiness({
    businessId: business.id,
    templateIdOrSlug: opts.templateSlug || "generic",
    installedByUserId: opts.ownerUserId,
    source: "onboarding",
    replaceExisting: true,
  });

  await recordAudit({
    businessId: business.id,
    actorUserId: opts.ownerUserId,
    action: "ensure_business",
    entityType: "business",
    entityId: business.id,
    metadata: {
      name: business.name,
      templateSlug: opts.templateSlug,
      source: "createBusinessWithTemplate",
    },
  });

  const refreshed = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  return toSummary(refreshed, memberRole);
}

/**
 * Non-demo customer workspace filter.
 * CRITICAL: do NOT require portalKind === "customer" only — legacy rows may have
 * null/empty portalKind. Excluding them caused login/me to spawn a NEW Trial
 * workspace after password reset (same user, empty "Acme"/generic shell).
 */
export function customerWorkspaceWhere() {
  return {
    isDemo: false as const,
    status: { not: "deleted" as const },
    NOT: { portalKind: "demo" },
  };
}

/**
 * Pick the best existing customer workspace for a user.
 * Prefer: most active contacts → paid/non-trial plan → oldest membership/ownership.
 * Never creates a business.
 */
export async function resolveExistingCustomerBusiness(
  userId: string
): Promise<{ businessId: string; role: string; source: "member" | "owner" } | null> {
  const members = await prisma.businessMember.findMany({
    where: {
      userId,
      business: customerWorkspaceWhere(),
    },
    select: {
      businessId: true,
      role: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          plan: true,
          isTrial: true,
          planStatus: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (members.length > 0) {
    const scored = await Promise.all(
      members.map(async (m) => {
        const n = await prisma.contact.count({
          where: { businessId: m.businessId, deletedAt: null },
        });
        const plan = String(m.business.plan || "").toLowerCase();
        const paid =
          plan &&
          plan !== "trial" &&
          (m.business.planStatus === "active" ||
            m.business.planStatus === "past_due" ||
            m.business.isTrial === false)
            ? 1
            : 0;
        return {
          businessId: m.businessId,
          role: m.role,
          n,
          paid,
          createdAt: m.createdAt.getTime(),
        };
      })
    );
    scored.sort((a, b) => b.n - a.n || b.paid - a.paid || a.createdAt - b.createdAt);
    const best = scored[0];
    if (best) {
      return { businessId: best.businessId, role: best.role, source: "member" };
    }
  }

  // Owner without membership (or membership filtered out) — NEVER create a second workspace
  const owned = await prisma.business.findMany({
    where: {
      ownerUserId: userId,
      ...customerWorkspaceWhere(),
    },
    select: {
      id: true,
      plan: true,
      isTrial: true,
      planStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (owned.length === 0) return null;

  const scoredOwned = await Promise.all(
    owned.map(async (b) => {
      const n = await prisma.contact.count({
        where: { businessId: b.id, deletedAt: null },
      });
      const plan = String(b.plan || "").toLowerCase();
      const paid =
        plan &&
        plan !== "trial" &&
        (b.planStatus === "active" || b.planStatus === "past_due" || b.isTrial === false)
          ? 1
          : 0;
      return { businessId: b.id, n, paid, createdAt: b.createdAt.getTime() };
    })
  );
  scoredOwned.sort((a, b) => b.n - a.n || b.paid - a.paid || a.createdAt - b.createdAt);
  const bestOwned = scoredOwned[0];
  if (!bestOwned) return null;

  // Repair missing membership so future logins resolve via member path
  await prisma.businessMember.upsert({
    where: {
      businessId_userId: { businessId: bestOwned.businessId, userId },
    },
    create: {
      businessId: bestOwned.businessId,
      userId,
      role: "owner",
    },
    update: {},
  });

  console.info(
    `[business] repaired owner membership userId=${userId} businessId=${bestOwned.businessId}`
  );

  return { businessId: bestOwned.businessId, role: "owner", source: "owner" };
}

/**
 * Ensure the user has a default Business + membership.
 * Backfills businessId on their CRM rows (dual-scope migration).
 * Idempotent — safe on every login /me.
 *
 * MUST NOT create a new Trial workspace when the user already has any
 * non-demo, non-deleted customer business (member or owner). Password reset
 * only changes password; re-login must bind the SAME workspace.
 */
export async function ensureDefaultBusiness(userId: string): Promise<BusinessSummary> {
  const existing = await resolveExistingCustomerBusiness(userId);

  if (existing) {
    await backfillUserCrmToBusiness(userId, existing.businessId);
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: existing.businessId } });
    try {
      await ensureBusinessConfig(biz.id, userId, biz.templateSlug);
    } catch (err) {
      console.error(
        "[business] ensureBusinessConfig (existing) failed:",
        err instanceof Error ? err.message : err
      );
    }
    return toSummary(biz, existing.role);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

  // Last resort: truly no workspace. Do not run this path for password-reset users
  // who already own a business (handled above).
  console.warn(
    `[business] ensureDefaultBusiness CREATING new workspace for userId=${userId} email=${user.email} — no existing customer member/owner found`
  );

  const businessName =
    user.profile?.businessName?.trim() ||
    (user.name ? `${user.name}'s Business` : "My Business");

  // templateSlug reserved for Phase 2 — store free-text industry as slug hint only if present
  const industryHint = user.profile?.industry?.trim() || null;

  const business = await prisma.business.create({
    data: {
      name: businessName,
      ownerUserId: userId,
      status: "active",
      portalKind: "customer",
      isDemo: false,
      templateSlug: industryHint ? industryHint.toLowerCase().replace(/\s+/g, "_") : null,
      members: {
        create: {
          userId,
          role: "owner",
        },
      },
    },
  });

  await backfillUserCrmToBusiness(userId, business.id);

  // Phase 2: attach industry template config (generic unless known slug)
  try {
    await seedIndustryTemplates();
    let preferredSlug = "generic";
    if (industryHint) {
      const preferred = await prisma.industryTemplate.findFirst({
        where: {
          OR: [
            { slug: industryHint.toLowerCase().replace(/\s+/g, "_") },
            { name: { equals: industryHint, mode: "insensitive" } },
          ],
          isPublished: true,
        },
        select: { slug: true },
      });
      if (preferred?.slug) preferredSlug = preferred.slug;
    }
    await ensureBusinessConfig(business.id, userId, preferredSlug);
  } catch (err) {
    console.error("[business] ensureBusinessConfig failed:", err instanceof Error ? err.message : err);
  }

  await recordAudit({
    businessId: business.id,
    actorUserId: userId,
    action: "ensure_business",
    entityType: "business",
    entityId: business.id,
    metadata: { name: business.name, source: "ensureDefaultBusiness" },
  });

  const refreshed = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  return toSummary(refreshed, "owner");
}

/**
 * Backfill CRM rows owned by userId that still lack businessId.
 * Keeps existing userId filters working (backward compatible).
 */
export async function backfillUserCrmToBusiness(userId: string, businessId: string): Promise<void> {
  await Promise.all([
    prisma.contact.updateMany({
      where: { userId, businessId: null },
      data: { businessId },
    }),
    prisma.deal.updateMany({
      where: { userId, businessId: null },
      data: { businessId },
    }),
    prisma.task.updateMany({
      where: { userId, businessId: null },
      data: { businessId },
    }),
    prisma.meeting.updateMany({
      where: { userId, businessId: null },
      data: { businessId },
    }),
  ]);
}

export async function getCurrentBusinessForUser(userId: string): Promise<BusinessSummary | null> {
  const member = await prisma.businessMember.findFirst({
    where: { userId },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });
  if (!member?.business) return null;
  return toSummary(member.business, member.role);
}

/**
 * Build TenantContext for the user's primary (first) business.
 * Ensures default business exists.
 */
export async function resolveTenantContext(userId: string): Promise<TenantContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, platformRole: true },
  });
  if (!user) throw new Error("User not found");

  const business = await ensureDefaultBusiness(userId);
  const member = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: { businessId: business.id, userId },
    },
  });

  const permissions = permissionsForRole(member?.role || business.role);

  return {
    userId,
    businessId: business.id,
    businessRole: member?.role || business.role,
    permissions,
    platformRole: (user.platformRole as PlatformRole) || "user",
    businessName: business.name,
  };
}

/**
 * Default permission sets — later replaced by BusinessConfig.roles (metadata-driven).
 * Keys are generic permission strings, not industry-specific.
 */
function permissionsForRole(role: string): string[] {
  const all = [
    "contacts.read",
    "contacts.write",
    "deals.read",
    "deals.write",
    "tasks.read",
    "tasks.write",
    "reports.read",
    "reports.export",
    "reports.import",
    "ai.use",
    "config.edit",
    "members.manage",
    "audit.read",
  ];
  switch (role) {
    case "owner":
    case "admin":
      return all;
    case "manager":
      return all.filter((p) => p !== "members.manage");
    default:
      return [
        "contacts.read",
        "contacts.write",
        "deals.read",
        "deals.write",
        "tasks.read",
        "tasks.write",
        "reports.read",
        "ai.use",
      ];
  }
}

function toSummary(
  business: {
    id: string;
    name: string;
    slug: string | null;
    status: string;
    ownerUserId: string;
    templateId: string | null;
    templateSlug: string | null;
    templateVersion: number | null;
    createdAt: Date;
  },
  role: string
): BusinessSummary {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    status: business.status,
    ownerUserId: business.ownerUserId,
    templateId: business.templateId,
    templateSlug: business.templateSlug,
    templateVersion: business.templateVersion,
    role,
    createdAt: business.createdAt,
  };
}
