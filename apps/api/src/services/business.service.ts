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
 * Ensure the user has a default Business + membership.
 * Backfills businessId on their CRM rows (dual-scope migration).
 * Idempotent — safe on every login /me.
 */
export async function ensureDefaultBusiness(userId: string): Promise<BusinessSummary> {
  // Prefer real customer workspace — never bind customer CRM to demo tenant
  const existingMember = await prisma.businessMember.findFirst({
    where: {
      userId,
      business: {
        isDemo: false,
        portalKind: "customer",
        status: { not: "deleted" },
      },
    },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });

  if (existingMember?.business) {
    await backfillUserCrmToBusiness(userId, existingMember.businessId);
    // Ensure Phase 2 config exists for legacy businesses
    try {
      await ensureBusinessConfig(existingMember.businessId, userId, existingMember.business.templateSlug);
    } catch (err) {
      console.error("[business] ensureBusinessConfig (existing) failed:", err instanceof Error ? err.message : err);
    }
    const biz = await prisma.business.findUniqueOrThrow({ where: { id: existingMember.businessId } });
    return toSummary(biz, existingMember.role);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new Error("User not found");
  }

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
