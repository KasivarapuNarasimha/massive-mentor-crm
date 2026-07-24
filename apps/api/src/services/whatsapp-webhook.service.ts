/**
 * WhatsApp Cloud API webhook verification + inbound event processing.
 * POST payloads are authenticated with X-Hub-Signature-256 (HMAC-SHA256 of raw body).
 */
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { decryptConfigSecrets, extractVerifyToken } from "../lib/secret-crypto.js";
import {
  applyWhatsAppStatusUpdate,
  recordInboundWhatsApp,
} from "./whatsapp.service.js";
import { normalizePhoneNumberId } from "./whatsapp-token.util.js";

export type WaIntegrationConfig = {
  accessToken?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  /** Meta App Secret — used for X-Hub-Signature-256 on inbound webhooks */
  appSecret?: string;
  apiVersion?: string;
};

export { normalizeWhatsAppAccessToken, normalizePhoneNumberId } from "./whatsapp-token.util.js";

/**
 * Verify Meta X-Hub-Signature-256 header.
 * Header format: sha256=<hex hmac of raw body with App Secret>
 */
export function verifyMetaHubSignature256(opts: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined | null;
  appSecret: string;
}): boolean {
  const secret = (opts.appSecret || "").trim();
  const header = (opts.signatureHeader || "").trim();
  if (!secret || !header) return false;

  const expectedPrefix = "sha256=";
  if (!header.startsWith(expectedPrefix)) return false;
  const theirHex = header.slice(expectedPrefix.length).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(theirHex)) return false;

  const raw =
    typeof opts.rawBody === "string"
      ? Buffer.from(opts.rawBody, "utf8")
      : opts.rawBody;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(raw)
    .digest("hex");

  try {
    const a = Buffer.from(digest, "hex");
    const b = Buffer.from(theirHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Extract first phone_number_id from a Meta webhook JSON body (if present). */
export function extractPhoneNumberIdFromWebhookBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as {
    entry?: Array<{
      changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }>;
    }>;
  };
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return normalizePhoneNumberId(id);
    }
  }
  return null;
}

/**
 * Resolve App Secret(s) that may sign this webhook:
 * 1) Tenant integration appSecret (by phone_number_id)
 * 2) Platform env WHATSAPP_APP_SECRET / META_APP_SECRET
 */
export async function resolveWhatsAppAppSecretsForPayload(
  body: unknown
): Promise<string[]> {
  const secrets: string[] = [];
  const phoneId = extractPhoneNumberIdFromWebhookBody(body);
  if (phoneId) {
    try {
      const { findIntegrationByPhoneNumberId } = await import("./integration.service.js");
      const hit = await findIntegrationByPhoneNumberId(phoneId);
      const secret = String(
        (hit?.config as WaIntegrationConfig | undefined)?.appSecret || ""
      ).trim();
      if (secret) secrets.push(secret);
    } catch {
      /* ignore lookup errors */
    }
  }
  const envSecret = (
    process.env.WHATSAPP_APP_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    ""
  ).trim();
  if (envSecret && !secrets.includes(envSecret)) secrets.push(envSecret);
  return secrets;
}

/**
 * Authenticate POST webhook: require valid X-Hub-Signature-256 when any App Secret is known.
 * Returns false if signature invalid or missing when secrets exist.
 * If no App Secret is configured anywhere, reject in production; allow in development with warning.
 */
export async function authenticateWhatsAppWebhookPost(opts: {
  rawBody: Buffer;
  signatureHeader: string | undefined | null;
  parsedBody: unknown;
}): Promise<{ ok: boolean; reason?: string }> {
  const secrets = await resolveWhatsAppAppSecretsForPayload(opts.parsedBody);
  const isProd = process.env.NODE_ENV === "production";

  if (secrets.length === 0) {
    if (isProd) {
      return {
        ok: false,
        reason:
          "No App Secret configured for this webhook (set App Secret on the workspace Integration or WHATSAPP_APP_SECRET)",
      };
    }
    console.warn(
      "[whatsapp-webhook] no App Secret configured — skipping signature check (development only)"
    );
    return { ok: true };
  }

  if (!opts.signatureHeader) {
    return { ok: false, reason: "Missing X-Hub-Signature-256 header" };
  }

  for (const secret of secrets) {
    if (
      verifyMetaHubSignature256({
        rawBody: opts.rawBody,
        signatureHeader: opts.signatureHeader,
        appSecret: secret,
      })
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Invalid X-Hub-Signature-256" };
}

/**
 * GET verification: hub.mode=subscribe + hub.verify_token match + return hub.challenge.
 * Self-service multi-tenant: each client sets their own Verify Token in Integrations.
 * Optional process.env.WHATSAPP_VERIFY_TOKEN as platform fallback.
 */
export async function verifyWhatsAppWebhookChallenge(opts: {
  mode: string;
  token: string;
  challenge: string;
}): Promise<{ ok: boolean; challenge?: string; reason?: string; matchedUserId?: string }> {
  const mode = String(opts.mode || "").trim();
  const token = String(opts.token || "").trim();
  const challenge = String(opts.challenge || "").trim();

  console.log(
    `[whatsapp-webhook] GET verify attempt mode=${JSON.stringify(mode)} ` +
      `tokenLen=${token.length} tokenPrefix=${token.slice(0, 12)}… ` +
      `challengeLen=${challenge.length}`
  );

  if (mode !== "subscribe") {
    console.warn(`[whatsapp-webhook] GET 403 reason=bad_mode expected=subscribe got=${mode}`);
    return { ok: false, reason: `hub.mode must be "subscribe" (got "${mode}")` };
  }
  if (!token) {
    console.warn("[whatsapp-webhook] GET 403 reason=missing_verify_token");
    return { ok: false, reason: "hub.verify_token is missing" };
  }
  if (!challenge) {
    console.warn("[whatsapp-webhook] GET 403 reason=missing_challenge");
    return { ok: false, reason: "hub.challenge is missing" };
  }

  const envToken = (
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.META_WHATSAPP_VERIFY_TOKEN ||
    ""
  ).trim();
  if (envToken) {
    console.log(
      `[whatsapp-webhook] env WHATSAPP_VERIFY_TOKEN present len=${envToken.length} match=${envToken === token}`
    );
    if (envToken === token) {
      console.log("[whatsapp-webhook] GET matched platform WHATSAPP_VERIFY_TOKEN");
      return { ok: true, challenge, reason: "matched_env_WHATSAPP_VERIFY_TOKEN" };
    }
  } else {
    console.log("[whatsapp-webhook] no platform WHATSAPP_VERIFY_TOKEN env set");
  }

  // All WhatsApp integrations (including inactive) — token may be saved before isActive flip
  const rows = await prisma.integration.findMany({
    where: { provider: "whatsapp" },
    select: { id: true, userId: true, businessId: true, isActive: true, status: true, config: true },
    take: 5000,
  });

  console.log(`[whatsapp-webhook] scanning ${rows.length} whatsapp integration row(s)`);

  let scannedWithToken = 0;
  let decryptEmpty = 0;
  for (const row of rows) {
    const rawCfg = (row.config || {}) as Record<string, unknown>;
    const vt = extractVerifyToken(rawCfg);
    if (!vt) {
      // Also try decrypted bag
      const cfg = decryptConfigSecrets(rawCfg);
      const vt2 = String(cfg.verifyToken || "").trim();
      if (!vt2) {
        if (rawCfg.verifyToken) decryptEmpty++;
        continue;
      }
      scannedWithToken++;
      console.log(
        `[whatsapp-webhook] candidate userId=${row.userId} businessId=${row.businessId} ` +
          `active=${row.isActive} status=${row.status} storedTokenPrefix=${vt2.slice(0, 12)}… match=${vt2 === token}`
      );
      if (vt2 === token) {
        try {
          const { markWhatsAppWebhookVerified } = await import("./integration.service.js");
          await markWhatsAppWebhookVerified({
            userId: row.userId,
            businessId: row.businessId,
          });
        } catch (e) {
          console.error("[whatsapp-webhook] mark verified failed", e);
        }
        console.log(
          `[whatsapp-webhook] GET matched tenant userId=${row.userId} businessId=${row.businessId}`
        );
        return {
          ok: true,
          challenge,
          matchedUserId: row.userId,
          reason: "matched_tenant_verify_token",
        };
      }
      continue;
    }
    scannedWithToken++;
    console.log(
      `[whatsapp-webhook] candidate userId=${row.userId} businessId=${row.businessId} ` +
        `active=${row.isActive} status=${row.status} storedTokenPrefix=${vt.slice(0, 12)}… match=${vt === token}`
    );
    if (vt === token) {
      try {
        const { markWhatsAppWebhookVerified } = await import("./integration.service.js");
        await markWhatsAppWebhookVerified({
          userId: row.userId,
          businessId: row.businessId,
        });
      } catch (e) {
        console.error("[whatsapp-webhook] mark verified failed", e);
      }
      console.log(
        `[whatsapp-webhook] GET matched tenant userId=${row.userId} businessId=${row.businessId}`
      );
      return {
        ok: true,
        challenge,
        matchedUserId: row.userId,
        reason: "matched_tenant_verify_token",
      };
    }
  }

  console.warn(
    `[whatsapp-webhook] GET 403 reason=no_matching_verify_token ` +
      `hub.verify_token=${token.slice(0, 16)}… scannedRows=${rows.length} ` +
      `withToken=${scannedWithToken} decryptEmpty=${decryptEmpty}`
  );
  return {
    ok: false,
    reason:
      "No Integration verifyToken matched hub.verify_token. Save WhatsApp settings in CRM first (or set WHATSAPP_VERIFY_TOKEN env).",
  };
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
