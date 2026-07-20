import { prisma } from "../lib/prisma.js";
import { createNotification } from "./notification.service.js";
import { logActivity } from "./activity.service.js";

// Simple reminder check - in real would be cron
export async function checkAndSendReminders(userId: string) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tasksDue = await prisma.task.findMany({
    where: {
      userId,
      status: { not: "done" },
      dueDate: { lte: tomorrow },
    },
  });

  for (const task of tasksDue) {
    await createNotification({
      userId,
      type: "reminder",
      title: "Task Due Soon",
      message: `Task "${task.title}" is due ${task.dueDate ? task.dueDate.toLocaleDateString() : "soon"}`,
      entityType: "task",
      entityId: task.id,
    });
  }

  return { remindersSent: tasksDue.length };
}

export async function logCrmActivity(userId: string, entityType: string, entityId: string, action: string, details?: any) {
  await logActivity({
    userId,
    entityType,
    entityId,
    action,
    details,
  });
}