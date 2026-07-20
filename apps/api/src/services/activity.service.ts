import { prisma } from "../lib/prisma.js";

export interface LogActivityInput {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  details?: Record<string, any>;
}

export async function logActivity(input: LogActivityInput) {
  return prisma.activity.create({
    data: {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      details: input.details || undefined,
    },
  });
}

export async function getActivityTimeline(userId: string, entityType?: string, entityId?: string, limit = 50) {
  const where: any = { userId };
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