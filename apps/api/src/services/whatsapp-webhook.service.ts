/**
 * WhatsApp Cloud API webhook verification + inbound event processing.
 */
import { prisma } from "../lib/prisma.js";
import { decryptConfigSecrets } from "../lib/secret-crypto.js";
import {
  applyWhatsAppStatusUpdate,
  recordInboundWhatsApp,
} from "./whatsapp.service.js";
import { normalizePhoneNumberId } from "./whatsapp-token.util.js";

export type WaIntegrationConfig = {
  accessToken?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  apiVersion?: string;
};

export { normalizeWhatsAppAccessToken, normalizePhoneNumberId } from "./whatsapp-token.util.js";

/**
 * GET verification: hub.mode=subscribe + hub.verify_token match + return hub.challenge.
 * Self-service multi-tenant: each client sets their own Verify Token in Integrations.
 * Optional process.env.WHATSAPP_VERIFY_TOKEN only as platform emergency fallback.
 */
export async function verifyWhatsAppWebhookChallenge(opts: {
  mode: string;
  token: string;
  challenge: string;
}): Promise<{ ok: boolean; challenge?: string }> {
  if (opts.mode !== "subscribe" || !opts.token || !opts.challenge) {
    return { ok: false };
  }

  const envToken = (
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.META_WHATSAPP_VERIFY_TOKEN ||
    ""
  ).trim();
  if (envToken && opts.token === envToken) {
    return { ok: true, challenge: opts.challenge };
  }

  // Match any tenant that stored this verify token, then mark webhook verified
  const rows = await prisma.integration.findMany({
    where: { provider: "whatsapp", isActive: true },
    select: { id: true, userId: true, businessId: true, config: true },
    take: 2000,
  });
  for (const row of rows) {
    const cfg = decryptConfigSecrets(
      (row.config || {}) as Record<string, unknown>
    ) as WaIntegrationConfig & { webhookVerifiedAt?: string };
    const vt = String(cfg.verifyToken || "").trim();
    if (vt && vt === opts.token) {
      try {
        const { markWhatsAppWebhookVerified } = await import("./integration.service.js");
        await markWhatsAppWebhookVerified({
          userId: row.userId,
          businessId: row.businessId,
        });
      } catch (e) {
        console.error("[whatsapp-webhook] mark verified failed", e);
      }
      return { ok: true, challenge: opts.challenge };
    }
  }

  return { ok: false };
}

/** Find tenant owner userId for a Meta phone_number_id (incoming webhooks). */
export async function findUserIdByPhoneNumberId(
  phoneNumberId: string
): Promise<string | null> {
  const { findIntegrationByPhoneNumberId } = await import("./integration.service.js");
  const hit = await findIntegrationByPhoneNumberId(phoneNumberId);
  return hit?.userId || null;
}

/** Full tenant resolution for inbound events */
export async function findTenantByPhoneNumberId(phoneNumberId: string): Promise<{
  userId: string;
  businessId: string | null;
} | null> {
  const { findIntegrationByPhoneNumberId } = await import("./integration.service.js");
  const hit = await findIntegrationByPhoneNumberId(phoneNumberId);
  if (!hit) return null;
  return { userId: hit.userId, businessId: hit.businessId || null };
}

/**
 * Process Meta webhook body (object=whatsapp_business_account).
 * Handles statuses + inbound messages.
 */
export async function processWhatsAppWebhookPayload(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  const root = body as {
    object?: string;
    entry?: Array<{
      id?: string;
      changes?: Array<{
        field?: string;
        value?: {
          messaging_product?: string;
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          statuses?: Array<{
            id?: string;
            status?: string;
            errors?: Array<{ message?: string }>;
          }>;
          messages?: Array<{
            from?: string;
            id?: string;
            timestamp?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string };
            interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          }>;
        };
      }>;
    }>;
  };

  if (root.object && root.object !== "whatsapp_business_account") {
    return;
  }

  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id || "";
      const tenant = phoneNumberId
        ? await findTenantByPhoneNumberId(phoneNumberId)
        : null;
      const userId = tenant?.userId || null;

      if (tenant) {
        try {
          const { touchWhatsAppWebhookActivity } = await import("./integration.service.js");
          await touchWhatsAppWebhookActivity({
            userId: tenant.userId,
            businessId: tenant.businessId,
          });
        } catch (e) {
          console.error("[whatsapp-webhook] touch activity failed", e);
        }
      }

      // Delivery / read / failed statuses (matched by waMessageId globally)
      for (const st of value.statuses || []) {
        await applyWhatsAppStatusUpdate({
          id: st.id,
          status: st.status,
          errors: st.errors,
        });
      }

      // Inbound messages → correct tenant via phone_number_id
      for (const msg of value.messages || []) {
        if (!userId || !msg.from) {
          if (msg.from && phoneNumberId) {
            console.warn(
              `[whatsapp-webhook] no tenant for phone_number_id=${phoneNumberId}`
            );
          }
          continue;
        }
        let text = "";
        if (msg.type === "text") text = msg.text?.body || "";
        else if (msg.type === "button") text = msg.button?.text || "[button]";
        else if (msg.type === "interactive") {
          text =
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            "[interactive]";
        } else {
          text = `[${msg.type || "message"}]`;
        }
        await recordInboundWhatsApp({
          userId,
          from: msg.from,
          body: text,
          waMessageId: msg.id,
        });
      }
    }
  }
}
