import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "reminder"
  | "activity"
  | "integration"
  | "lead_assigned"
  | "deal_won"
  | "deal_lost"
  | "meeting_reminder"
  | "task_reminder"
  | "payment_reminder"
  | "ai_recommendation"
  | "system"
  | "finance";

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}

/** Alias used by CRM/finance modules */
export async function notifyUser(
  userId: string,
  opts: {
    type: string;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
  }
) {
  return createNotification({ userId, ...opts });
}

export async function getNotifications(
  userId: string,
  opts?: { unreadOnly?: boolean; limit?: number; page?: number; pageSize?: number }
) {
  const where: { userId: string; isRead?: boolean } = { userId };
  if (opts?.unreadOnly) where.isRead = false;

  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(100, Math.max(1, opts.pageSize)) : opts?.limit || 30;
  const skip = (page - 1) * pageSize;

  const [total, items, unreadCount] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    unreadCount,
  };
}

export async function markAsRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

/**
 * Scan due tasks/meetings and create reminder notifications (callable by cron or poll).
 */
export async function processDueReminders(userId: string) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [tasks, meetings] = await Promise.all([
    prisma.task.findMany({
      where: {
        userId,
        status: { not: "done" },
        dueDate: { lte: in24h, gte: now },
      },
      take: 50,
    }),
    prisma.meeting.findMany({
      where: {
        userId,
        scheduledAt: { lte: in24h, gte: now },
      },
      take: 50,
    }),
  ]);

  let created = 0;
  for (const task of tasks) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "task_reminder",
        entityId: task.id,
        createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
      },
    });
    if (existing) continue;
    await createNotification({
      userId,
      type: "task_reminder",
      title: "Task Reminder",
      message: `Task "${task.title}" is due ${task.dueDate?.toLocaleString() || "soon"}`,
      entityType: "task",
      entityId: task.id,
    });
    created++;
  }
  for (const m of meetings) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        type: "meeting_reminder",
        entityId: m.id,
        createdAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
      },
    });
    if (existing) continue;
    await createNotification({
      userId,
      type: "meeting_reminder",
      title: "Meeting Reminder",
      message: `Meeting "${m.title}" at ${m.scheduledAt.toLocaleString()}`,
      entityType: "meeting",
      entityId: m.id,
    });
    created++;
  }
  return { created };
}
