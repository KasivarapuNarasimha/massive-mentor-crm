import { prisma } from "../lib/prisma.js";

export interface LogActivityInput {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  details?: Record<string, unknown>;
}

export async function logActivity(input: LogActivityInput) {
  const row = await prisma.activity.create({
    data: {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      details: (input.details as object | undefined) || undefined,
    },
  });

  // Fan-out to Admin team-activity toasts (best-effort; never fail CRM write)
  void fanOutTeamActivity(input, row.id).catch(() => undefined);

  return row;
}

async function fanOutTeamActivity(input: LogActivityInput, activityId: string): Promise<void> {
  const {
    isMeaningfulTeamActivity,
    formatTeamActivityCopy,
    publishTeamActivity,
  } = await import("./team-activity-realtime.service.js");
  if (!isMeaningfulTeamActivity(input.action, input.entityType)) return;

  const { getUserBusinessId } = await import("./field-engine.service.js");
  const businessId = await getUserBusinessId(input.userId);
  if (!businessId) return;

  const actor = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true },
  });
  const actorName =
    (actor?.name && actor.name.trim()) || actor?.email || "A teammate";

  const { title, message } = formatTeamActivityCopy({
    actorName,
    action: input.action,
    entityType: input.entityType,
    details: input.details || null,
  });

  const payload = {
    type: "team_activity" as const,
    businessId,
    at: new Date().toISOString(),
    eventId: activityId,
    actorUserId: input.userId,
    actorName,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    title,
    message,
  };
  publishTeamActivity(payload);

  // Persist inbox notifications for workspace admins (bell + toast via poll/SSE)
  const ADMIN_ROLES = new Set([
    "ceo",
    "owner",
    "business_admin",
    "admin",
    "super_admin",
    "sales_manager",
    "manager",
  ]);
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    include: {
      user: { select: { id: true, role: true, isDisabled: true } },
    },
  });
  const { notifyUser } = await import("./notification.service.js");
  for (const m of members) {
    if (!m.user || m.user.isDisabled) continue;
    if (m.user.id === input.userId) continue; // don't notify the actor
    const role = (m.role || m.user.role || "").toLowerCase();
    if (!ADMIN_ROLES.has(role) && !role.includes("admin")) continue;
    await notifyUser(m.user.id, {
      type: "team_activity",
      title,
      message,
      entityType: input.entityType,
      entityId: input.entityId,
    }).catch(() => undefined);
  }
}

export async function getActivityTimeline(
  userId: string,
  entityType?: string,
  entityId?: string,
  limit = 50
) {
  const where: {
    userId: string;
    entityType?: string;
    entityId?: string;
  } = { userId };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  return prisma.activity.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Business-wide audit trail from AuditLog (search/filter). */
export async function searchAuditLog(
  userId: string,
  opts?: {
    action?: string;
    entityType?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const { getUserBusinessId } = await import("./field-engine.service.js");
  const businessId = await getUserBusinessId(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(200, opts.pageSize) : 50;
  const where: Record<string, unknown> = {};
  if (businessId) where.businessId = businessId;
  else where.actorUserId = userId;
  if (opts?.action) where.action = opts.action;
  if (opts?.entityType) where.entityType = opts.entityType;

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where: where as never }),
    prisma.auditLog.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);

  let filtered = items;
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    filtered = items.filter(
      (i) =>
        i.entityType?.toLowerCase().includes(q) ||
        i.action.toLowerCase().includes(q) ||
        i.actor?.email?.toLowerCase().includes(q) ||
        JSON.stringify(i.metadata || {}).toLowerCase().includes(q)
    );
  }

  return {
    items: filtered,
    total: opts?.search ? filtered.length : total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil((opts?.search ? filtered.length : total) / pageSize)),
  };
}

const MEMBER_ACTIVITY_ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
  "sales_manager",
  "manager",
]);

export type MemberActivityRow = {
  userId: string;
  name: string;
  email: string | null;
  role: string | null;
  leadsAssigned: number;
  /** Contact Activity rows: updated | bulk_updated (logged edits only) */
  leadsUpdated: number;
  /** Task.status = done */
  followUpsCompleted: number;
  meetings: number;
  emailsSent: number;
  whatsappActions: number;
  /** Phone calls are not tracked in CRM today */
  callsMade: null;
};

export type MemberActivitySummary = {
  sinceDays: number;
  since: string;
  unavailableMetrics: Array<{ key: string; reason: string }>;
  byMember: MemberActivityRow[];
  totals: {
    leadsAssigned: number;
    leadsUpdated: number;
    followUpsCompleted: number;
    meetings: number;
    emailsSent: number;
    whatsappActions: number;
  };
};

/**
 * Tenant-scoped member CRM activity rollup for Admin dashboards.
 * Uses only existing tables (Contact.assignedTo, Activity, AuditLog, Task, Meeting).
 * Does NOT invent call metrics — phone calls are not stored.
 */
export async function getMemberActivitySummary(
  actorUserId: string,
  opts?: { sinceDays?: number }
): Promise<MemberActivitySummary> {
  const { resolveActorRole } = await import("./tenant-scope.service.js");
  const { getUserBusinessId } = await import("./field-engine.service.js");
  const role = await resolveActorRole(actorUserId);
  if (!MEMBER_ACTIVITY_ADMIN_ROLES.has(role) && !role.includes("admin")) {
    throw Object.assign(new Error("Insufficient permissions to view team activity"), {
      status: 403,
    });
  }

  const businessId = await getUserBusinessId(actorUserId);
  const sinceDays =
    opts?.sinceDays && opts.sinceDays > 0 ? Math.min(90, Math.floor(opts.sinceDays)) : 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const unavailableMetrics = [
    {
      key: "callsMade",
      reason: "Phone calls are not stored as CRM records (no CallLog). WhatsApp/email/tasks/meetings are tracked.",
    },
  ];

  // Workspace members (or solo actor)
  type Member = { id: string; name: string | null; email: string; role: string | null };
  let members: Member[] = [];
  if (businessId) {
    const rows = await prisma.businessMember.findMany({
      where: { businessId },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, isDisabled: true },
        },
      },
    });
    members = rows
      .filter((m) => m.user && !m.user.isDisabled)
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role || m.user.role,
      }));
  } else {
    const me = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, name: true, email: true, role: true, isDisabled: true },
    });
    if (me && !me.isDisabled) {
      members = [{ id: me.id, name: me.name, email: me.email, role: me.role }];
    }
  }

  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) {
    return {
      sinceDays,
      since: since.toISOString(),
      unavailableMetrics,
      byMember: [],
      totals: {
        leadsAssigned: 0,
        leadsUpdated: 0,
        followUpsCompleted: 0,
        meetings: 0,
        emailsSent: 0,
        whatsappActions: 0,
      },
    };
  }

  const contactWhere = businessId
    ? { businessId, type: "lead", deletedAt: null, assignedTo: { in: memberIds } }
    : { userId: actorUserId, type: "lead", deletedAt: null, assignedTo: { in: memberIds } };

  const [
    assignedGroups,
    activityRows,
    auditRows,
    taskGroups,
    meetingGroups,
  ] = await Promise.all([
    prisma.contact.groupBy({
      by: ["assignedTo"],
      where: contactWhere as never,
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId", "action"],
      where: {
        userId: { in: memberIds },
        entityType: "contact",
        createdAt: { gte: since },
        action: { in: ["updated", "bulk_updated", "email_sent", "created"] },
      },
      _count: { _all: true },
    }),
    prisma.auditLog.groupBy({
      by: ["actorUserId", "action"],
      where: {
        ...(businessId ? { businessId } : {}),
        actorUserId: { in: memberIds },
        createdAt: { gte: since },
        OR: [
          { action: { in: ["lead_bulk_edit", "lead_email_sent", "lead_update"] } },
          { action: { contains: "whatsapp" } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["userId"],
      where: {
        userId: { in: memberIds },
        status: "done",
        updatedAt: { gte: since },
        ...(businessId ? { businessId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.meeting.groupBy({
      by: ["userId"],
      where: {
        userId: { in: memberIds },
        createdAt: { gte: since },
        ...(businessId ? { businessId } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  const assignedMap = new Map<string, number>();
  for (const g of assignedGroups) {
    if (g.assignedTo) assignedMap.set(g.assignedTo, g._count._all);
  }

  const leadsUpdatedMap = new Map<string, number>();
  const emailsMap = new Map<string, number>();
  for (const g of activityRows) {
    const n = g._count._all;
    if (g.action === "updated" || g.action === "bulk_updated") {
      leadsUpdatedMap.set(g.userId, (leadsUpdatedMap.get(g.userId) || 0) + n);
    }
    if (g.action === "email_sent") {
      emailsMap.set(g.userId, (emailsMap.get(g.userId) || 0) + n);
    }
  }

  const whatsappMap = new Map<string, number>();
  for (const g of auditRows) {
    const uid = g.actorUserId;
    if (!uid) continue;
    const n = g._count._all;
    const action = String(g.action || "");
    if (action.includes("whatsapp")) {
      whatsappMap.set(uid, (whatsappMap.get(uid) || 0) + n);
    }
    if (action === "lead_bulk_edit" || action === "lead_update") {
      leadsUpdatedMap.set(uid, (leadsUpdatedMap.get(uid) || 0) + n);
    }
    if (action === "lead_email_sent") {
      emailsMap.set(uid, (emailsMap.get(uid) || 0) + n);
    }
    // Generic "update" on contacts only if entityType filtered — our query didn't filter entityType;
    // skip generic "update" to avoid counting ERP/finance updates.
  }

  const tasksMap = new Map(taskGroups.map((g) => [g.userId, g._count._all]));
  const meetingsMap = new Map(meetingGroups.map((g) => [g.userId, g._count._all]));

  const byMember: MemberActivityRow[] = members
    .map((m) => ({
      userId: m.id,
      name: (m.name && m.name.trim()) || m.email || "Team member",
      email: m.email || null,
      role: m.role,
      leadsAssigned: assignedMap.get(m.id) || 0,
      leadsUpdated: leadsUpdatedMap.get(m.id) || 0,
      followUpsCompleted: tasksMap.get(m.id) || 0,
      meetings: meetingsMap.get(m.id) || 0,
      emailsSent: emailsMap.get(m.id) || 0,
      whatsappActions: whatsappMap.get(m.id) || 0,
      callsMade: null,
    }))
    .sort(
      (a, b) =>
        b.leadsAssigned - a.leadsAssigned ||
        b.leadsUpdated + b.followUpsCompleted + b.meetings - (a.leadsUpdated + a.followUpsCompleted + a.meetings) ||
        a.name.localeCompare(b.name)
    );

  const totals = byMember.reduce(
    (acc, m) => {
      acc.leadsAssigned += m.leadsAssigned;
      acc.leadsUpdated += m.leadsUpdated;
      acc.followUpsCompleted += m.followUpsCompleted;
      acc.meetings += m.meetings;
      acc.emailsSent += m.emailsSent;
      acc.whatsappActions += m.whatsappActions;
      return acc;
    },
    {
      leadsAssigned: 0,
      leadsUpdated: 0,
      followUpsCompleted: 0,
      meetings: 0,
      emailsSent: 0,
      whatsappActions: 0,
    }
  );

  return {
    sinceDays,
    since: since.toISOString(),
    unavailableMetrics,
    byMember,
    totals,
  };
}

export type AdminLeadSearchRow = {
  id: string;
  name: string;
  company: string | null;
  status: string;
  assignedToId: string | null;
  assignedToName: string | null;
  lastActivityAt: string | null;
  nextFollowUp: string | null;
  phone: string | null;
  updatedAt: string;
};

/**
 * Admin lead visibility search — reuses buildContactListWhere (same tenant/role scope as Leads list).
 */
export async function adminLeadVisibilitySearch(
  actorUserId: string,
  opts: {
    status?: string;
    assignedTo?: string;
    search?: string;
    sinceDays?: number;
    page?: number;
    pageSize?: number;
  }
): Promise<{
  total: number;
  page: number;
  pageSize: number;
  items: AdminLeadSearchRow[];
}> {
  const { resolveActorRole } = await import("./tenant-scope.service.js");
  const role = await resolveActorRole(actorUserId);
  if (!MEMBER_ACTIVITY_ADMIN_ROLES.has(role) && !role.includes("admin")) {
    throw Object.assign(new Error("Insufficient permissions for admin lead search"), {
      status: 403,
    });
  }

  const { buildContactListWhere } = await import("./crm.service.js");
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts.pageSize ? Math.min(100, Math.max(1, opts.pageSize)) : 25;

  const where = (await buildContactListWhere(actorUserId, {
    type: "lead",
    status: opts.status?.trim() || undefined,
    assignedTo: opts.assignedTo?.trim() || undefined,
    search: opts.search?.trim() || undefined,
  })) as Record<string, unknown>;

  if (opts.sinceDays && opts.sinceDays > 0) {
    const since = new Date(Date.now() - Math.min(365, opts.sinceDays) * 24 * 60 * 60 * 1000);
    where.updatedAt = { gte: since };
  }

  const [total, contacts] = await Promise.all([
    prisma.contact.count({ where: where as never }),
    prisma.contact.findMany({
      where: where as never,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        company: true,
        status: true,
        assignedTo: true,
        lastContactedAt: true,
        nextFollowUp: true,
        phone: true,
        updatedAt: true,
      },
    }),
  ]);

  const assigneeIds = [
    ...new Set(contacts.map((c) => c.assignedTo).filter((id): id is string => !!id)),
  ];
  const users =
    assigneeIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  const items: AdminLeadSearchRow[] = contacts.map((c) => {
    const u = c.assignedTo ? uMap.get(c.assignedTo) : undefined;
    const last =
      c.lastContactedAt && c.updatedAt
        ? c.lastContactedAt > c.updatedAt
          ? c.lastContactedAt
          : c.updatedAt
        : c.lastContactedAt || c.updatedAt;
    return {
      id: c.id,
      name: c.name,
      company: c.company,
      status: c.status,
      assignedToId: c.assignedTo,
      assignedToName: u
        ? (u.name && u.name.trim()) || u.email
        : c.assignedTo
          ? c.assignedTo
          : null,
      lastActivityAt: last ? last.toISOString() : null,
      nextFollowUp: c.nextFollowUp ? c.nextFollowUp.toISOString() : null,
      phone: c.phone,
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  return { total, page, pageSize, items };
}