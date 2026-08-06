/**
 * Enterprise WhatsApp Conversation Center
 * Inbox, assignment, status, notes, AI replies/summary, timeline, dashboard.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import { getAIService } from "./ai.service.js";
import { sendWhatsAppCloudMessage } from "./whatsapp.service.js";
import { notifyUser } from "./notification.service.js";
import { recordAudit } from "./audit.service.js";
import { toMoneyNumber } from "../lib/money.js";
import { formatCurrency } from "../lib/currency.js";

const ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

const MANAGER_ROLES = new Set(["sales_manager", "manager", ...ADMIN_ROLES]);

const CONVERSATION_STATUSES = [
  "open",
  "pending",
  "follow_up",
  "won",
  "lost",
  "closed",
] as const;

export function normalizeWaPhone(phone: string): string {
  return String(phone || "").replace(/[^\d]/g, "");
}

async function requireBusiness(userId: string): Promise<string> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Workspace required for WhatsApp Inbox");
  return businessId;
}

function isAdmin(role: string) {
  return ADMIN_ROLES.has(role) || role.includes("admin");
}

function isManager(role: string) {
  return MANAGER_ROLES.has(role) || role.includes("admin") || role.includes("manager");
}

/**
 * Scope conversations by role:
 * - Admin: all business
 * - Sales Manager: assigned to self OR unassigned (optional) — only assigned to self + team via contact
 * - SE: only assignedToUserId = self
 */
async function conversationScopeWhere(userId: string, businessId: string) {
  const role = await resolveActorRole(userId);
  if (isAdmin(role)) {
    return { businessId };
  }
  if (role === "sales_manager" || role === "manager") {
    const { getManagedTeamUserIds } = await import("./tenant-scope.service.js");
    const teamIds = await getManagedTeamUserIds(userId, businessId);
    return {
      businessId,
      OR: [
        { assignedToUserId: { in: teamIds } },
        { assignedToUserId: null }, // managers can claim unassigned
      ],
    };
  }
  // Sales executive — only own inbox
  return { businessId, assignedToUserId: userId };
}

async function findContactByPhone(businessId: string, phone: string) {
  const digits = normalizeWaPhone(phone);
  if (digits.length < 8) return null;
  const last10 = digits.slice(-10);
  const contacts = await prisma.contact.findMany({
    where: {
      businessId,
      deletedAt: null,
      OR: [
        { phone: { contains: last10 } },
        { whatsapp: { contains: last10 } },
      ],
    },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });
  // Prefer exact last-10 match
  return (
    contacts.find(
      (c) =>
        normalizeWaPhone(c.phone || "").endsWith(last10) ||
        normalizeWaPhone(c.whatsapp || "").endsWith(last10)
    ) ||
    contacts[0] ||
    null
  );
}

/** Upsert conversation for a phone and attach message side-effects */
export async function upsertConversationForMessage(opts: {
  businessId: string | null | undefined;
  userId: string;
  phone: string;
  contactId?: string | null;
  direction: "inbound" | "outbound" | "internal";
  body: string;
  messageId?: string;
  isInternal?: boolean;
}): Promise<{ conversationId: string }> {
  const businessId =
    opts.businessId || (await getUserBusinessId(opts.userId));
  if (!businessId) {
    return { conversationId: "" };
  }
  const phone = normalizeWaPhone(opts.phone);
  if (phone.length < 8) return { conversationId: "" };

  let contactId = opts.contactId || null;
  let contactName: string | null = null;
  let company: string | null = null;
  let assignedFromContact: string | null = null;

  if (contactId) {
    const c = await prisma.contact.findFirst({
      where: { id: contactId, businessId },
      select: { id: true, name: true, company: true, assignedTo: true },
    });
    if (c) {
      contactName = c.name;
      company = c.company;
      assignedFromContact = c.assignedTo;
    }
  } else {
    const c = await findContactByPhone(businessId, phone);
    if (c) {
      contactId = c.id;
      contactName = c.name;
      company = c.company;
      assignedFromContact = c.assignedTo;
    }
  }

  const preview = (opts.body || "").slice(0, 200);
  const now = new Date();
  const isInbound = opts.direction === "inbound" && !opts.isInternal;

  const existing = await prisma.whatsAppConversation.findUnique({
    where: { businessId_phone: { businessId, phone } },
  });

  if (existing) {
    const data: Record<string, unknown> = {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageDirection: opts.direction,
      contactId: contactId || existing.contactId,
      contactName: contactName || existing.contactName,
      company: company || existing.company,
      updatedAt: now,
    };
    if (isInbound) {
      data.lastInboundAt = now;
      data.unreadCount = { increment: 1 };
      if (existing.status === "closed") data.status = "open";
    } else if (opts.direction === "outbound") {
      data.lastOutboundAt = now;
    }
    // Prefer existing assignment; else use contact assignee; else inbound → integration user
    if (!existing.assignedToUserId) {
      data.assignedToUserId = assignedFromContact || opts.userId;
    }

    await prisma.whatsAppConversation.update({
      where: { id: existing.id },
      data: data as never,
    });

    if (opts.messageId) {
      await prisma.whatsAppMessage
        .update({
          where: { id: opts.messageId },
          data: {
            conversationId: existing.id,
            contactId: contactId || undefined,
          },
        })
        .catch(() => undefined);
    }
    return { conversationId: existing.id };
  }

  const created = await prisma.whatsAppConversation.create({
    data: {
      businessId,
      phone,
      contactId,
      contactName,
      company,
      assignedToUserId: assignedFromContact || opts.userId,
      status: "open",
      unreadCount: isInbound ? 1 : 0,
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageDirection: opts.direction,
      lastInboundAt: isInbound ? now : null,
      lastOutboundAt: opts.direction === "outbound" ? now : null,
    },
  });

  if (opts.messageId) {
    await prisma.whatsAppMessage
      .update({
        where: { id: opts.messageId },
        data: { conversationId: created.id, contactId: contactId || undefined },
      })
      .catch(() => undefined);
  }
  return { conversationId: created.id };
}

export async function listConversations(
  userId: string,
  opts?: {
    search?: string;
    status?: string;
    assignedTo?: string;
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
  }
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 30));

  const and: Record<string, unknown>[] = [scope];
  if (opts?.status && CONVERSATION_STATUSES.includes(opts.status as never)) {
    and.push({ status: opts.status });
  }
  if (opts?.assignedTo) and.push({ assignedToUserId: opts.assignedTo });
  if (opts?.unreadOnly) and.push({ unreadCount: { gt: 0 } });
  if (opts?.search?.trim()) {
    const q = opts.search.trim();
    and.push({
      OR: [
        { contactName: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\D/g, "") } },
        { lastMessagePreview: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where = { AND: and };
  const [total, rows, unreadTotal] = await Promise.all([
    prisma.whatsAppConversation.count({ where: where as never }),
    prisma.whatsAppConversation.findMany({
      where: where as never,
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.whatsAppConversation.aggregate({
      where: { ...(scope as object), unreadCount: { gt: 0 } } as never,
      _sum: { unreadCount: true },
      _count: { _all: true },
    }),
  ]);

  const assigneeIds = [
    ...new Set(rows.map((r) => r.assignedToUserId).filter(Boolean) as string[]),
  ];
  const assignees = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const aMap = new Map(assignees.map((a) => [a.id, a]));

  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    unreadConversations: unreadTotal._count._all,
    unreadMessages: unreadTotal._sum.unreadCount || 0,
    items: rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      contactId: r.contactId,
      contactName: r.contactName || r.phone,
      company: r.company,
      status: r.status,
      unreadCount: r.unreadCount,
      lastMessageAt: r.lastMessageAt?.toISOString() || null,
      lastMessagePreview: r.lastMessagePreview,
      lastMessageDirection: r.lastMessageDirection,
      assignedToUserId: r.assignedToUserId,
      assignedToName:
        aMap.get(r.assignedToUserId || "")?.name ||
        aMap.get(r.assignedToUserId || "")?.email ||
        null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function getConversation(userId: string, conversationId: string) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  // Mark read
  if (conv.unreadCount > 0) {
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { unreadCount: 0 },
    });
  }

  let contact: Record<string, unknown> | null = null;
  if (conv.contactId) {
    const c = await prisma.contact.findFirst({
      where: { id: conv.contactId, businessId, deletedAt: null },
    });
    if (c) {
      const deal = await prisma.deal.findFirst({
        where: { contactId: c.id },
        orderBy: { updatedAt: "desc" },
        select: { value: true, stage: true, title: true },
      });
      const assignee = c.assignedTo
        ? await prisma.user.findUnique({
            where: { id: c.assignedTo },
            select: { id: true, name: true, email: true },
          })
        : null;
      contact = {
        id: c.id,
        name: c.name,
        company: c.company,
        phone: c.phone,
        whatsapp: c.whatsapp,
        email: c.email,
        status: c.status,
        type: c.type,
        aiScore: c.aiScore,
        nextFollowUp: c.nextFollowUp?.toISOString() || null,
        lastContactedAt: c.lastContactedAt?.toISOString() || null,
        value: c.value != null ? toMoneyNumber(c.value) : null,
        valueLabel:
          c.value != null ? formatCurrency(toMoneyNumber(c.value), "INR") : null,
        assignedTo: c.assignedTo,
        assignedToName: assignee?.name || assignee?.email || null,
        dealValue:
          deal?.value != null ? toMoneyNumber(deal.value) : null,
        dealValueLabel:
          deal?.value != null
            ? formatCurrency(toMoneyNumber(deal.value), "INR")
            : null,
        dealStage: deal?.stage || null,
        dealTitle: deal?.title || null,
      };
    }
  }

  const convAssignee = conv.assignedToUserId
    ? await prisma.user.findUnique({
        where: { id: conv.assignedToUserId },
        select: { id: true, name: true, email: true },
      })
    : null;

  return {
    conversation: {
      id: conv.id,
      phone: conv.phone,
      contactId: conv.contactId,
      contactName: conv.contactName || contact?.name || conv.phone,
      company: conv.company || contact?.company || null,
      status: conv.status,
      unreadCount: 0,
      assignedToUserId: conv.assignedToUserId,
      assignedToName: convAssignee?.name || convAssignee?.email || null,
      lastMessageAt: conv.lastMessageAt?.toISOString() || null,
      aiSummary: conv.aiSummary,
      aiSummaryAt: conv.aiSummaryAt?.toISOString() || null,
    },
    contact,
  };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  opts?: { page?: number; pageSize?: number; includeNotes?: boolean }
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 80));
  const where: Record<string, unknown> = {
    conversationId,
    businessId,
  };
  if (opts?.includeNotes === false) {
    where.isInternal = false;
  }

  const totalCount = await prisma.whatsAppMessage.count({ where: where as never });
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  // Default to last page for chat UX when page=1 and we want latest — use page as-is from client
  const effectivePage = Math.min(page, totalPages);
  const skip = (effectivePage - 1) * pageSize;
  const rows = await prisma.whatsAppMessage.findMany({
    where: where as never,
    orderBy: { createdAt: "asc" },
    skip,
    take: pageSize,
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  return {
    total: totalCount,
    page: effectivePage,
    pageSize,
    totalPages,
    items: rows.map((m) => ({
      id: m.id,
      body: m.body,
      direction: m.direction,
      status: m.status,
      messageType: m.messageType,
      mediaUrl: m.mediaUrl,
      mediaMime: m.mediaMime,
      mediaName: m.mediaName,
      isInternal: m.isInternal,
      waMessageId: m.waMessageId,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
      senderName:
        uMap.get(m.userId)?.name || uMap.get(m.userId)?.email || null,
      userId: m.userId,
    })),
  };
}

export async function sendConversationMessage(
  userId: string,
  conversationId: string,
  body: string
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");
  const text = String(body || "").trim();
  if (!text) throw new Error("Message is required");
  if (text.length > 4096) throw new Error("Message too long (max 4096)");

  const record = await sendWhatsAppCloudMessage({
    userId,
    to: conv.phone,
    body: text,
    contactId: conv.contactId || undefined,
  });

  // Ensure conversation link (sendWhatsApp also creates message)
  await upsertConversationForMessage({
    businessId,
    userId,
    phone: conv.phone,
    contactId: conv.contactId,
    direction: "outbound",
    body: text,
    messageId: record.id,
  });

  return {
    id: record.id,
    body: record.body,
    direction: record.direction,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    waMessageId: record.waMessageId,
  };
}

export async function addInternalNote(
  userId: string,
  conversationId: string,
  body: string
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");
  const text = String(body || "").trim();
  if (!text) throw new Error("Note is required");

  const msg = await prisma.whatsAppMessage.create({
    data: {
      businessId,
      userId,
      contactId: conv.contactId,
      conversationId: conv.id,
      to: conv.phone,
      body: text,
      direction: "internal",
      status: "sent",
      messageType: "note",
      isInternal: true,
    },
  });

  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: `[Note] ${text.slice(0, 180)}`,
      lastMessageDirection: "internal",
    },
  });

  return {
    id: msg.id,
    body: msg.body,
    direction: "internal",
    isInternal: true,
    messageType: "note",
    status: "sent",
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function assignConversation(
  userId: string,
  conversationId: string,
  assigneeUserId: string
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isManager(role)) {
    throw new Error("Only managers and admins can assign conversations");
  }
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");

  const member = await prisma.businessMember.findFirst({
    where: { businessId, userId: assigneeUserId },
  });
  if (!member) throw new Error("Assignee is not in this workspace");

  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { assignedToUserId: assigneeUserId },
  });

  // Sync contact assignment when linked
  if (conv.contactId) {
    await prisma.contact
      .update({
        where: { id: conv.contactId },
        data: { assignedTo: assigneeUserId },
      })
      .catch(() => undefined);
  }

  await prisma.whatsAppMessage.create({
    data: {
      businessId,
      userId,
      conversationId,
      contactId: conv.contactId,
      to: conv.phone,
      body: `Conversation assigned`,
      direction: "internal",
      status: "sent",
      messageType: "system",
      isInternal: true,
      metadata: { assignedToUserId: assigneeUserId },
    },
  });

  await notifyUser(assigneeUserId, {
    type: "integration",
    title: "WhatsApp conversation assigned",
    message: conv.contactName || conv.phone,
    entityType: "whatsapp_conversation",
    entityId: conversationId,
  }).catch(() => undefined);

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "whatsapp_conversation_assign",
    entityType: "whatsapp_conversation",
    entityId: conversationId,
    metadata: { assignedToUserId: assigneeUserId },
  });

  return { id: updated.id, assignedToUserId: updated.assignedToUserId };
}

export async function setConversationStatus(
  userId: string,
  conversationId: string,
  status: string
) {
  const businessId = await requireBusiness(userId);
  if (!CONVERSATION_STATUSES.includes(status as never)) {
    throw new Error("Invalid status");
  }
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { status },
  });
  return { id: updated.id, status: updated.status };
}

export async function createFollowUpReminder(
  userId: string,
  conversationId: string,
  opts: { dueAt: string; title?: string }
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const due = new Date(opts.dueAt);
  if (Number.isNaN(due.getTime())) throw new Error("Invalid due date");

  const title =
    opts.title?.trim() ||
    `WhatsApp follow-up: ${conv.contactName || conv.phone}`;

  const task = await prisma.task.create({
    data: {
      userId,
      businessId,
      contactId: conv.contactId,
      title,
      status: "todo",
      priority: "medium",
      dueDate: due,
      description: `From WhatsApp conversation ${conv.id}`,
    },
  });

  await prisma.whatsAppConversation.update({
    where: { id: conv.id },
    data: { status: "follow_up" },
  });

  await notifyUser(userId, {
    type: "task_reminder",
    title: "Follow-up scheduled",
    message: `${title} · ${due.toLocaleString("en-IN")}`,
    entityType: "task",
    entityId: task.id,
  }).catch(() => undefined);

  return {
    taskId: task.id,
    title: task.title,
    dueDate: due.toISOString(),
  };
}

export async function suggestAiReplies(
  userId: string,
  conversationId: string
): Promise<{ suggestions: string[] }> {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const recent = await prisma.whatsAppMessage.findMany({
    where: {
      conversationId,
      isInternal: false,
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const transcript = recent
    .reverse()
    .map(
      (m) =>
        `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body.slice(0, 300)}`
    )
    .join("\n");

  const lastInbound = recent.find((m) => m.direction === "inbound");
  if (!lastInbound) {
    return {
      suggestions: [
        "Hello! How can I help you today?",
        "Thank you for reaching out. I'll share the details shortly.",
        "Would you like a quick demo or pricing overview?",
      ],
    };
  }

  try {
    const ai = await getAIService();
    const prompt = `You are a professional B2B sales agent on WhatsApp for an Indian SME CRM product.

Given the conversation, suggest exactly 3 short reply options the agent can send next.
Rules:
- Professional, warm, concise (max 2-3 sentences each)
- No markdown, no numbering prefixes in the reply text itself
- Return pure JSON: {"suggestions":["...","...","..."]}

Last customer message: ${lastInbound.body}

Transcript:
${transcript}`;

    const res = await ai.generateJSON<{ suggestions?: string[] }>(prompt, {
      temperature: 0.5,
      maxTokens: 500,
    });
    const list = Array.isArray(res.data?.suggestions)
      ? res.data!.suggestions!.filter((s) => typeof s === "string" && s.trim())
      : [];
    if (list.length >= 1) {
      return { suggestions: list.slice(0, 3) };
    }
  } catch {
    /* fallback */
  }

  return {
    suggestions: [
      "Thank you for your message. I'll check and get back to you shortly.",
      "Happy to help — could you share a bit more detail about your requirement?",
      "I can share pricing and a short demo. What time works for you?",
    ],
  };
}

export async function summarizeConversation(
  userId: string,
  conversationId: string
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const recent = await prisma.whatsAppMessage.findMany({
    where: { conversationId, isInternal: false },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  const transcript = recent
    .reverse()
    .map(
      (m) =>
        `${m.direction === "inbound" ? "Customer" : "Agent"}: ${m.body.slice(0, 400)}`
    )
    .join("\n");

  const empty = {
    requirement: "Not enough conversation data",
    budget: "Unknown",
    objections: "None noted",
    nextAction: "Continue conversation",
    probability: 30,
  };

  try {
    const ai = await getAIService();
    const prompt = `Summarize this WhatsApp sales conversation for a CRM dashboard.

Return JSON only:
{
  "requirement": "string",
  "budget": "string",
  "objections": "string",
  "nextAction": "string",
  "probability": number 0-100
}

Transcript:
${transcript || "(empty)"}`;

    const res = await ai.generateJSON<{
      requirement?: string;
      budget?: string;
      objections?: string;
      nextAction?: string;
      probability?: number;
    }>(prompt, { temperature: 0.3, maxTokens: 600 });

    const summary = {
      requirement: res.data?.requirement || empty.requirement,
      budget: res.data?.budget || empty.budget,
      objections: res.data?.objections || empty.objections,
      nextAction: res.data?.nextAction || empty.nextAction,
      probability: Math.max(
        0,
        Math.min(100, Number(res.data?.probability) || empty.probability)
      ),
    };

    await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { aiSummary: summary, aiSummaryAt: new Date() },
    });

    return summary;
  } catch {
    return empty;
  }
}

export async function getConversationMedia(
  userId: string,
  conversationId: string
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  const messages = await prisma.whatsAppMessage.findMany({
    where: {
      conversationId,
      isInternal: false,
      OR: [
        { messageType: { in: ["image", "video", "document", "audio"] } },
        { mediaUrl: { not: null } },
        { body: { startsWith: "[media:" } },
        { body: { startsWith: "[image" } },
        { body: { startsWith: "[document" } },
        { body: { startsWith: "[video" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Also media send logs for this contact
  const sendLogs = conv.contactId
    ? await prisma.mediaSendLog.findMany({
        where: { businessId, contactId: conv.contactId },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return {
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      messageType: m.messageType,
      mediaUrl: m.mediaUrl,
      mediaName: m.mediaName || m.mediaUrl,
      mediaMime: m.mediaMime,
      direction: m.direction,
      createdAt: m.createdAt.toISOString(),
    })),
    sentFromLibrary: sendLogs.map((l) => ({
      id: l.id,
      assetName: l.assetName,
      status: l.status,
      channel: l.channel,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function getConversationTimeline(
  userId: string,
  conversationId: string
) {
  const businessId = await requireBusiness(userId);
  const scope = await conversationScopeWhere(userId, businessId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, ...(scope as object) } as never,
  });
  if (!conv) throw new Error("Conversation not found");

  type Item = {
    id: string;
    at: string;
    kind: string;
    title: string;
    detail?: string | null;
  };
  const items: Item[] = [];

  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  for (const m of messages) {
    items.push({
      id: m.id,
      at: m.createdAt.toISOString(),
      kind: m.isInternal
        ? "note"
        : m.direction === "inbound"
          ? "whatsapp_in"
          : "whatsapp_out",
      title: m.isInternal
        ? "Internal note"
        : m.direction === "inbound"
          ? "WhatsApp received"
          : "WhatsApp sent",
      detail: m.body.slice(0, 200),
    });
  }

  if (conv.contactId) {
    const [tasks, meetings, activities, invoices, payments] = await Promise.all([
      prisma.task.findMany({
        where: { contactId: conv.contactId, businessId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.meeting.findMany({
        where: { contactId: conv.contactId, businessId },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.activity.findMany({
        where: { entityType: "contact", entityId: conv.contactId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.invoice.findMany({
        where: { contactId: conv.contactId, businessId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.payment.findMany({
        where: { businessId, userId },
        orderBy: { paidAt: "desc" },
        take: 10,
      }),
    ]);

    for (const t of tasks) {
      items.push({
        id: t.id,
        at: (t.dueDate || t.createdAt).toISOString(),
        kind: "task",
        title: `Task: ${t.title}`,
        detail: t.status,
      });
    }
    for (const m of meetings) {
      items.push({
        id: m.id,
        at: (m.scheduledAt || m.createdAt).toISOString(),
        kind: "meeting",
        title: `Meeting: ${m.title}`,
        detail: m.outcome || null,
      });
    }
    for (const a of activities) {
      items.push({
        id: a.id,
        at: a.createdAt.toISOString(),
        kind: "activity",
        title: a.action,
        detail:
          typeof a.details === "object"
            ? JSON.stringify(a.details).slice(0, 120)
            : null,
      });
    }
    for (const inv of invoices) {
      items.push({
        id: inv.id,
        at: inv.createdAt.toISOString(),
        kind: "invoice",
        title: `Invoice ${inv.number}`,
        detail: `${inv.status} · ${formatCurrency(toMoneyNumber(inv.total), "INR")}`,
      });
    }
    void payments;
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return { items: items.slice(0, 100) };
}

export async function getInboxDashboard(userId: string) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  const scope = await conversationScopeWhere(userId, businessId);

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [
    openCount,
    unreadAgg,
    todayNew,
    todayOutbound,
    resolved,
    byAssignee,
  ] = await Promise.all([
    prisma.whatsAppConversation.count({
      where: {
        ...(scope as object),
        status: { in: ["open", "pending", "follow_up"] },
      } as never,
    }),
    prisma.whatsAppConversation.aggregate({
      where: scope as never,
      _sum: { unreadCount: true },
    }),
    prisma.whatsAppConversation.count({
      where: {
        ...(scope as object),
        createdAt: { gte: start },
      } as never,
    }),
    prisma.whatsAppMessage.count({
      where: {
        businessId,
        direction: "outbound",
        isInternal: false,
        createdAt: { gte: start },
        ...(isAdmin(role) ? {} : { userId }),
      },
    }),
    prisma.whatsAppConversation.count({
      where: {
        ...(scope as object),
        status: { in: ["won", "closed"] },
        updatedAt: { gte: start },
      } as never,
    }),
    isAdmin(role)
      ? prisma.whatsAppConversation.groupBy({
          by: ["assignedToUserId"],
          where: { businessId, assignedToUserId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { assignedToUserId: "desc" } },
          take: 8,
        })
      : Promise.resolve([]),
  ]);

  const assigneeIds = byAssignee
    .map((r) => r.assignedToUserId)
    .filter(Boolean) as string[];
  const users = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  return {
    openConversations: openCount,
    unreadMessages: unreadAgg._sum.unreadCount || 0,
    todayNewChats: todayNew,
    todayReplies: todayOutbound,
    resolvedToday: resolved,
    averageResponseTimeMinutes: null as number | null, // computed offline later
    topExecutives: byAssignee.map((r) => ({
      userId: r.assignedToUserId,
      name:
        uMap.get(r.assignedToUserId || "")?.name ||
        uMap.get(r.assignedToUserId || "")?.email ||
        "Unassigned",
      conversations: r._count._all,
    })),
  };
}

export async function listAssignableAgents(userId: string) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isManager(role)) return [];

  const members = await prisma.businessMember.findMany({
    where: { businessId },
    include: {
      user: {
        select: { id: true, name: true, email: true, isDisabled: true },
      },
    },
  });
  return members
    .filter((m) => m.user && !m.user.isDisabled)
    .map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
}

/** Open or create conversation for a contact (from lead detail) */
export async function openConversationForContact(
  userId: string,
  contactId: string
) {
  const businessId = await requireBusiness(userId);
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, businessId, deletedAt: null },
  });
  if (!contact) throw new Error("Contact not found");
  const phone = normalizeWaPhone(contact.whatsapp || contact.phone || "");
  if (phone.length < 10) throw new Error("Contact has no valid WhatsApp phone");

  const { conversationId } = await upsertConversationForMessage({
    businessId,
    userId,
    phone,
    contactId: contact.id,
    direction: "outbound",
    body: "",
  });

  // Ensure name fields
  if (conversationId) {
    await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        contactName: contact.name,
        company: contact.company,
        contactId: contact.id,
        assignedToUserId: contact.assignedTo || userId,
      },
    });
  }
  return { conversationId, phone };
}
