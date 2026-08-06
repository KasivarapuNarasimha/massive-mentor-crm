import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { getIntegration } from "./integration.service.js";
import { recordAudit } from "./audit.service.js";
import { notifyUser } from "./notification.service.js";
import { env } from "../config/env.js";
import {
  normalizePhoneNumberId,
  normalizeWhatsAppAccessToken,
} from "./whatsapp-token.util.js";

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
  // Tenant credentials only — never fall back to another client's tokens
  const { getWhatsAppIntegrationForTenant } = await import("./integration.service.js");
  const integration =
    (await getWhatsAppIntegrationForTenant(opts.userId)) ||
    (await getIntegration(opts.userId, "whatsapp"));
  const cfg = getWaConfig(integration?.config);

  // Optional env fallback is platform-level only for emergency/dev — not used when tenant configured
  const accessToken = normalizeWhatsAppAccessToken(
    cfg.accessToken ||
      (!integration
        ? (env as { WHATSAPP_ACCESS_TOKEN?: string }).WHATSAPP_ACCESS_TOKEN ||
          process.env.WHATSAPP_ACCESS_TOKEN ||
          ""
        : "")
  );
  const phoneNumberId = normalizePhoneNumberId(
    cfg.phoneNumberId ||
      (!integration ? process.env.WHATSAPP_PHONE_NUMBER_ID || "" : "")
  );
  const apiVersion = (
    cfg.apiVersion ||
    process.env.WHATSAPP_API_VERSION ||
    "v19.0"
  )
    .trim()
    .replace(/^\//, "");

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "WhatsApp Cloud API not configured. Set Integration config (accessToken, phoneNumberId) or WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID env vars. If the token was saved before a key rotation, re-enter it."
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

  // Meta Graph API: exactly one Bearer prefix + raw system-user token (EAA…)
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    let errMsg = json.error?.message || `WhatsApp API error ${res.status}`;
    if (/cannot parse access token|invalid oauth/i.test(errMsg)) {
      errMsg +=
        " — Re-save a permanent System User token from Meta (raw EAA… only, no “Bearer ” prefix).";
    }
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
      messageType: "text",
      waMessageId,
      templateName: opts.templateName || null,
      metadata: json as object,
    },
  });

  // Link to Conversation Center thread
  try {
    const { upsertConversationForMessage } = await import(
      "./whatsapp-inbox.service.js"
    );
    await upsertConversationForMessage({
      businessId,
      userId: opts.userId,
      phone: to,
      contactId: opts.contactId,
      direction: "outbound",
      body: record.body,
      messageId: record.id,
    });
  } catch (e) {
    console.warn("[whatsapp] conversation link failed", e);
  }

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

/**
 * Upload a local file buffer to Meta Cloud API media endpoint, then send as
 * image / document / video to the recipient.
 */
export async function sendWhatsAppMediaFile(opts: {
  userId: string;
  to: string;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string;
  contactId?: string;
  /** image | video | document (pdf/docs) */
  mediaType: "image" | "video" | "document";
}) {
  const businessId = await getUserBusinessId(opts.userId);
  const { getWhatsAppIntegrationForTenant } = await import("./integration.service.js");
  const integration =
    (await getWhatsAppIntegrationForTenant(opts.userId)) ||
    (await getIntegration(opts.userId, "whatsapp"));
  const cfg = getWaConfig(integration?.config);

  const accessToken = normalizeWhatsAppAccessToken(
    cfg.accessToken ||
      (!integration
        ? (env as { WHATSAPP_ACCESS_TOKEN?: string }).WHATSAPP_ACCESS_TOKEN ||
          process.env.WHATSAPP_ACCESS_TOKEN ||
          ""
        : "")
  );
  const phoneNumberId = normalizePhoneNumberId(
    cfg.phoneNumberId ||
      (!integration ? process.env.WHATSAPP_PHONE_NUMBER_ID || "" : "")
  );
  const apiVersion = (
    cfg.apiVersion ||
    process.env.WHATSAPP_API_VERSION ||
    "v19.0"
  )
    .trim()
    .replace(/^\//, "");

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "WhatsApp Cloud API not configured. Set Integration config (accessToken, phoneNumberId)."
    );
  }
  if (integration && !integration.isActive) {
    throw new Error("WhatsApp integration is inactive");
  }

  const to = opts.to.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (to.length < 8) throw new Error("Invalid recipient phone number");

  // 1) Upload media to Meta
  const form = new FormData();
  const bytes = new Uint8Array(opts.buffer);
  const blob = new Blob([bytes], { type: opts.mimeType || "application/octet-stream" });
  form.append("messaging_product", "whatsapp");
  form.append("type", opts.mimeType || "application/octet-stream");
  form.append("file", blob, opts.fileName || "file");

  const uploadUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    body: form,
  });
  const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!uploadRes.ok || !uploadJson.id) {
    throw new Error(
      uploadJson.error?.message || `WhatsApp media upload failed (${uploadRes.status})`
    );
  }

  // 2) Send message referencing media id
  const mediaType = opts.mediaType;
  const mediaBody: Record<string, unknown> = { id: uploadJson.id };
  if (opts.caption?.trim()) mediaBody.caption = opts.caption.trim().slice(0, 1024);
  if (mediaType === "document") mediaBody.filename = opts.fileName || "document.pdf";

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: mediaBody,
  };

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  const captionOrName = opts.caption?.trim() || `[media:${opts.fileName}]`;

  if (!res.ok) {
    const errMsg = json.error?.message || `WhatsApp API error ${res.status}`;
    const failed = await prisma.whatsAppMessage.create({
      data: {
        businessId,
        userId: opts.userId,
        contactId: opts.contactId || null,
        to,
        body: captionOrName,
        direction: "outbound",
        status: "failed",
        error: errMsg,
        metadata: { ...json, mediaId: uploadJson.id, fileName: opts.fileName } as object,
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
      body: captionOrName,
      direction: "outbound",
      status: "sent",
      messageType: mediaType,
      mediaName: opts.fileName,
      mediaMime: opts.mimeType,
      waMessageId,
      metadata: {
        mediaId: uploadJson.id,
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        mediaType,
      } as object,
    },
  });

  try {
    const { upsertConversationForMessage } = await import(
      "./whatsapp-inbox.service.js"
    );
    await upsertConversationForMessage({
      businessId,
      userId: opts.userId,
      phone: to,
      contactId: opts.contactId,
      direction: "outbound",
      body: captionOrName,
      messageId: record.id,
    });
  } catch (e) {
    console.warn("[whatsapp] conversation link failed", e);
  }

  await recordAudit({
    businessId,
    actorUserId: opts.userId,
    action: "whatsapp_media_sent",
    entityType: "whatsapp_message",
    entityId: record.id,
    metadata: { to, waMessageId, fileName: opts.fileName, mediaType },
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
  // Keep Media Library send history in sync with delivery receipts
  await prisma.mediaSendLog
    .updateMany({
      where: { waMessageId: payload.id },
      data: {
        status,
        error: payload.errors?.[0]?.message || null,
        updatedAt: new Date(),
      },
    })
    .catch(() => undefined);
  return updated;
}

export async function recordInboundWhatsApp(opts: {
  userId: string;
  from: string;
  body: string;
  waMessageId?: string;
  contactId?: string;
  messageType?: string;
  mediaUrl?: string;
  mediaMime?: string;
  mediaName?: string;
  businessId?: string | null;
}) {
  const businessId =
    opts.businessId || (await getUserBusinessId(opts.userId));
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
      messageType: opts.messageType || "text",
      mediaUrl: opts.mediaUrl || null,
      mediaMime: opts.mediaMime || null,
      mediaName: opts.mediaName || null,
      waMessageId: opts.waMessageId || null,
    },
  });

  let conversationId = "";
  try {
    const { upsertConversationForMessage } = await import(
      "./whatsapp-inbox.service.js"
    );
    const linked = await upsertConversationForMessage({
      businessId,
      userId: opts.userId,
      phone: opts.from,
      contactId: opts.contactId,
      direction: "inbound",
      body: opts.body,
      messageId: msg.id,
    });
    conversationId = linked.conversationId;
  } catch (e) {
    console.warn("[whatsapp] inbound conversation link failed", e);
  }

  // Notify assigned agent when known
  let notifyTarget = opts.userId;
  if (conversationId) {
    const conv = await prisma.whatsAppConversation.findUnique({
      where: { id: conversationId },
      select: { assignedToUserId: true },
    });
    if (conv?.assignedToUserId) notifyTarget = conv.assignedToUserId;
  }

  await notifyUser(notifyTarget, {
    type: "integration",
    title: "WhatsApp message received",
    message: opts.body.slice(0, 120),
    entityType: "whatsapp_conversation",
    entityId: conversationId || msg.id,
  });
  return msg;
}
