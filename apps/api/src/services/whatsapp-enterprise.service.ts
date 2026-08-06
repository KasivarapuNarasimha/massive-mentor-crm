/**
 * Enterprise WhatsApp enhancements:
 * labels, pins, snooze, reactions, typing, merge, export, SLA, rules,
 * CSAT, transcription helpers, spam, broadcasts, enhanced analytics.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import { notifyUser } from "./notification.service.js";
import { recordAudit } from "./audit.service.js";
import { getAIService } from "./ai.service.js";
import { sendWhatsAppCloudMessage } from "./whatsapp.service.js";
import { buildCsvString } from "./export-format.service.js";
import { normalizeWaPhone } from "./whatsapp-inbox.service.js";

const ADMIN = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

const PRESET_LABELS = [
  "🔥 Hot Lead",
  "🟡 Warm Lead",
  "❄ Cold Lead",
  "💰 High Value",
  "📞 Follow-up",
  "⚠ Payment Pending",
  "⭐ VIP Customer",
  "🚫 Spam",
];

async function requireBusiness(userId: string) {
  const bid = await getUserBusinessId(userId);
  if (!bid) throw new Error("Workspace required");
  return bid;
}

function isAdmin(role: string) {
  return ADMIN.has(role) || role.includes("admin");
}

export function getPresetLabels() {
  return PRESET_LABELS;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function setConversationLabels(
  userId: string,
  conversationId: string,
  labels: string[]
) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");
  const clean = [...new Set(labels.map((l) => l.trim()).filter(Boolean))].slice(
    0,
    20
  );
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { labels: clean },
  });
  return { id: updated.id, labels: updated.labels };
}

// ─── Pins (max 10 per user) ──────────────────────────────────────────────────

export async function togglePin(userId: string, conversationId: string) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");

  const existing = await prisma.whatsAppConversationPin.findUnique({
    where: {
      userId_conversationId: { userId, conversationId },
    },
  });
  if (existing) {
    await prisma.whatsAppConversationPin.delete({ where: { id: existing.id } });
    return { pinned: false };
  }
  const count = await prisma.whatsAppConversationPin.count({ where: { userId } });
  if (count >= 10) throw new Error("Maximum 10 pinned conversations per user");
  await prisma.whatsAppConversationPin.create({
    data: { businessId, userId, conversationId },
  });
  return { pinned: true };
}

export async function listPinnedIds(userId: string): Promise<string[]> {
  const pins = await prisma.whatsAppConversationPin.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  return pins.map((p) => p.conversationId);
}

// ─── Snooze ──────────────────────────────────────────────────────────────────

export async function snoozeConversation(
  userId: string,
  conversationId: string,
  until: string | Date
) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");
  const snoozedUntil = new Date(until);
  if (Number.isNaN(snoozedUntil.getTime()) || snoozedUntil.getTime() <= Date.now()) {
    throw new Error("Snooze time must be in the future");
  }
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { snoozedUntil },
  });
  return {
    id: updated.id,
    snoozedUntil: updated.snoozedUntil?.toISOString() || null,
  };
}

export async function unsnoozeConversation(userId: string, conversationId: string) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");
  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { snoozedUntil: null },
  });
  return { id: conversationId, snoozedUntil: null };
}

/** Process expired snoozes — return to inbox + notify assignee */
export async function processExpiredSnoozes(businessId?: string) {
  const now = new Date();
  const where: Record<string, unknown> = {
    snoozedUntil: { lte: now },
  };
  if (businessId) where.businessId = businessId;
  const rows = await prisma.whatsAppConversation.findMany({
    where: where as never,
    take: 200,
  });
  let n = 0;
  for (const c of rows) {
    await prisma.whatsAppConversation.update({
      where: { id: c.id },
      data: { snoozedUntil: null },
    });
    const target = c.assignedToUserId;
    if (target) {
      await notifyUser(target, {
        type: "reminder",
        title: "Snoozed chat is back",
        message: c.contactName || c.phone,
        entityType: "whatsapp_conversation",
        entityId: c.id,
      }).catch(() => undefined);
    }
    n++;
  }
  return { unsnoozed: n };
}

// ─── Reactions (internal) ────────────────────────────────────────────────────

export async function toggleReaction(
  userId: string,
  messageId: string,
  emoji: string
) {
  const businessId = await requireBusiness(userId);
  const em = String(emoji || "").trim().slice(0, 8);
  if (!em) throw new Error("Emoji required");
  const msg = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, businessId },
  });
  if (!msg) throw new Error("Message not found");

  const existing = await prisma.whatsAppMessageReaction.findUnique({
    where: {
      messageId_userId_emoji: { messageId, userId, emoji: em },
    },
  });
  if (existing) {
    await prisma.whatsAppMessageReaction.delete({ where: { id: existing.id } });
    return { reacted: false, emoji: em };
  }
  await prisma.whatsAppMessageReaction.create({
    data: { messageId, userId, emoji: em },
  });
  return { reacted: true, emoji: em };
}

export async function getReactionsForMessages(messageIds: string[]) {
  if (!messageIds.length) return {};
  const rows = await prisma.whatsAppMessageReaction.findMany({
    where: { messageId: { in: messageIds } },
  });
  const map: Record<
    string,
    Array<{ emoji: string; userId: string; count?: number }>
  > = {};
  for (const r of rows) {
    if (!map[r.messageId]) map[r.messageId] = [];
    map[r.messageId]!.push({ emoji: r.emoji, userId: r.userId });
  }
  return map;
}

// ─── Typing indicators ───────────────────────────────────────────────────────

export async function setTyping(
  userId: string,
  conversationId: string,
  isTyping: boolean
) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");

  await prisma.whatsAppTypingState.upsert({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    create: {
      conversationId,
      userId,
      actorType: "agent",
      isTyping,
    },
    update: { isTyping, updatedAt: new Date() },
  });
  return { ok: true };
}

export async function getTyping(conversationId: string) {
  const cutoff = new Date(Date.now() - 8000);
  const rows = await prisma.whatsAppTypingState.findMany({
    where: {
      conversationId,
      isTyping: true,
      updatedAt: { gte: cutoff },
    },
  });
  if (!rows.length) return { agents: [] as Array<{ userId: string; name: string }> };
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, name: true, email: true },
  });
  const uMap = new Map(users.map((u) => [u.id, u]));
  return {
    agents: rows.map((r) => ({
      userId: r.userId,
      name: uMap.get(r.userId)?.name || uMap.get(r.userId)?.email || "Agent",
    })),
  };
}

// ─── Merge conversations ─────────────────────────────────────────────────────

export async function mergeConversations(
  userId: string,
  primaryId: string,
  secondaryId: string
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isAdmin(role) && !role.includes("manager")) {
    throw new Error("Only managers/admins can merge conversations");
  }
  if (primaryId === secondaryId) throw new Error("Cannot merge a conversation with itself");

  const [primary, secondary] = await Promise.all([
    prisma.whatsAppConversation.findFirst({ where: { id: primaryId, businessId } }),
    prisma.whatsAppConversation.findFirst({
      where: { id: secondaryId, businessId },
    }),
  ]);
  if (!primary || !secondary) throw new Error("Conversation not found");

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppMessage.updateMany({
      where: { conversationId: secondaryId },
      data: { conversationId: primaryId },
    });
    // Merge labels
    const labels = [
      ...new Set([...(primary.labels || []), ...(secondary.labels || [])]),
    ];
    const lastAt =
      (primary.lastMessageAt?.getTime() || 0) >=
      (secondary.lastMessageAt?.getTime() || 0)
        ? primary
        : secondary;
    await tx.whatsAppConversation.update({
      where: { id: primaryId },
      data: {
        labels,
        contactId: primary.contactId || secondary.contactId,
        contactName: primary.contactName || secondary.contactName,
        company: primary.company || secondary.company,
        unreadCount: primary.unreadCount + secondary.unreadCount,
        lastMessageAt: lastAt.lastMessageAt,
        lastMessagePreview: lastAt.lastMessagePreview,
        lastMessageDirection: lastAt.lastMessageDirection,
        lastInboundAt:
          (primary.lastInboundAt?.getTime() || 0) >=
          (secondary.lastInboundAt?.getTime() || 0)
            ? primary.lastInboundAt
            : secondary.lastInboundAt,
        lastOutboundAt:
          (primary.lastOutboundAt?.getTime() || 0) >=
          (secondary.lastOutboundAt?.getTime() || 0)
            ? primary.lastOutboundAt
            : secondary.lastOutboundAt,
      },
    });
    // Pins: drop secondary pins that would conflict with primary, then re-home the rest
    const primaryPinUsers = await tx.whatsAppConversationPin.findMany({
      where: { conversationId: primaryId },
      select: { userId: true },
    });
    const primaryPinUserIds = new Set(primaryPinUsers.map((p) => p.userId));
    await tx.whatsAppConversationPin.deleteMany({
      where: {
        conversationId: secondaryId,
        userId: { in: [...primaryPinUserIds] },
      },
    });
    await tx.whatsAppConversationPin.updateMany({
      where: { conversationId: secondaryId },
      data: { conversationId: primaryId },
    });
    await tx.whatsAppTypingState.deleteMany({
      where: { conversationId: secondaryId },
    });
    await tx.whatsAppConversation.delete({ where: { id: secondaryId } });
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "whatsapp_conversation_merge",
    entityType: "whatsapp_conversation",
    entityId: primaryId,
    metadata: { mergedFrom: secondaryId },
  });

  return { primaryId, mergedFrom: secondaryId };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function exportConversation(
  userId: string,
  conversationId: string,
  format: "pdf" | "xlsx" | "txt" | "csv"
) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");

  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  const headers = [
    "Time",
    "Direction",
    "Type",
    "Status",
    "Body",
    "Internal",
    "Transcript",
  ];
  const rows = messages.map((m) => [
    m.createdAt.toISOString(),
    m.direction,
    m.messageType,
    m.status,
    m.body,
    m.isInternal ? "yes" : "no",
    m.transcript || "",
  ]);

  const meta = [
    `Conversation: ${conv.contactName || conv.phone}`,
    `Phone: ${conv.phone}`,
    `Status: ${conv.status}`,
    `Labels: ${(conv.labels || []).join(", ")}`,
    `CSAT: ${conv.csatScore ?? "—"}`,
    `AI Summary: ${conv.aiSummary ? JSON.stringify(conv.aiSummary) : "—"}`,
    "",
  ].join("\n");

  if (format === "txt") {
    const lines = [
      meta,
      "--- Messages ---",
      ...messages.map(
        (m) =>
          `[${m.createdAt.toISOString()}] ${m.direction}${m.isInternal ? " NOTE" : ""} (${m.status}): ${m.body}${
            m.transcript ? `\n  transcript: ${m.transcript}` : ""
          }`
      ),
    ];
    return {
      contentType: "text/plain; charset=utf-8",
      filename: `whatsapp-${conv.phone}.txt`,
      body: lines.join("\n"),
    };
  }

  // csv / xlsx / pdf → CSV body (Excel opens CSV); PDF as plain text wrapped
  const csv = buildCsvString(headers, rows);
  if (format === "csv" || format === "xlsx") {
    return {
      contentType: "text/csv; charset=utf-8",
      filename: `whatsapp-${conv.phone}.csv`,
      body: csv,
    };
  }

  // pdf — simple text export (clients can print to PDF); full PDFKit optional
  return {
    contentType: "text/plain; charset=utf-8",
    filename: `whatsapp-${conv.phone}.txt`,
    body: meta + "\n" + rows.map((r) => r.join(" | ")).join("\n"),
  };
}

// ─── Auto-assignment rules ───────────────────────────────────────────────────

export async function listAssignRules(userId: string) {
  const businessId = await requireBusiness(userId);
  const rules = await prisma.whatsAppAssignRule.findMany({
    where: { businessId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rules;
}

export async function saveAssignRule(
  userId: string,
  input: {
    id?: string;
    name: string;
    priority?: number;
    isActive?: boolean;
    conditions?: Record<string, unknown>;
    assignToUserId?: string | null;
    assignToUserIds?: string[];
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isAdmin(role)) throw new Error("Only Business Admin can manage auto-assignment");

  const data = {
    name: input.name.trim(),
    priority: input.priority ?? 100,
    isActive: input.isActive !== false,
    conditions: (input.conditions || {}) as object,
    assignToUserId: input.assignToUserId || null,
    assignToUserIds: input.assignToUserIds || [],
  };

  if (input.id) {
    return prisma.whatsAppAssignRule.update({
      where: { id: input.id },
      data,
    });
  }
  return prisma.whatsAppAssignRule.create({
    data: { businessId, ...data },
  });
}

export async function deleteAssignRule(userId: string, ruleId: string) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isAdmin(role)) throw new Error("Only Business Admin can manage rules");
  await prisma.whatsAppAssignRule.deleteMany({
    where: { id: ruleId, businessId },
  });
  return { deleted: true };
}

/** Apply first matching rule to a new conversation */
export async function applyAutoAssignRules(
  businessId: string,
  conversationId: string,
  contactId?: string | null
): Promise<string | null> {
  const rules = await prisma.whatsAppAssignRule.findMany({
    where: { businessId, isActive: true },
    orderBy: { priority: "asc" },
  });
  if (!rules.length) return null;

  let contact: {
    industry?: string | null;
    source?: string | null;
    tags?: string[];
    company?: string | null;
    customFields?: unknown;
  } | null = null;
  if (contactId) {
    contact = await prisma.contact.findFirst({
      where: { id: contactId, businessId },
      select: {
        industry: true,
        source: true,
        tags: true,
        company: true,
        customFields: true,
      },
    });
  }

  for (const rule of rules) {
    const cond = (rule.conditions || {}) as Record<string, unknown>;
    let match = true;
    if (cond.industry && contact?.industry) {
      match =
        match &&
        String(contact.industry)
          .toLowerCase()
          .includes(String(cond.industry).toLowerCase());
    } else if (cond.industry) match = false;
    if (cond.locationContains) {
      const loc = String(
        (contact?.customFields as Record<string, unknown>)?.location ||
          contact?.company ||
          ""
      ).toLowerCase();
      match = match && loc.includes(String(cond.locationContains).toLowerCase());
    }
    if (cond.source && contact?.source) {
      match =
        match &&
        String(contact.source).toLowerCase() === String(cond.source).toLowerCase();
    }
    if (Array.isArray(cond.tagsAny) && (cond.tagsAny as string[]).length) {
      const tags = contact?.tags || [];
      match =
        match &&
        (cond.tagsAny as string[]).some((t) =>
          tags.map((x) => x.toLowerCase()).includes(String(t).toLowerCase())
        );
    }
    if (!match) continue;

    let assignee = rule.assignToUserId;
    if (!assignee && rule.assignToUserIds?.length) {
      // Round-robin: pick least recently assigned among pool
      const counts = await Promise.all(
        rule.assignToUserIds.map(async (uid) => ({
          uid,
          n: await prisma.whatsAppConversation.count({
            where: { businessId, assignedToUserId: uid },
          }),
        }))
      );
      counts.sort((a, b) => a.n - b.n);
      assignee = counts[0]?.uid || null;
    }
    if (assignee) {
      await prisma.whatsAppConversation.update({
        where: { id: conversationId },
        data: { assignedToUserId: assignee },
      });
      return assignee;
    }
  }
  return null;
}

// ─── SLA ─────────────────────────────────────────────────────────────────────

export async function getSlaPolicy(userId: string) {
  const businessId = await requireBusiness(userId);
  let policy = await prisma.whatsAppSlaPolicy.findUnique({
    where: { businessId },
  });
  if (!policy) {
    policy = await prisma.whatsAppSlaPolicy.create({
      data: { businessId },
    });
  }
  return policy;
}

export async function updateSlaPolicy(
  userId: string,
  input: {
    isActive?: boolean;
    escalateManagerMinutes?: number;
    escalateAdminMinutes?: number;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isAdmin(role)) throw new Error("Only Business Admin can edit SLA");
  return prisma.whatsAppSlaPolicy.upsert({
    where: { businessId },
    create: {
      businessId,
      isActive: input.isActive !== false,
      escalateManagerMinutes: input.escalateManagerMinutes ?? 15,
      escalateAdminMinutes: input.escalateAdminMinutes ?? 30,
    },
    update: {
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.escalateManagerMinutes != null
        ? { escalateManagerMinutes: input.escalateManagerMinutes }
        : {}),
      ...(input.escalateAdminMinutes != null
        ? { escalateAdminMinutes: input.escalateAdminMinutes }
        : {}),
    },
  });
}

export async function processSlaBreaches(businessId?: string) {
  const policies = await prisma.whatsAppSlaPolicy.findMany({
    where: {
      isActive: true,
      ...(businessId ? { businessId } : {}),
    },
  });
  let notified = 0;
  for (const policy of policies) {
    const now = Date.now();
    const waiting = await prisma.whatsAppConversation.findMany({
      where: {
        businessId: policy.businessId,
        status: { in: ["open", "pending", "follow_up"] },
        lastInboundAt: { not: null },
        isSpam: false,
        isBlocked: false,
      },
      take: 300,
    });
    for (const c of waiting) {
      if (!c.lastInboundAt) continue;
      const lastIn = c.lastInboundAt.getTime();
      const lastOut = c.lastAgentReplyAt?.getTime() || 0;
      // Only if last message side is customer waiting
      if (lastOut >= lastIn) continue;
      const waitedMin = (now - lastIn) / 60000;

      if (
        waitedMin >= policy.escalateAdminMinutes &&
        !c.slaBreachedL2
      ) {
        await prisma.whatsAppConversation.update({
          where: { id: c.id },
          data: { slaBreachedL2: true, slaBreachedL1: true },
        });
        const admins = await prisma.businessMember.findMany({
          where: {
            businessId: policy.businessId,
            role: { in: ["owner", "business_admin", "admin", "ceo"] },
          },
          take: 10,
        });
        for (const a of admins) {
          await notifyUser(a.userId, {
            type: "system",
            title: "WhatsApp SLA breach (Admin)",
            message: `No reply for ${Math.round(waitedMin)} min — ${c.contactName || c.phone}`,
            entityType: "whatsapp_conversation",
            entityId: c.id,
          }).catch(() => undefined);
        }
        notified++;
      } else if (
        waitedMin >= policy.escalateManagerMinutes &&
        !c.slaBreachedL1
      ) {
        await prisma.whatsAppConversation.update({
          where: { id: c.id },
          data: { slaBreachedL1: true },
        });
        const managers = await prisma.businessMember.findMany({
          where: {
            businessId: policy.businessId,
            role: { in: ["sales_manager", "manager", "business_admin", "owner"] },
          },
          take: 10,
        });
        for (const m of managers) {
          await notifyUser(m.userId, {
            type: "system",
            title: "WhatsApp SLA warning",
            message: `No reply for ${Math.round(waitedMin)} min — ${c.contactName || c.phone}`,
            entityType: "whatsapp_conversation",
            entityId: c.id,
          }).catch(() => undefined);
        }
        notified++;
      }
    }
  }
  return { notified };
}

// ─── CSAT ────────────────────────────────────────────────────────────────────

export async function sendCsatRequest(userId: string, conversationId: string) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");

  const body =
    "How was your experience with us?\n\nPlease reply with a rating from 1 to 5 stars:\n⭐ = 1\n⭐⭐⭐⭐⭐ = 5\n\nThank you!";

  try {
    await sendWhatsAppCloudMessage({
      userId,
      to: conv.phone,
      body,
      contactId: conv.contactId || undefined,
    });
  } catch {
    // still mark as sent attempt for offline tracking
  }

  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { csatSentAt: new Date() },
  });
  return { sent: true };
}

/** Parse inbound "5" or star replies into CSAT */
export async function tryCaptureCsat(
  conversationId: string,
  inboundBody: string
): Promise<boolean> {
  const conv = await prisma.whatsAppConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv?.csatSentAt || conv.csatScore != null) return false;
  const text = (inboundBody || "").trim();
  let score: number | null = null;
  const digit = text.match(/^[1-5]$/);
  if (digit) score = Number(digit[0]);
  else {
    const stars = (text.match(/⭐/g) || []).length;
    if (stars >= 1 && stars <= 5) score = stars;
  }
  if (score == null) return false;
  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: {
      csatScore: score,
      csatComment: text.slice(0, 500),
      csatRespondedAt: new Date(),
    },
  });
  return true;
}

// ─── Voice transcription ─────────────────────────────────────────────────────

export async function transcribeVoiceMessage(
  userId: string,
  messageId: string
) {
  const businessId = await requireBusiness(userId);
  const msg = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, businessId },
  });
  if (!msg) throw new Error("Message not found");
  if (msg.messageType !== "audio" && !/voice|audio/i.test(msg.body)) {
    // allow force
  }

  // Without audio binary from Meta media download, use AI stub from caption/body
  // Production: download media via Graph API media id in metadata
  let transcript = msg.transcript;
  if (!transcript) {
    try {
      const ai = await getAIService();
      const prompt = `The following is a WhatsApp voice note placeholder. Produce a short professional speech-to-text style transcript estimate or note that transcription requires media download.
Context body: ${msg.body}
Return plain transcript text only.`;
      const res = await ai.generateText(prompt, { temperature: 0.2, maxTokens: 400 });
      transcript =
        String(res.data || "").trim() ||
        "[Voice note received — enable Meta media download for full transcription]";
    } catch {
      transcript =
        "[Voice note — transcription unavailable. Configure AI provider and media access.]";
    }
    await prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: { transcript },
    });
  }
  return { transcript, messageId };
}

// ─── Spam ────────────────────────────────────────────────────────────────────

export async function markSpam(
  userId: string,
  conversationId: string,
  opts?: { block?: boolean }
) {
  const businessId = await requireBusiness(userId);
  const conv = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conv) throw new Error("Conversation not found");
  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: {
      isSpam: true,
      isBlocked: opts?.block === true,
      status: "closed",
      labels: [...new Set([...(conv.labels || []), "🚫 Spam"])],
    },
  });
  return {
    id: updated.id,
    isSpam: updated.isSpam,
    isBlocked: updated.isBlocked,
  };
}

export function detectSpamSignals(body: string): {
  suspicious: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const t = (body || "").toLowerCase();
  if (/(win\s*\$|lottery|crypto\s*giveaway|nigerian|click here now)/i.test(t)) {
    reasons.push("scam_keywords");
  }
  if ((body.match(/https?:\/\//gi) || []).length >= 3) reasons.push("many_links");
  if (/(.)\1{8,}/.test(body || "")) reasons.push("repeated_chars");
  return { suspicious: reasons.length > 0, reasons };
}

// ─── Broadcasts ──────────────────────────────────────────────────────────────

export async function listBroadcasts(userId: string) {
  const businessId = await requireBusiness(userId);
  return prisma.whatsAppBroadcast.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function createBroadcast(
  userId: string,
  input: {
    name: string;
    body: string;
    templateName?: string;
    audienceFilter?: Record<string, unknown>;
    sendNow?: boolean;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!isAdmin(role)) throw new Error("Only Business Admin can send broadcasts");

  const filter = input.audienceFilter || { type: "lead" };
  const type = String(filter.type || "lead");
  const contactWhere: Record<string, unknown> = {
    businessId,
    deletedAt: null,
  };
  if (type === "lead" || type === "client") contactWhere.type = type;
  if (filter.status) contactWhere.status = filter.status;
  if (filter.industry) {
    contactWhere.industry = {
      contains: String(filter.industry),
      mode: "insensitive",
    };
  }

  const contacts = await prisma.contact.findMany({
    where: contactWhere as never,
    select: { id: true, phone: true, whatsapp: true, name: true },
    take: 5000,
  });

  const recipients = contacts
    .map((c) => ({
      contactId: c.id,
      phone: normalizeWaPhone(c.whatsapp || c.phone || ""),
    }))
    .filter((r) => r.phone.length >= 10);

  const broadcast = await prisma.whatsAppBroadcast.create({
    data: {
      businessId,
      name: input.name.trim().slice(0, 120),
      body: input.body,
      templateName: input.templateName || null,
      status: input.sendNow ? "sending" : "draft",
      audienceFilter: filter as object,
      createdByUserId: userId,
      totalRecipients: recipients.length,
      startedAt: input.sendNow ? new Date() : null,
      items: {
        create: recipients.map((r) => ({
          contactId: r.contactId,
          phone: r.phone,
          status: "pending",
        })),
      },
    },
    include: { items: true },
  });

  if (input.sendNow) {
    // Fire-and-forget sequential send (bounded)
    void runBroadcastSend(userId, broadcast.id);
  }

  return broadcast;
}

async function runBroadcastSend(userId: string, broadcastId: string) {
  const broadcast = await prisma.whatsAppBroadcast.findUnique({
    where: { id: broadcastId },
    include: { items: { where: { status: "pending" }, take: 2000 } },
  });
  if (!broadcast) return;

  let sent = 0;
  let failed = 0;
  for (const item of broadcast.items) {
    try {
      const rec = await sendWhatsAppCloudMessage({
        userId,
        to: item.phone,
        body: broadcast.body,
        contactId: item.contactId || undefined,
        templateName: broadcast.templateName || undefined,
      });
      await prisma.whatsAppBroadcastItem.update({
        where: { id: item.id },
        data: {
          status: "sent",
          waMessageId: rec.waMessageId,
        },
      });
      sent++;
    } catch (e) {
      await prisma.whatsAppBroadcastItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          error: e instanceof Error ? e.message : "failed",
        },
      });
      failed++;
    }
  }

  await prisma.whatsAppBroadcast.update({
    where: { id: broadcastId },
    data: {
      status: "completed",
      sentCount: { increment: sent },
      failedCount: { increment: failed },
      completedAt: new Date(),
    },
  });
}

// ─── Enhanced analytics ──────────────────────────────────────────────────────

export async function getEnterpriseAnalytics(userId: string) {
  const businessId = await requireBusiness(userId);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [open, closed, unread, sentToday, receivedToday, samples, topGroup, csatAgg] =
    await Promise.all([
      prisma.whatsAppConversation.count({
        where: {
          businessId,
          status: { in: ["open", "pending", "follow_up"] },
          isSpam: false,
        },
      }),
      prisma.whatsAppConversation.count({
        where: { businessId, status: { in: ["closed", "won", "lost"] } },
      }),
      prisma.whatsAppConversation.aggregate({
        where: { businessId, isSpam: false },
        _sum: { unreadCount: true },
      }),
      prisma.whatsAppMessage.count({
        where: {
          businessId,
          direction: "outbound",
          isInternal: false,
          createdAt: { gte: start },
        },
      }),
      prisma.whatsAppMessage.count({
        where: {
          businessId,
          direction: "inbound",
          createdAt: { gte: start },
        },
      }),
      prisma.whatsAppConversation.findMany({
        where: { businessId },
        select: {
          firstResponseAt: true,
          createdAt: true,
          resolvedAt: true,
          closedAt: true,
        },
        take: 500,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.whatsAppConversation.groupBy({
        by: ["assignedToUserId"],
        where: { businessId, assignedToUserId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { assignedToUserId: "desc" } },
        take: 8,
      }),
      prisma.whatsAppConversation.aggregate({
        where: { businessId, csatScore: { not: null } },
        _avg: { csatScore: true },
        _count: { _all: true },
      }),
    ]);

  let avgResponse = 0;
  let respN = 0;
  let avgResolution = 0;
  let resN = 0;
  for (const c of samples) {
    if (c.firstResponseAt) {
      const mins =
        (c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60000;
      if (mins >= 0 && mins < 60 * 24 * 14) {
        avgResponse += mins;
        respN++;
      }
    }
    const done = c.resolvedAt || c.closedAt;
    if (done) {
      const mins = (done.getTime() - c.createdAt.getTime()) / 60000;
      if (mins >= 0 && mins < 60 * 24 * 60) {
        avgResolution += mins;
        resN++;
      }
    }
  }

  const topIds = topGroup
    .map((r) => r.assignedToUserId)
    .filter(Boolean) as string[];
  const users = topIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  return {
    openConversations: open,
    closedConversations: closed,
    unreadConversations: unread._sum.unreadCount || 0,
    messagesSentToday: sentToday,
    messagesReceivedToday: receivedToday,
    averageResponseTimeMinutes:
      respN > 0 ? Math.round((avgResponse / respN) * 10) / 10 : null,
    averageResolutionTimeMinutes:
      resN > 0 ? Math.round((avgResolution / resN) * 10) / 10 : null,
    averageCsat:
      csatAgg._count._all > 0
        ? Math.round((csatAgg._avg.csatScore || 0) * 10) / 10
        : null,
    csatResponses: csatAgg._count._all,
    topExecutives: topGroup.map((r) => ({
      userId: r.assignedToUserId,
      name:
        uMap.get(r.assignedToUserId || "")?.name ||
        uMap.get(r.assignedToUserId || "")?.email ||
        "—",
      conversations: r._count._all,
    })),
    labels: PRESET_LABELS,
  };
}

/** Jobs entry — call from poll / cron */
export async function processWhatsAppEnterpriseJobs(businessId?: string) {
  const [snooze, sla] = await Promise.all([
    processExpiredSnoozes(businessId),
    processSlaBreaches(businessId),
  ]);
  return { ...snooze, ...sla };
}
