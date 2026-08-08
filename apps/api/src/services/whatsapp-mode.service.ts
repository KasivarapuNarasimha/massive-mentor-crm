/**
 * WhatsApp Basic Mode (default) vs Enterprise Cloud API.
 * Basic: wa.me deep link — no Meta credentials required.
 * Enterprise: Meta Cloud API automatic send.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import {
  getIntegration,
  getWhatsAppIntegrationForTenant,
} from "./integration.service.js";
import {
  normalizePhoneNumberId,
  normalizeWhatsAppAccessToken,
} from "./whatsapp-token.util.js";
import { logActivity } from "./activity.service.js";
import { recordAudit } from "./audit.service.js";
import { notifyUser } from "./notification.service.js";

export type WhatsAppPreferredMode = "basic" | "enterprise";
export type WhatsAppEffectiveMode = "basic" | "enterprise";

function digitsPhone(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

export async function isEnterpriseCloudConnected(userId: string): Promise<boolean> {
  const int =
    (await getWhatsAppIntegrationForTenant(userId)) ||
    (await getIntegration(userId, "whatsapp"));
  if (!int?.isActive) return false;
  const cfg = (int.config || {}) as Record<string, unknown>;
  const token = normalizeWhatsAppAccessToken(String(cfg.accessToken || ""));
  const phoneId = normalizePhoneNumberId(String(cfg.phoneNumberId || ""));
  if (!token || !phoneId) return false;
  // Invalid / error status → treat as not connected (fall back to basic)
  const status = String(int.status || "").toLowerCase();
  if (status === "error" || status === "invalid_token" || status === "invalid") {
    return false;
  }
  return true;
}

export async function getPreferredWhatsAppMode(
  userId: string
): Promise<WhatsAppPreferredMode> {
  const int =
    (await getWhatsAppIntegrationForTenant(userId)) ||
    (await getIntegration(userId, "whatsapp"));
  const cfg = (int?.config || {}) as Record<string, unknown>;
  const pref = String(cfg.preferredMode || "basic").toLowerCase();
  return pref === "enterprise" ? "enterprise" : "basic";
}

/**
 * Effective mode: enterprise only when preferred AND Cloud API credentials valid.
 * Otherwise always Basic (default / fallback).
 */
export async function resolveWhatsAppMode(userId: string): Promise<{
  mode: WhatsAppEffectiveMode;
  preferredMode: WhatsAppPreferredMode;
  enterpriseConnected: boolean;
  label: string;
  description: string;
}> {
  const preferredMode = await getPreferredWhatsAppMode(userId);
  const enterpriseConnected = await isEnterpriseCloudConnected(userId);
  const mode: WhatsAppEffectiveMode =
    preferredMode === "enterprise" && enterpriseConnected
      ? "enterprise"
      : "basic";

  return {
    mode,
    preferredMode,
    enterpriseConnected,
    label: mode === "enterprise" ? "Enterprise Mode" : "Basic Mode",
    description:
      mode === "enterprise"
        ? "Automatic WhatsApp delivery enabled."
        : "No setup required. Messages will open in WhatsApp.",
  };
}

export async function setPreferredWhatsAppMode(
  userId: string,
  preferredMode: WhatsAppPreferredMode
) {
  const businessId = await getUserBusinessId(userId);
  const existing =
    (await getWhatsAppIntegrationForTenant(userId)) ||
    (await getIntegration(userId, "whatsapp"));
  const prev = (existing?.config || {}) as Record<string, unknown>;
  const { upsertIntegration } = await import("./integration.service.js");
  await upsertIntegration(
    userId,
    "whatsapp",
    { ...prev, preferredMode },
    {
      isActive: existing?.isActive ?? true,
      status: existing?.status || "not_connected",
      businessId: existing?.businessId || businessId,
    }
  );
  return resolveWhatsAppMode(userId);
}

export function buildWaMeUrl(phone: string, message: string): string {
  const digits = digitsPhone(phone);
  // India 10-digit local → prefix 91
  const e164 =
    digits.length === 10 && !digits.startsWith("0")
      ? `91${digits}`
      : digits.replace(/^0+/, "");
  const text = encodeURIComponent(message || "");
  return `https://wa.me/${e164}?text=${text}`;
}

/**
 * Prepare Basic Mode send: activity + optional media logs, return wa.me URL.
 * Never throws for missing Cloud API.
 */
export async function prepareBasicWhatsAppOpen(
  userId: string,
  opts: {
    contactId?: string | null;
    to: string;
    message: string;
    files?: Array<{ assetId: string; assetName: string }>;
  }
) {
  const businessId = await getUserBusinessId(userId);
  const phone = digitsPhone(opts.to);
  if (phone.length < 10) {
    throw new Error("Contact has no valid phone number for WhatsApp");
  }

  const message = String(opts.message || "").trim() || "Hello";
  const waUrl = buildWaMeUrl(phone, message);

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const actorName = actor?.name || actor?.email || "User";

  let contactName: string | null = null;
  let contactType: string | null = null;
  if (opts.contactId) {
    const c = await prisma.contact.findFirst({
      where: {
        id: opts.contactId,
        deletedAt: null,
        OR: businessId
          ? [{ businessId }, { userId }]
          : [{ userId }],
      },
      select: { id: true, name: true, type: true },
    });
    if (c) {
      contactName = c.name;
      contactType = c.type;
    }
  }

  const logIds: string[] = [];
  if (businessId && opts.files?.length) {
    for (const f of opts.files) {
      const log = await prisma.mediaSendLog.create({
        data: {
          businessId,
          assetId: f.assetId,
          assetName: f.assetName,
          sentByUserId: userId,
          sentByName: actorName,
          contactId: opts.contactId || null,
          contactName,
          contactType,
          toPhone: phone,
          channel: "whatsapp_basic",
          caption: message.slice(0, 2000),
          status: "pending_customer_send",
        },
      });
      logIds.push(log.id);
    }
  }

  await logActivity({
    userId,
    entityType: opts.contactId ? "contact" : "whatsapp",
    entityId: opts.contactId || phone,
    action: "whatsapp_opened",
    details: {
      mode: "basic",
      to: phone,
      contactId: opts.contactId || null,
      contactName,
      status: "pending_customer_send",
      messagePreview: message.slice(0, 200),
      files: (opts.files || []).map((f) => f.assetName),
      logIds,
    },
  });

  if (businessId) {
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "whatsapp_basic_open",
      entityType: opts.contactId ? "contact" : "whatsapp",
      entityId: opts.contactId || null,
      metadata: {
        to: phone,
        mode: "basic",
        status: "pending_customer_send",
        fileCount: opts.files?.length || 0,
      },
    });
  }

  return {
    mode: "basic" as const,
    status: "pending_customer_send" as const,
    waUrl,
    phone,
    message,
    contactId: opts.contactId || null,
    contactName,
    logIds,
    files: (opts.files || []).map((f) => ({
      assetId: f.assetId,
      name: f.assetName,
      downloadPath: `/media/assets/${f.assetId}/file`,
    })),
    uiHint: "Opening WhatsApp...",
  };
}

export async function confirmBasicWhatsAppSend(
  userId: string,
  opts: {
    sent: boolean;
    contactId?: string | null;
    logIds?: string[];
    phone?: string;
  }
) {
  const businessId = await getUserBusinessId(userId);
  const logIds = opts.logIds || [];

  if (logIds.length && businessId) {
    await prisma.mediaSendLog.updateMany({
      where: {
        id: { in: logIds },
        businessId,
        sentByUserId: userId,
      },
      data: {
        status: opts.sent ? "sent_manual" : "cancelled",
      },
    });
    if (opts.sent) {
      const logs = await prisma.mediaSendLog.findMany({
        where: { id: { in: logIds }, businessId },
        select: { assetId: true },
      });
      for (const l of logs) {
        if (!l.assetId) continue;
        await prisma.mediaAsset
          .update({
            where: { id: l.assetId },
            data: {
              whatsappSendCount: { increment: 1 },
              lastUsedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
    }
  }

  await logActivity({
    userId,
    entityType: opts.contactId ? "contact" : "whatsapp",
    entityId: opts.contactId || opts.phone || "unknown",
    action: opts.sent ? "whatsapp_sent_manual" : "whatsapp_send_cancelled",
    details: {
      mode: "basic",
      sent: opts.sent,
      logIds,
      status: opts.sent ? "sent_manual" : "cancelled",
    },
  });

  if (opts.sent) {
    await notifyUser(userId, {
      type: "activity",
      title: "WhatsApp Sent (Manual)",
      message: "You confirmed sending a WhatsApp message from Basic Mode.",
      entityType: opts.contactId ? "contact" : undefined,
      entityId: opts.contactId || undefined,
    }).catch(() => undefined);
  }

  return {
    ok: true,
    status: opts.sent ? "sent_manual" : "cancelled",
  };
}
