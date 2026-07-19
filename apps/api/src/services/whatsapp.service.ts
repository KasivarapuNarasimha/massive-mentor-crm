import { prisma } from "@/lib/prisma";
import { getUserBusinessId } from "@/services/field-engine.service";
import { getIntegration } from "@/services/integration.service";
import { recordAudit } from "@/services/audit.service";
import { notifyUser } from "@/services/notification.service";
import { env } from "@/config/env";

type WaConfig = {
  accessToken?: string;
  phoneNumberId?: string;
  apiVersion?: string;
  /** Optional default template name for marketing/follow-up */
  defaultTemplate?: string;
};

function getWaConfig(raw: unknown): WaConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as WaConfig;
}

/**
 * Send a WhatsApp text message via Meta Cloud API.
 * Requires Integration provider=whatsapp with { accessToken, phoneNumberId }.
 * Falls back to env WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID if set.
 */
export async function sendWhatsAppCloudMessage(opts: {
  userId: string;
  to: string;
  body: string;
  contactId?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}) {
  const businessId = await getUserBusinessId(opts.userId);
  const integration = await getIntegration(opts.userId, "whatsapp");
  const cfg = getWaConfig(integration?.config);

  const accessToken =
    cfg.accessToken ||
    (env as { WHATSAPP_ACCESS_TOKEN?: string }).WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId =
    cfg.phoneNumberId ||
    process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = cfg.apiVersion || process.env.WHATSAPP_API_VERSION || "v19.0";

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "WhatsApp Cloud API not configured. Set Integration config (accessToken, phoneNumberId) or WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID env vars."
    );
  }

  if (!integration?.isActive && integration) {
    throw new Error("WhatsApp integration is inactive");
  }

  const to = opts.to.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (to.length < 8) throw new Error("Invalid recipient phone number");

  let payload: Record<string, unknown>;
  if (opts.templateName) {
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: opts.templateName,
        language: { code: opts.templateLanguage || "en" },
        components: opts.templateParams?.length
          ? [
              {
                type: "body",
                parameters: opts.templateParams.map((t) => ({ type: "text", text: t })),
              },
            ]
          : undefined,
      },
    };
  } else {
    if (!opts.body?.trim()) throw new Error("Message body is required");
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: opts.body.trim(), preview_url: false },
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    const errMsg = json.error?.message || `WhatsApp API error ${res.status}`;
    const failed = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        userId: opts.userId,
        contactId: opts.contactId || null,
        to,
        body: opts.body || opts.templateName || "",
        direction: "outbound",
        status: "failed",
        templateName: opts.templateName || null,
        error: errMsg,
        metadata: json as object,
      },
    });
    throw new Error(errMsg + ` (message ${failed.id})`);
  }

  const waMessageId = json.messages?.[0]?.id || null;
  const record = await prisma.whatsAppMessage.create({
    data: {
      businessId,
      userId: opts.userId,
      contactId: opts.contactId || null,
      to,
      body: opts.body || `[template:${opts.templateName}]`,
      direction: "outbound",
      status: "sent",
      waMessageId,
      templateName: opts.templateName || null,
      metadata: json as object,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: opts.userId,
    action: "ai",
    entityType: "whatsapp_message",
    entityId: record.id,
    metadata: { to, waMessageId, templateName: opts.templateName },
  });

  return record;
}

export async function listWhatsAppHistory(
  userId: string,
  opts?: { contactId?: string; to?: string; page?: number; pageSize?: number }
) {
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(100, opts.pageSize) : 50;
  const where: Record<string, unknown> = { userId };
  if (opts?.contactId) where.contactId = opts.contactId;
  if (opts?.to) where.to = opts.to.replace(/[^\d]/g, "");

  const [total, items] = await Promise.all([
    prisma.whatsAppMessage.count({ where: where as never }),
    prisma.whatsAppMessage.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Update delivery/read status from webhook payload (Cloud API statuses array).
 */
export async function applyWhatsAppStatusUpdate(payload: {
  id?: string;
  status?: string;
  errors?: Array<{ message?: string }>;
}) {
  if (!payload.id || !payload.status) return null;
  const statusMap: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };
  const status = statusMap[payload.status] || payload.status;
  const updated = await prisma.whatsAppMessage.updateMany({
    where: { waMessageId: payload.id },
    data: {
      status,
      error: payload.errors?.[0]?.message || null,
      updatedAt: new Date(),
    },
  });
  return updated;
}

export async function recordInboundWhatsApp(opts: {
  userId: string;
  from: string;
  body: string;
  waMessageId?: string;
  contactId?: string;
}) {
  const businessId = await getUserBusinessId(opts.userId);
  const msg = await prisma.whatsAppMessage.create({
    data: {
      businessId,
      userId: opts.userId,
      contactId: opts.contactId || null,
      to: opts.from,
      from: opts.from,
      body: opts.body,
      direction: "inbound",
      status: "delivered",
      waMessageId: opts.waMessageId || null,
    },
  });
  await notifyUser(opts.userId, {
    type: "integration",
    title: "WhatsApp message received",
    message: opts.body.slice(0, 120),
    entityType: "whatsapp_message",
    entityId: msg.id,
  });
  return msg;
}
