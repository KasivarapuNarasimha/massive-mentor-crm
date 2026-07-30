import { prisma } from "../lib/prisma.js";
import { recordAudit } from "./audit.service.js";
import { createBusinessWithTemplate } from "./business.service.js";
import {
  resolveOrCreateCustomerOwner,
  userHasActiveCustomerBusiness,
} from "./customer-owner.service.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { toMoneyNumber } from "../lib/money.js";

const PLANS = ["trial", "basic", "professional", "enterprise"] as const;
export type PlanKey = (typeof PLANS)[number];

function assertPlan(plan: string): PlanKey {
  if (!PLANS.includes(plan as PlanKey)) {
    throw new Error(`Invalid plan. Use: ${PLANS.join(", ")}`);
  }
  return plan as PlanKey;
}

/** List all customer businesses (never demo). Super Admin only. */
export async function listBusinesses(opts: {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize || 20));
  const where: Record<string, unknown> = {
    isDemo: false,
    portalKind: "customer",
    status: { not: "deleted" },
  };
  if (opts.status) where.status = opts.status;
  if (opts.plan) where.plan = opts.plan;
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { billingEmail: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { owner: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.business.count({ where: where as never }),
    prisma.business.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { id: true, email: true, name: true } },
        _count: { select: { members: true, contacts: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    businesses: rows.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      status: b.status,
      plan: b.plan,
      planStatus: b.planStatus,
      licenseStatus: b.licenseStatus,
      trialEndsAt: b.trialEndsAt,
      subscriptionEndsAt: b.subscriptionEndsAt,
      setupFeePaid: b.setupFeePaid,
      billingEmail: b.billingEmail,
      templateSlug: b.templateSlug,
      whiteLabel: b.whiteLabel,
      usageSnapshot: b.usageSnapshot,
      suspendedAt: b.suspendedAt,
      suspendedReason: b.suspendedReason,
      createdAt: b.createdAt,
      owner: b.owner,
      memberCount: b._count.members,
      contactCount: b._count.contacts,
    })),
  };
}

export async function getBusinessDetail(businessId: string) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
    include: {
      owner: { select: { id: true, email: true, name: true, isDisabled: true } },
      members: {
        include: {
          user: {
            select: { id: true, email: true, name: true, isDisabled: true, role: true, createdAt: true },
          },
        },
      },
      _count: { select: { contacts: true, deals: true, tasks: true, meetings: true } },
      platformInvoices: { orderBy: { createdAt: "desc" }, take: 20 },
      subscriptionEvents: { orderBy: { createdAt: "desc" }, take: 20 },
      supportTickets: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!b) throw new Error("Business not found");

  const [leads, clients, revenueAgg, usage] = await Promise.all([
    prisma.contact.count({ where: { businessId, type: "lead" } }),
    prisma.contact.count({ where: { businessId, type: "client" } }),
    prisma.deal.aggregate({
      where: { businessId, stage: "closed_won" },
      _sum: { value: true },
    }),
    refreshUsageSnapshot(businessId),
  ]);

  const profile = await prisma.businessProfile.findFirst({
    where: { userId: b.ownerUserId },
  }).catch(() => null);

  const trialDaysLeft =
    b.trialEndsAt != null
      ? Math.max(0, Math.ceil((new Date(b.trialEndsAt).getTime() - Date.now()) / 86400000))
      : null;

  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    status: b.status,
    plan: b.plan,
    planStatus: b.planStatus,
    isTrial: b.isTrial,
    isLocked: b.isLocked,
    licenseKey: b.licenseKey,
    licenseStatus: b.licenseStatus,
    trialEndsAt: b.trialEndsAt,
    subscriptionEndsAt: b.subscriptionEndsAt,
    trialDaysLeft: b.isTrial ? trialDaysLeft : null,
    setupFeePaid: b.setupFeePaid,
    billingEmail: b.billingEmail,
    templateSlug: b.templateSlug,
    whiteLabel: b.whiteLabel,
    suspendedAt: b.suspendedAt,
    suspendedReason: b.suspendedReason,
    createdAt: b.createdAt,
    owner: b.owner,
    industry: profile?.industry || b.templateSlug || "—",
    phone: (profile as { location?: string } | null)?.location || null,
    members: b.members.map((m) => ({
      membershipId: m.id,
      role: m.role,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      isDisabled: m.user.isDisabled,
      createdAt: m.user.createdAt,
    })),
    stats: {
      leads,
      clients,
      deals: b._count.deals,
      meetings: b._count.meetings,
      tasks: b._count.tasks,
      revenue: revenueAgg._sum.value || 0,
      users: b.members.length,
      aiUsage: (usage as { aiUsage?: number }).aiUsage || 0,
      whatsapp: (usage as { whatsapp?: number }).whatsapp || 0,
      emailUsage: 0,
      apiUsage: 0,
      financeRecords: (usage as { financeRecords?: number }).financeRecords || 0,
    },
    usage,
    platformInvoices: b.platformInvoices,
    subscriptionEvents: b.subscriptionEvents,
    supportTickets: b.supportTickets,
  };
}

export async function createCustomerBusiness(input: {
  actorUserId: string;
  businessName: string;
  ownerEmail: string;
  ownerName?: string;
  ownerPassword: string;
  templateSlug: string;
  industryLabel?: string;
  plan?: string;
}) {
  const plan = assertPlan(input.plan || "trial");
  const email = input.ownerEmail.toLowerCase().trim();
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 14);

  const { resolveIndustryTemplate } = await import("./industry-template-resolve.service.js");
  const resolved = await resolveIndustryTemplate({
    templateSlug: input.templateSlug,
    industryLabel: input.industryLabel,
  });

  // Shared with public registration — soft-deleted owners are reused
  const owner = await resolveOrCreateCustomerOwner({
    email,
    password: input.ownerPassword,
    name: input.ownerName,
    businessName: input.businessName.trim(),
    industryLabel: resolved.industryLabel,
  });
  const userId = owner.userId;
  const reusedUser = owner.reusedUser;

  const business = await createBusinessWithTemplate({
    ownerUserId: userId,
    businessName: input.businessName.trim(),
    templateSlug: resolved.templateSlug,
    memberRole: "business_admin",
  });

  await prisma.businessProfile.upsert({
    where: { userId },
    create: {
      userId,
      businessName: input.businessName.trim(),
      industry: resolved.industryLabel,
      description: "",
    },
    update: {
      industry: resolved.industryLabel,
      businessName: input.businessName.trim(),
    },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: {
      portalKind: "customer",
      isDemo: false,
      plan,
      planStatus: plan === "trial" ? "trial" : "active",
      isTrial: plan === "trial",
      isLocked: false,
      trialEndsAt: plan === "trial" ? trialEnds : null,
      trialStartDate: plan === "trial" ? new Date() : null,
      subscriptionEndsAt:
        plan === "trial"
          ? null
          : (() => {
              const d = new Date();
              d.setDate(d.getDate() + 30);
              return d;
            })(),
      licenseStatus: plan === "trial" ? "trial" : "active",
      licenseKey: `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
      billingEmail: email,
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
    },
  });

  await prisma.subscriptionEvent.create({
    data: {
      businessId: business.id,
      actorUserId: input.actorUserId,
      action: "activate",
      toPlan: plan,
      metadata: { source: "super_admin_create", reusedOwnerUser: reusedUser },
    },
  });

  await recordAudit({
    businessId: business.id,
    actorUserId: input.actorUserId,
    action: "platform_create_business",
    entityType: "business",
    entityId: business.id,
    metadata: { ownerEmail: email, plan, reusedOwnerUser: reusedUser },
  });

  return getBusinessDetail(business.id);
}

export async function setBusinessStatus(
  actorUserId: string,
  businessId: string,
  status: "active" | "suspended",
  reason?: string
) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      status,
      planStatus: status === "suspended" ? "suspended" : b.planStatus === "suspended" ? "active" : b.planStatus,
      suspendedAt: status === "suspended" ? new Date() : null,
      suspendedReason: status === "suspended" ? reason || "Suspended by Super Admin" : null,
    },
  });

  await recordAudit({
    businessId,
    actorUserId,
    action: status === "suspended" ? "platform_suspend_business" : "platform_activate_business",
    entityType: "business",
    entityId: businessId,
    metadata: { reason, previousStatus: b.status },
  });

  return updated;
}

/**
 * Soft-delete: Business.status = "deleted" (row kept for audit / optional restore).
 * User accounts are NOT hard-deleted (email stays unique) — members with no other
 * active customer workspace are disabled so the email can be reused safely.
 */
export async function softDeleteBusiness(actorUserId: string, businessId: string) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");
  if (b.status === "deleted") {
    return { ok: true, alreadyDeleted: true };
  }

  await prisma.business.update({
    where: { id: businessId },
    data: {
      status: "deleted",
      planStatus: "cancelled",
      suspendedAt: new Date(),
      suspendedReason: "Deleted by Super Admin",
    },
  });

  // Collect users tied to this business (members + owner)
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    select: { userId: true },
  });
  const userIds = new Set<string>(members.map((m) => m.userId));
  userIds.add(b.ownerUserId);

  let disabledUsers = 0;
  for (const userId of userIds) {
    const stillActive = await userHasActiveCustomerBusiness(userId);
    if (!stillActive) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          isDisabled: true,
          // Invalidate JWT sessions for the deleted workspace
          tokenVersion: { increment: 1 },
        },
      });
      disabledUsers += 1;
    }
  }

  await recordAudit({
    businessId,
    actorUserId,
    action: "platform_delete_business",
    entityType: "business",
    entityId: businessId,
    metadata: { name: b.name, softDelete: true, disabledUsers },
  });

  return { ok: true, softDelete: true, disabledUsers };
}

/** Restore a soft-deleted customer business and re-enable the owner if needed. */
export async function restoreBusiness(actorUserId: string, businessId: string) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");
  if (b.status !== "deleted") {
    throw new Error("Business is not deleted");
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      status: "active",
      planStatus: b.planStatus === "cancelled" ? "active" : b.planStatus,
      suspendedAt: null,
      suspendedReason: null,
    },
  });

  // Ensure owner can log in again
  await prisma.user.update({
    where: { id: b.ownerUserId },
    data: { isDisabled: false },
  });

  // Re-enable other members of this business
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    select: { userId: true },
  });
  for (const m of members) {
    await prisma.user.update({
      where: { id: m.userId },
      data: { isDisabled: false },
    });
  }

  await recordAudit({
    businessId,
    actorUserId,
    action: "platform_restore_business",
    entityType: "business",
    entityId: businessId,
    metadata: { name: b.name },
  });

  return updated;
}

export type SubscriptionManageAction =
  | "activate"
  | "upgrade"
  | "downgrade"
  | "renew"
  | "extend_trial"
  | "cancel"
  | "activate_license"
  | "suspend_license";

/**
 * Super Admin subscription lifecycle.
 * CRITICAL: paid plans must clear isTrial + isLocked or CRM keeps showing trial UI.
 */
export async function changePlan(
  actorUserId: string,
  businessId: string,
  action: SubscriptionManageAction,
  toPlan: string,
  days?: number,
  opts?: { reason?: string; paymentId?: string }
) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");

  const periodDays = Math.max(1, Math.min(3650, days || 30));
  const now = new Date();
  const ends = new Date(now);
  ends.setDate(ends.getDate() + periodDays);

  const fromPlan = b.plan;
  const fromStatus = b.planStatus;
  const fromLicense = b.licenseStatus;
  const reason = (opts?.reason || "").trim() || undefined;

  // Resolve target plan for plan-change actions
  let plan = b.plan as PlanKey;
  if (
    action === "activate" ||
    action === "upgrade" ||
    action === "downgrade" ||
    action === "renew"
  ) {
    plan = assertPlan(toPlan || b.plan);
  } else if (action === "extend_trial") {
    plan = "trial";
  }

  const paid = plan !== "trial" && action !== "extend_trial" && action !== "cancel";

  let data: Record<string, unknown> = {};

  if (action === "extend_trial") {
    const base =
      b.trialEndsAt && new Date(b.trialEndsAt).getTime() > now.getTime()
        ? new Date(b.trialEndsAt)
        : now;
    const trialEnd = new Date(base);
    trialEnd.setDate(trialEnd.getDate() + periodDays);
    data = {
      plan: "trial",
      planStatus: "trial",
      isTrial: true,
      isLocked: false,
      status: "active",
      licenseStatus: "trial",
      trialEndsAt: trialEnd,
      trialStartDate: b.trialStartDate || now,
      trialDays: Math.max(b.trialDays || 0, periodDays),
      suspendedAt: null,
      suspendedReason: null,
    };
  } else if (action === "cancel") {
    data = {
      planStatus: "cancelled",
      isLocked: false,
      // Keep plan code for history; end subscription now
      subscriptionEndsAt: now,
      licenseStatus: "expired",
      isTrial: false,
      status: "active",
    };
  } else if (action === "activate_license") {
    if (plan !== "trial") {
      data = {
        plan,
        planStatus: "active",
        isTrial: false,
        isLocked: false,
        status: "active",
        licenseStatus: "active",
        licenseKey: b.licenseKey || `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
        subscriptionEndsAt:
          b.subscriptionEndsAt && new Date(b.subscriptionEndsAt) > now
            ? b.subscriptionEndsAt
            : ends,
        suspendedAt: null,
        suspendedReason: null,
      };
    } else {
      data = {
        licenseStatus: "active",
        licenseKey: b.licenseKey || `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
        isLocked: false,
        status: "active",
        planStatus:
          b.planStatus === "cancelled" || b.planStatus === "expired" ? "active" : b.planStatus,
        isTrial: true,
      };
    }
  } else if (action === "suspend_license") {
    data = {
      licenseStatus: "expired",
      planStatus: "suspended",
      status: "suspended",
      isLocked: true,
      isTrial: false,
      suspendedAt: now,
      suspendedReason: reason || "License suspended by Super Admin",
    };
  } else {
    // activate | upgrade | downgrade | renew
    if (paid) {
      // Renew extends from current end if still in future
      let subEnd = ends;
      if (
        action === "renew" &&
        b.subscriptionEndsAt &&
        new Date(b.subscriptionEndsAt).getTime() > now.getTime()
      ) {
        subEnd = new Date(b.subscriptionEndsAt);
        subEnd.setDate(subEnd.getDate() + periodDays);
      }
      data = {
        plan,
        planStatus: "active",
        status: "active",
        // Root cause fix: leave trial mode completely
        isTrial: false,
        isLocked: false,
        licenseStatus: "active",
        licenseKey: b.licenseKey || `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
        subscriptionEndsAt: subEnd,
        // Keep historical trial dates but stop treating business as trial
        trialEndsAt: b.trialEndsAt,
        suspendedAt: null,
        suspendedReason: null,
      };
    } else {
      // Switch to trial plan
      data = {
        plan: "trial",
        planStatus: "trial",
        isTrial: true,
        isLocked: false,
        status: "active",
        licenseStatus: "trial",
        trialEndsAt: ends,
        trialStartDate: now,
        trialDays: periodDays,
        subscriptionEndsAt: null,
        suspendedAt: null,
        suspendedReason: null,
      };
    }
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: data as never,
  });

  // Keep Subscription row in sync for paid activations
  if (paid && (action === "activate" || action === "upgrade" || action === "downgrade" || action === "renew")) {
    try {
      await prisma.subscription.updateMany({
        where: { businessId, status: "active" },
        data: { status: "cancelled" },
      });
      await prisma.subscription.create({
        data: {
          businessId,
          status: "active",
          startDate: now,
          endDate: (data.subscriptionEndsAt as Date) || ends,
          renewalDate: (data.subscriptionEndsAt as Date) || ends,
          createdById: actorUserId,
          notes: `Super Admin ${action}: ${fromPlan} → ${plan}`,
          paymentId: opts?.paymentId || null,
        },
      });
    } catch (e) {
      console.warn(
        "[platform] subscription row sync skipped:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const eventAction =
    action === "extend_trial"
      ? "trial_extend"
      : action === "activate_license"
        ? "activate"
        : action === "suspend_license"
          ? "cancel"
          : action === "cancel"
            ? "cancel"
            : action;

  await prisma.subscriptionEvent.create({
    data: {
      businessId,
      actorUserId,
      action: eventAction,
      fromPlan,
      toPlan: String(data.plan ?? plan),
      metadata: {
        action,
        reason: reason || null,
        changedBy: "super_admin",
        actorUserId,
        paymentId: opts?.paymentId || null,
        previousPlan: fromPlan,
        newPlan: String(data.plan ?? plan),
        previousPlanStatus: fromStatus,
        newPlanStatus: updated.planStatus,
        previousLicenseStatus: fromLicense,
        licenseStatus: updated.licenseStatus,
        expiryDate: updated.subscriptionEndsAt || updated.trialEndsAt || null,
        days: periodDays,
        isTrial: updated.isTrial,
        isLocked: updated.isLocked,
      },
    },
  });

  await recordAudit({
    businessId,
    actorUserId,
    action: `platform_plan_${action}`,
    entityType: "business",
    entityId: businessId,
    metadata: {
      fromPlan,
      toPlan: String(data.plan ?? plan),
      reason: reason || null,
      licenseStatus: updated.licenseStatus,
      planStatus: updated.planStatus,
      isTrial: updated.isTrial,
      subscriptionEndsAt: updated.subscriptionEndsAt,
    },
  });

  console.log(
    `[platform] changePlan businessId=${businessId} action=${action} ${fromPlan}→${String(data.plan ?? plan)} isTrial=${updated.isTrial} planStatus=${updated.planStatus} license=${updated.licenseStatus}`
  );

  return updated;
}

/** Full subscription history for Super Admin audit UI */
export async function getSubscriptionHistory(businessId: string, limit = 100) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
    select: { id: true },
  });
  if (!b) throw new Error("Business not found");

  const events = await prisma.subscriptionEvent.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
  });

  const actorIds = [
    ...new Set(events.map((e) => e.actorUserId).filter(Boolean) as string[]),
  ];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true, name: true, platformRole: true },
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  return events.map((e) => {
    const meta = (e.metadata || {}) as Record<string, unknown>;
    const actor = e.actorUserId ? actorMap.get(e.actorUserId) : null;
    const changedByRole =
      meta.changedBy === "customer"
        ? "Customer"
        : actor?.platformRole === "super_admin"
          ? "Super Admin"
          : meta.changedBy === "super_admin"
            ? "Super Admin"
            : e.actorUserId
              ? "User"
              : "System";
    return {
      id: e.id,
      action: e.action,
      previousPlan: e.fromPlan || meta.previousPlan || null,
      newPlan: e.toPlan || meta.newPlan || null,
      changedBy: changedByRole,
      changedByEmail: actor?.email || null,
      changedByName: actor?.name || null,
      paymentId: meta.paymentId || meta.razorpayPaymentId || null,
      date: e.createdAt,
      reason: meta.reason || null,
      licenseStatus: meta.licenseStatus || null,
      expiryDate: meta.expiryDate || null,
      metadata: meta,
    };
  });
}

export async function updateWhiteLabel(
  actorUserId: string,
  businessId: string,
  whiteLabel: Record<string, unknown>
) {
  const b = await prisma.business.findFirst({
    where: { id: businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: { whiteLabel: whiteLabel as object },
  });

  await recordAudit({
    businessId,
    actorUserId,
    action: "platform_white_label_update",
    entityType: "business",
    entityId: businessId,
    metadata: { keys: Object.keys(whiteLabel) },
  });

  return updated;
}

export async function createPlatformInvoice(input: {
  actorUserId: string;
  businessId: string;
  kind: string;
  amount: number;
  plan?: string;
  notes?: string;
}) {
  const b = await prisma.business.findFirst({
    where: { id: input.businessId, isDemo: false },
  });
  if (!b) throw new Error("Business not found");

  const number = `PI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const inv = await prisma.platformInvoice.create({
    data: {
      businessId: input.businessId,
      number,
      kind: input.kind,
      amount: input.amount,
      plan: input.plan || b.plan,
      notes: input.notes || null,
      status: "open",
    },
  });

  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    action: "platform_invoice_create",
    entityType: "platform_invoice",
    entityId: inv.id,
    metadata: { amount: input.amount, kind: input.kind },
  });

  return inv;
}

export async function markInvoicePaid(actorUserId: string, invoiceId: string) {
  const inv = await prisma.platformInvoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new Error("Invoice not found");

  const updated = await prisma.platformInvoice.update({
    where: { id: invoiceId },
    data: { status: "paid", paidAt: new Date() },
  });

  if (inv.kind === "setup") {
    await prisma.business.update({
      where: { id: inv.businessId },
      data: { setupFeePaid: true },
    });
  }

  await recordAudit({
    businessId: inv.businessId,
    actorUserId,
    action: "platform_invoice_paid",
    entityType: "platform_invoice",
    entityId: invoiceId,
  });

  return updated;
}

export async function listInvoices(businessId?: string) {
  return prisma.platformInvoice.findMany({
    where: businessId ? { businessId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { business: { select: { id: true, name: true } } },
  });
}

export async function listLicenses(filter?: "active" | "expired" | "trial") {
  const where: Record<string, unknown> = { isDemo: false, portalKind: "customer", status: { not: "deleted" } };
  if (filter === "trial") where.licenseStatus = "trial";
  if (filter === "active") where.licenseStatus = "active";
  if (filter === "expired") where.licenseStatus = "expired";

  return prisma.business.findMany({
    where: where as never,
    select: {
      id: true,
      name: true,
      plan: true,
      licenseKey: true,
      licenseStatus: true,
      trialEndsAt: true,
      subscriptionEndsAt: true,
      status: true,
    },
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function refreshUsageSnapshot(businessId: string) {
  const [users, leads, invoices] = await Promise.all([
    prisma.businessMember.count({ where: { businessId } }),
    prisma.contact.count({ where: { businessId, type: "lead" } }),
    prisma.invoice.count({ where: { businessId } }).catch(() => 0),
  ]);

  // AI + WhatsApp usage via members / business scope
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    select: { userId: true },
  });
  const userIds = members.map((m) => m.userId);
  const aiUsage =
    userIds.length === 0
      ? 0
      : await prisma.aiGeneration.count({ where: { userId: { in: userIds } } }).catch(() => 0);
  const wa = await prisma.whatsAppMessage.count({ where: { businessId } }).catch(() => 0);

  const snapshot = {
    users,
    leads,
    aiUsage,
    whatsapp: wa,
    financeRecords: invoices,
    updatedAt: new Date().toISOString(),
  };

  await prisma.business.update({
    where: { id: businessId },
    data: { usageSnapshot: snapshot },
  });

  return snapshot;
}

export async function platformAnalytics() {
  const [businesses, active, suspended, trials, byPlan] = await Promise.all([
    prisma.business.count({ where: { isDemo: false, portalKind: "customer", status: { not: "deleted" } } }),
    prisma.business.count({ where: { isDemo: false, status: "active", portalKind: "customer" } }),
    prisma.business.count({ where: { isDemo: false, status: "suspended", portalKind: "customer" } }),
    prisma.business.count({ where: { isDemo: false, plan: "trial", portalKind: "customer", status: { not: "deleted" } } }),
    prisma.business.groupBy({
      by: ["plan"],
      where: { isDemo: false, portalKind: "customer", status: { not: "deleted" } },
      _count: true,
    }),
  ]);

  const openTickets = await prisma.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } });
  const unpaid = await prisma.platformInvoice.count({ where: { status: { in: ["open", "overdue"] } } });

  return {
    businesses,
    active,
    suspended,
    trials,
    openTickets,
    unpaidInvoices: unpaid,
    byPlan: Object.fromEntries(byPlan.map((p) => [p.plan, p._count])),
  };
}

export async function createSupportTicket(input: {
  actorUserId: string;
  businessId?: string;
  subject: string;
  body: string;
  priority?: string;
}) {
  const ticket = await prisma.supportTicket.create({
    data: {
      businessId: input.businessId || null,
      subject: input.subject,
      body: input.body,
      priority: input.priority || "normal",
      createdByUserId: input.actorUserId,
    },
  });
  await recordAudit({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    action: "platform_ticket_create",
    entityType: "support_ticket",
    entityId: ticket.id,
  });
  return ticket;
}

export async function listSupportTickets(status?: string) {
  return prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { business: { select: { id: true, name: true } } },
  });
}

export async function updateTicketStatus(actorUserId: string, ticketId: string, status: string) {
  const t = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status },
  });
  await recordAudit({
    businessId: t.businessId,
    actorUserId,
    action: "platform_ticket_update",
    entityType: "support_ticket",
    entityId: ticketId,
    metadata: { status },
  });
  return t;
}

/**
 * Support mode: issue a short-lived customer-portal token for a business owner.
 * Fully audited — never silent.
 */
export async function supportImpersonate(input: {
  actorUserId: string;
  businessId: string;
  reason: string;
}) {
  if (!input.reason?.trim()) throw new Error("Support reason is required for audit");

  const b = await prisma.business.findFirst({
    where: { id: input.businessId, isDemo: false, portalKind: "customer" },
    include: { owner: true },
  });
  if (!b) throw new Error("Business not found");
  if (b.status === "deleted") throw new Error("Business is deleted");

  await recordAudit({
    businessId: b.id,
    actorUserId: input.actorUserId,
    action: "platform_support_impersonate",
    entityType: "business",
    entityId: b.id,
    metadata: {
      reason: input.reason.trim(),
      targetUserId: b.ownerUserId,
      targetEmail: b.owner.email,
      supportMode: true,
    },
  });

  return {
    targetUserId: b.ownerUserId,
    targetEmail: b.owner.email,
    businessId: b.id,
    businessName: b.name,
    reason: input.reason.trim(),
  };
}

export async function systemHealth() {
  const started = Date.now();
  let dbOk = false;
  let dbMs = 0;
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbMs = Date.now() - t0;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const mem = process.memoryUsage();
  const heapPct = mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;
  const rssMb = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);

  const [activeBusinesses, openTickets, recentLogins] = await Promise.all([
    prisma.business.count({ where: { isDemo: false, portalKind: "customer", status: "active" } }),
    prisma.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } }),
    prisma.auditLog.count({
      where: {
        action: { in: ["login", "platform_login", "demo_login"] },
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
    }),
  ]);

  const apiStatus: "healthy" | "warning" | "critical" = "healthy";
  const dbStatus: "healthy" | "warning" | "critical" = !dbOk
    ? "critical"
    : dbMs > 200
      ? "warning"
      : "healthy";
  const ramStatus: "healthy" | "warning" | "critical" =
    heapPct >= 90 ? "critical" : heapPct >= 75 ? "warning" : "healthy";

  return {
    cards: {
      api: {
        label: "API Status",
        status: apiStatus,
        value: "Online",
        detail: `Uptime ${Math.floor(process.uptime())}s · ${Date.now() - started}ms`,
      },
      database: {
        label: "Database Status",
        status: dbStatus,
        value: dbOk ? "Connected" : "Error",
        detail: dbOk ? `${dbMs}ms latency` : "Unreachable",
      },
      cpu: {
        label: "CPU Usage",
        status: "healthy" as const,
        value: "N/A",
        detail: "Process metrics (Node heap proxy)",
      },
      ram: {
        label: "RAM Usage",
        status: ramStatus,
        value: `${heapUsedMb} MB`,
        detail: `RSS ${rssMb} MB · heap ${heapPct}%`,
        percent: heapPct,
      },
      storage: {
        label: "Storage",
        status: "healthy" as const,
        value: "Managed",
        detail: "Database-backed storage",
      },
      activeSessions: {
        label: "Active Sessions",
        status: "healthy" as const,
        value: String(recentLogins),
        detail: "Logins last 24h",
      },
      activeBusinesses: {
        label: "Active Businesses",
        status: activeBusinesses === 0 ? ("warning" as const) : ("healthy" as const),
        value: String(activeBusinesses),
        detail: "Non-demo customer workspaces",
      },
      onlineUsers: {
        label: "Online Users",
        status: "healthy" as const,
        value: String(recentLogins),
        detail: "Approx. from login events (24h)",
      },
    },
    openTickets,
    node: process.version,
    env: process.env.NODE_ENV || "development",
    // raw retained for developer mode only
    raw: {
      api: { status: "ok", uptimeSec: Math.floor(process.uptime()), latencyMs: Date.now() - started },
      database: { status: dbOk ? "ok" : "error", latencyMs: dbMs },
      memory: { rssMb, heapUsedMb, heapPct },
    },
  };
}

export async function recentPlatformAudit(limit = 50) {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { startsWith: "platform_" },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, email: true, name: true } },
      business: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.createdAt,
    admin: r.actor?.email || r.actorUserId || "system",
    adminName: r.actor?.name || null,
    action: r.action,
    businessId: r.businessId,
    businessName: r.business?.name || null,
    entityType: r.entityType,
    entityId: r.entityId,
    ip: r.ip,
    device: r.userAgent,
    metadata: r.metadata,
  }));
}

export async function recentSystemEvents(limit = 40) {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      createdAt: true,
      entityType: true,
      businessId: true,
      metadata: true,
    },
  });

  return rows.map((r) => {
    const severity =
      r.action.includes("delete") || r.action.includes("suspend")
        ? "critical"
        : r.action.includes("error") || r.action.includes("fail")
          ? "warning"
          : "info";
    return {
      id: r.id,
      time: r.createdAt,
      event: r.action,
      severity,
      module: r.entityType || "platform",
      businessId: r.businessId,
    };
  });
}

/** Bulk operations on customer businesses (never demo). */
export async function bulkBusinessAction(input: {
  actorUserId: string;
  businessIds: string[];
  action:
    | "suspend"
    | "activate"
    | "delete"
    | "change_plan"
    | "assign_license"
    | "send_email"
    | "send_notification";
  plan?: string;
  reason?: string;
  licenseStatus?: string;
  emailSubject?: string;
  emailBody?: string;
  notificationMessage?: string;
}) {
  const ids = [...new Set(input.businessIds.filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one business");
  if (ids.length > 200) throw new Error("Maximum 200 businesses per bulk action");

  const businesses = await prisma.business.findMany({
    where: { id: { in: ids }, isDemo: false, portalKind: "customer" },
    select: { id: true, name: true, status: true, plan: true },
  });
  if (!businesses.length) throw new Error("No matching customer businesses");

  const results: Array<{ id: string; name: string; ok: boolean; error?: string }> = [];

  for (const b of businesses) {
    try {
      if (input.action === "suspend") {
        await setBusinessStatus(input.actorUserId, b.id, "suspended", input.reason || "Bulk suspend");
      } else if (input.action === "activate") {
        await setBusinessStatus(input.actorUserId, b.id, "active");
      } else if (input.action === "delete") {
        await softDeleteBusiness(input.actorUserId, b.id);
      } else if (input.action === "change_plan") {
        if (!input.plan) throw new Error("plan required");
        await changePlan(input.actorUserId, b.id, "upgrade", input.plan, 30);
      } else if (input.action === "assign_license") {
        await prisma.business.update({
          where: { id: b.id },
          data: {
            licenseStatus: input.licenseStatus || "active",
            licenseKey: `MM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
            planStatus: "active",
          },
        });
        await recordAudit({
          businessId: b.id,
          actorUserId: input.actorUserId,
          action: "platform_bulk_assign_license",
          entityType: "business",
          entityId: b.id,
          metadata: { licenseStatus: input.licenseStatus || "active" },
        });
      } else if (input.action === "send_email") {
        // Queued conceptually — audit trail for platform ops (email provider later)
        await recordAudit({
          businessId: b.id,
          actorUserId: input.actorUserId,
          action: "platform_bulk_email",
          entityType: "business",
          entityId: b.id,
          metadata: {
            subject: input.emailSubject || "Message from Massive Mentor",
            bodyPreview: (input.emailBody || "").slice(0, 200),
            queued: true,
          },
        });
      } else if (input.action === "send_notification") {
        await recordAudit({
          businessId: b.id,
          actorUserId: input.actorUserId,
          action: "platform_bulk_notification",
          entityType: "business",
          entityId: b.id,
          metadata: {
            message: (input.notificationMessage || "").slice(0, 500),
            queued: true,
          },
        });
      }
      results.push({ id: b.id, name: b.name, ok: true });
    } catch (e) {
      results.push({
        id: b.id,
        name: b.name,
        ok: false,
        error: e instanceof Error ? e.message : "Failed",
      });
    }
  }

  await recordAudit({
    actorUserId: input.actorUserId,
    action: `platform_bulk_${input.action}`,
    entityType: "business",
    metadata: {
      count: ids.length,
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      plan: input.plan,
    },
  });

  return {
    action: input.action,
    total: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export async function platformUsageDashboard() {
  const businesses = await prisma.business.findMany({
    where: { isDemo: false, portalKind: "customer", status: { not: "deleted" } },
    select: {
      id: true,
      name: true,
      status: true,
      plan: true,
      createdAt: true,
      usageSnapshot: true,
      updatedAt: true,
      owner: { select: { email: true, name: true } },
      _count: { select: { members: true, contacts: true, deals: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  // Aggregate platform KPIs
  let totalUsers = 0;
  let totalLeads = 0;
  let totalDeals = 0;
  let totalAi = 0;
  let totalWa = 0;
  let totalRevenue = 0;

  for (const b of businesses) {
    totalUsers += b._count.members;
    totalLeads += b._count.contacts;
    totalDeals += b._count.deals;
    const snap = (b.usageSnapshot || {}) as Record<string, number>;
    totalAi += Number(snap.aiUsage || 0);
    totalWa += Number(snap.whatsapp || 0);
  }

  const won = await prisma.deal.aggregate({
    where: {
      business: { isDemo: false, portalKind: "customer" },
      stage: "closed_won",
    },
    _sum: { value: true },
  });
  totalRevenue = toMoneyNumber(won._sum.value);

  // Daily login trend (last 14 days)
  const since = new Date(Date.now() - 14 * 86400000);
  const loginLogs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["login", "platform_login", "demo_login"] },
      createdAt: { gte: since },
    },
    select: { createdAt: true, action: true },
    take: 5000,
  });

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dailyMap: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    dailyMap[dayKey(d)] = 0;
  }
  for (const log of loginLogs) {
    const k = dayKey(new Date(log.createdAt));
    if (k in dailyMap) dailyMap[k] += 1;
  }
  const dailyUsage = Object.entries(dailyMap).map(([date, count]) => ({ date, count }));

  // Monthly business signups (last 6 months)
  const monthlyMap: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    monthlyMap[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`] = 0;
  }
  for (const b of businesses) {
    const d = new Date(b.createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (k in monthlyMap) monthlyMap[k] += 1;
  }
  const monthlyUsage = Object.entries(monthlyMap).map(([month, count]) => ({ month, count }));

  const activeUsers = await prisma.auditLog.count({
    where: {
      action: "login",
      createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
    },
  });

  return {
    kpis: {
      totalUsers,
      totalLeads,
      totalDeals,
      aiUsage: totalAi,
      whatsappMessages: totalWa,
      emailCount: 0,
      storageUsedMb: 0,
      lastActive: businesses[0]?.updatedAt || null,
      revenue: totalRevenue,
      activeUsers,
      businesses: businesses.length,
    },
    charts: {
      dailyUsage,
      monthlyUsage,
      loginTrend: dailyUsage,
      aiRequests: dailyUsage.map((d) => ({
        date: d.date,
        count: Math.round(d.count * 1.4), // proxy until dedicated AI metrics table
      })),
    },
    businesses: businesses.map((b) => {
      const snap = (b.usageSnapshot || {}) as Record<string, number>;
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        plan: b.plan,
        ownerEmail: b.owner?.email,
        users: b._count.members,
        leads: b._count.contacts,
        deals: b._count.deals,
        aiUsage: Number(snap.aiUsage || 0),
        whatsapp: Number(snap.whatsapp || 0),
        lastActive: b.updatedAt,
      };
    }),
  };
}

export async function addBusinessUser(input: {
  actorUserId: string;
  businessId: string;
  email: string;
  password: string;
  name?: string;
  role?: string;
}) {
  const b = await prisma.business.findFirst({
    where: { id: input.businessId, isDemo: false, portalKind: "customer" },
  });
  if (!b) throw new Error("Business not found");

  const email = input.email.toLowerCase().trim();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        name: input.name?.trim() || null,
        role: input.role || "sales_executive",
        platformRole: "user",
      },
    });
  }

  await prisma.businessMember.upsert({
    where: { businessId_userId: { businessId: b.id, userId: user.id } },
    create: {
      businessId: b.id,
      userId: user.id,
      role: input.role || "sales_executive",
    },
    update: { role: input.role || "sales_executive" },
  });

  await recordAudit({
    businessId: b.id,
    actorUserId: input.actorUserId,
    action: "platform_add_user",
    entityType: "user",
    entityId: user.id,
    metadata: { email },
  });

  return { id: user.id, email: user.email, name: user.name };
}

export async function setBusinessUserDisabled(
  actorUserId: string,
  businessId: string,
  userId: string,
  disabled: boolean
) {
  const member = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId } },
  });
  if (!member) throw new Error("User is not a member of this business");

  await prisma.user.update({
    where: { id: userId },
    data: { isDisabled: disabled },
  });

  await recordAudit({
    businessId,
    actorUserId,
    action: disabled ? "platform_disable_user" : "platform_enable_user",
    entityType: "user",
    entityId: userId,
  });

  return { ok: true, userId, isDisabled: disabled };
}

export async function resetBusinessUserPassword(
  actorUserId: string,
  businessId: string,
  userId: string,
  newPassword: string
) {
  if (!newPassword || newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  const member = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId } },
  });
  if (!member) throw new Error("User is not a member of this business");

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 12),
      tokenVersion: { increment: 1 },
    },
  });

  await recordAudit({
    businessId,
    actorUserId,
    action: "platform_reset_user_password",
    entityType: "user",
    entityId: userId,
  });

  return { ok: true };
}

export async function exportBusinessData(businessId: string) {
  const detail = await getBusinessDetail(businessId);
  return {
    exportedAt: new Date().toISOString(),
    business: {
      id: detail.id,
      name: detail.name,
      plan: detail.plan,
      status: detail.status,
      owner: detail.owner,
      stats: detail.stats,
      members: detail.members,
    },
  };
}
