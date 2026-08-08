/**
 * Multi-tenant integrations (WhatsApp Cloud API is fully self-service per business).
 * No platform-wide hardcoded Meta tokens — each tenant stores its own credentials.
 */
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  decryptConfigSecrets,
  encryptConfigSecrets,
} from "../lib/secret-crypto.js";
import {
  normalizePhoneNumberId,
  normalizeWhatsAppAccessToken,
} from "./whatsapp-token.util.js";
import { getUserBusinessId } from "./field-engine.service.js";

export type IntegrationProvider = "whatsapp" | "gmail" | "google_calendar";

/** Public connection status for UI */
export type WhatsAppConnectionStatus =
  | "connected"
  | "verification_pending"
  | "invalid_token"
  | "not_connected";

export const WHATSAPP_CALLBACK_URL =
  process.env.WHATSAPP_WEBHOOK_PUBLIC_URL ||
  "https://api.massivementor.in/api/integrations/whatsapp/webhook";

function deriveWhatsAppStatus(opts: {
  configured: boolean;
  status: string | null | undefined;
  hasVerifyToken: boolean;
  webhookVerifiedAt?: string | null;
  lastError?: string | null;
}): WhatsAppConnectionStatus {
  const s = (opts.status || "").toLowerCase();
  if (s === "invalid_token" || s === "error") return "invalid_token";
  if (!opts.configured) return "not_connected";
  if (s === "connected" && opts.webhookVerifiedAt) return "connected";
  if (s === "connected" || s === "verification_pending") {
    // Meta Graph OK but client may still need to complete webhook in Meta console
    if (!opts.hasVerifyToken || !opts.webhookVerifiedAt) return "verification_pending";
    return "connected";
  }
  if (opts.configured) return "verification_pending";
  return "not_connected";
}

/**
 * Resolve WhatsApp integration for any member of the tenant.
 * Prefer business-scoped row; fall back to any active member connection on that business.
 */
export async function getWhatsAppIntegrationForTenant(userId: string) {
  const businessId = await getUserBusinessId(userId);

  if (businessId) {
    const byBiz = await prisma.integration.findFirst({
      where: {
        provider: "whatsapp",
        businessId,
        isActive: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (byBiz) {
      return {
        ...byBiz,
        config: decryptConfigSecrets((byBiz.config || {}) as Record<string, unknown>),
      };
    }

    // Legacy: user-owned integration on a member of this business
    const memberIds = (
      await prisma.businessMember.findMany({
        where: { businessId },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    if (memberIds.length) {
      const legacy = await prisma.integration.findFirst({
        where: {
          provider: "whatsapp",
          userId: { in: memberIds },
          isActive: true,
        },
        orderBy: { updatedAt: "desc" },
      });
      if (legacy) {
        return {
          ...legacy,
          config: decryptConfigSecrets((legacy.config || {}) as Record<string, unknown>),
        };
      }
    }
  }

  // Solo / no business yet — user-scoped
  return getIntegration(userId, "whatsapp");
}

export async function getIntegration(userId: string, provider: string) {
  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row) return null;
  return {
    ...row,
    config: decryptConfigSecrets((row.config || {}) as Record<string, unknown>),
  };
}

export async function listIntegrations(userId: string) {
  const providers: IntegrationProvider[] = ["whatsapp", "gmail", "google_calendar"];
  const businessId = await getUserBusinessId(userId);

  const rows = await Promise.all(
    providers.map(async (provider) => {
      const int =
        provider === "whatsapp"
          ? await getWhatsAppIntegrationForTenant(userId)
          : await getIntegration(userId, provider);
      const cfg = (int?.config || {}) as Record<string, unknown>;
      const configured = isProviderConfigured(provider, cfg);
      const hasVerifyToken = !!cfg.verifyToken;
      const webhookVerifiedAt = (cfg.webhookVerifiedAt as string) || null;

      let status = int?.status || (configured ? "connected" : "not_connected");
      let connectionStatus: WhatsAppConnectionStatus | string = status;
      if (provider === "whatsapp") {
        connectionStatus = deriveWhatsAppStatus({
          configured,
          status,
          hasVerifyToken,
          webhookVerifiedAt,
          lastError: int?.lastError,
        });
        status = connectionStatus;
      }

      const base = {
        provider,
        isActive: int?.isActive ?? (provider === "whatsapp" ? true : false),
        configured,
        status,
        connectionStatus: provider === "whatsapp" ? connectionStatus : status,
        lastValidatedAt: int?.lastValidatedAt || null,
        lastError: int?.lastError || null,
        businessId: int?.businessId || businessId || null,
        webhook: provider === "whatsapp"
          ? {
              callbackUrl: WHATSAPP_CALLBACK_URL,
              verifyToken: hasVerifyToken ? String(cfg.verifyToken) : null,
              hasVerifyToken,
              webhookVerifiedAt,
              lastWebhookReceivedAt: cfg.lastWebhookReceivedAt
                ? String(cfg.lastWebhookReceivedAt)
                : null,
              status: webhookVerifiedAt
                ? "verified"
                : configured
                  ? "not_verified"
                  : "not_verified",
            }
          : null,
        configPreview: maskConfig(provider, cfg),
        mvp: provider === "whatsapp",
      };

      // Basic Mode is the default onboarding experience; expose effective mode for UI.
      if (provider === "whatsapp") {
        try {
          const { resolveWhatsAppMode } = await import("./whatsapp-mode.service.js");
          const modeInfo = await resolveWhatsAppMode(userId);
          return {
            ...base,
            preferredMode: modeInfo.preferredMode,
            effectiveMode: modeInfo.mode,
            modeLabel: modeInfo.label,
            modeDescription: modeInfo.description,
            enterpriseConnected: modeInfo.enterpriseConnected,
          };
        } catch {
          return {
            ...base,
            preferredMode: "basic",
            effectiveMode: "basic",
            modeLabel: "Basic Mode",
            modeDescription: "No setup required. Messages will open in WhatsApp.",
            enterpriseConnected: false,
          };
        }
      }

      return base;
    })
  );
  return rows;
}

function isProviderConfigured(provider: string, cfg: Record<string, unknown>): boolean {
  if (provider === "whatsapp") {
    return !!(cfg.accessToken && cfg.phoneNumberId);
  }
  if (provider === "gmail") {
    return !!(cfg.accessToken || cfg.refreshToken || cfg.clientId);
  }
  if (provider === "google_calendar") {
    return !!(cfg.accessToken || cfg.refreshToken || cfg.clientId);
  }
  return Object.keys(cfg).length > 0;
}

function maskConfig(provider: string, cfg: Record<string, unknown>) {
  if (provider === "whatsapp") {
    const token = String(cfg.accessToken || "");
    const preferred =
      String(cfg.preferredMode || "basic").toLowerCase() === "enterprise"
        ? "enterprise"
        : "basic";
    return {
      hasAccessToken: !!token,
      accessTokenPreview: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null,
      phoneNumberId: cfg.phoneNumberId ? String(cfg.phoneNumberId) : null,
      hasVerifyToken: !!cfg.verifyToken,
      hasAppSecret: !!cfg.appSecret,
      // Safe to return verify token to the tenant that owns it (needed for Meta setup)
      verifyToken: cfg.verifyToken ? String(cfg.verifyToken) : null,
      apiVersion: (cfg.apiVersion as string) || "v19.0",
      displayName: cfg.displayName ? String(cfg.displayName) : null,
      phoneDisplay: cfg.phoneDisplay ? String(cfg.phoneDisplay) : null,
      wabaName: cfg.wabaName ? String(cfg.wabaName) : null,
      wabaId: cfg.wabaId ? String(cfg.wabaId) : null,
      qualityRating: cfg.qualityRating ? String(cfg.qualityRating) : null,
      webhookVerifiedAt: cfg.webhookVerifiedAt ? String(cfg.webhookVerifiedAt) : null,
      lastWebhookReceivedAt: cfg.lastWebhookReceivedAt
        ? String(cfg.lastWebhookReceivedAt)
        : null,
      preferredMode: preferred,
    };
  }
  return { configuredKeys: Object.keys(cfg) };
}

export async function upsertIntegration(
  userId: string,
  provider: string,
  config: Record<string, unknown>,
  opts?: {
    isActive?: boolean;
    status?: string;
    lastError?: string | null;
    lastValidatedAt?: Date | null;
    businessId?: string | null;
  }
) {
  const existing = await getIntegration(userId, provider);
  const prev = (existing?.config || {}) as Record<string, unknown>;
  const merged = { ...prev, ...config };
  for (const key of Object.keys(merged)) {
    if (merged[key] === "" || merged[key] === undefined) {
      if (prev[key] !== undefined) merged[key] = prev[key];
      else delete merged[key];
    }
  }

  const encryptedConfig = encryptConfigSecrets(merged);
  const businessId =
    opts?.businessId !== undefined
      ? opts.businessId
      : existing?.businessId || (await getUserBusinessId(userId));

  const row = await prisma.integration.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      businessId: businessId || null,
      provider,
      config: encryptedConfig as object,
      isActive: opts?.isActive ?? true,
      status: opts?.status || "not_connected",
      lastError: opts?.lastError ?? null,
      lastValidatedAt: opts?.lastValidatedAt ?? null,
    },
    update: {
      config: encryptedConfig as object,
      isActive: opts?.isActive ?? true,
      ...(businessId ? { businessId } : {}),
      ...(opts?.status !== undefined ? { status: opts.status } : {}),
      ...(opts?.lastError !== undefined ? { lastError: opts.lastError } : {}),
      ...(opts?.lastValidatedAt !== undefined ? { lastValidatedAt: opts.lastValidatedAt } : {}),
    },
  });
  return {
    ...row,
    config: decryptConfigSecrets((row.config || {}) as Record<string, unknown>),
  };
}

export async function toggleIntegration(userId: string, provider: string, isActive: boolean) {
  return prisma.integration.updateMany({
    where: { userId, provider },
    data: { isActive },
  });
}

export type WhatsAppValidateResult = {
  ok: boolean;
  displayName?: string;
  phoneDisplay?: string;
  wabaName?: string;
  wabaId?: string;
  qualityRating?: string;
  error?: string;
};

export async function validateWhatsAppCredentials(opts: {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
}): Promise<WhatsAppValidateResult> {
  const accessToken = normalizeWhatsAppAccessToken(opts.accessToken);
  const phoneNumberId = normalizePhoneNumberId(opts.phoneNumberId);
  const apiVersion = (opts.apiVersion || "v19.0").trim().replace(/^\//, "") || "v19.0";

  if (!accessToken) {
    return {
      ok: false,
      error:
        "Access token is empty or could not be decrypted. Paste a permanent System User token from Meta (starts with EAA…), without the word Bearer.",
    };
  }
  if (!phoneNumberId) {
    return { ok: false, error: "Phone Number ID is required" };
  }
  if (/\s/.test(accessToken) || accessToken.includes("Bearer")) {
    return {
      ok: false,
      error:
        "Access token format invalid. Paste only the raw token (EAA…), not “Bearer EAA…” and no spaces/newlines.",
    };
  }

  const fields = [
    "display_phone_number",
    "verified_name",
    "quality_rating",
    "code_verification_status",
    "whatsapp_business_account{id,name}",
  ].join(",");
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=${encodeURIComponent(fields)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const json = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      whatsapp_business_account?: { id?: string; name?: string };
      error?: { message?: string; type?: string; code?: number };
    };
    if (!res.ok) {
      const msg = json.error?.message || `Meta API error ${res.status}`;
      if (/cannot parse access token|invalid oauth/i.test(msg)) {
        return {
          ok: false,
          error: `${msg}. Fix: use a permanent System User token from Meta (starts with EAA). Do not prefix with Bearer.`,
        };
      }
      return { ok: false, error: msg };
    }
    const waba = json.whatsapp_business_account;
    return {
      ok: true,
      displayName: json.verified_name || json.display_phone_number || phoneNumberId,
      phoneDisplay: json.display_phone_number || undefined,
      wabaName: waba?.name || undefined,
      wabaId: waba?.id || undefined,
      qualityRating: json.quality_rating || undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error validating credentials" };
  }
}

/** Test Connection using already-saved tenant credentials. */
export async function testWhatsAppConnection(
  userId: string
): Promise<WhatsAppValidateResult & { connectionStatus?: string }> {
  const int = await getWhatsAppIntegrationForTenant(userId);
  const cfg = (int?.config || {}) as Record<string, unknown>;
  const accessToken = normalizeWhatsAppAccessToken(String(cfg.accessToken || ""));
  const phoneNumberId = normalizePhoneNumberId(String(cfg.phoneNumberId || ""));
  const apiVersion = String(cfg.apiVersion || "v19.0");

  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      error: "No saved WhatsApp credentials. Enter Access Token and Phone Number ID, then Save first.",
      connectionStatus: "not_connected",
    };
  }

  const result = await validateWhatsAppCredentials({ accessToken, phoneNumberId, apiVersion });
  if (result.ok) {
    await upsertIntegration(
      userId,
      "whatsapp",
      {
        displayName: result.displayName,
        phoneDisplay: result.phoneDisplay,
        wabaName: result.wabaName,
        wabaId: result.wabaId,
        qualityRating: result.qualityRating,
      },
      {
        status: cfg.webhookVerifiedAt ? "connected" : "verification_pending",
        lastError: null,
        lastValidatedAt: new Date(),
        isActive: true,
        businessId: int?.businessId || (await getUserBusinessId(userId)),
      }
    );
    return {
      ...result,
      connectionStatus: cfg.webhookVerifiedAt ? "connected" : "verification_pending",
    };
  }

  await upsertIntegration(
    userId,
    "whatsapp",
    {},
    {
      status: "invalid_token",
      lastError: result.error || "Test connection failed",
      isActive: false,
      businessId: int?.businessId || (await getUserBusinessId(userId)),
    }
  );
  return { ...result, connectionStatus: "invalid_token" };
}

export function generateWhatsAppVerifyToken(): string {
  return `mm_wa_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Self-service connect: validate Meta credentials, store per tenant, return webhook setup.
 * Never uses platform-global WhatsApp tokens for tenant traffic.
 */
export async function configureAndValidateWhatsApp(
  userId: string,
  config: {
    accessToken?: string;
    phoneNumberId?: string;
    verifyToken?: string;
    appSecret?: string;
    apiVersion?: string;
  }
) {
  const businessId = await getUserBusinessId(userId);
  const existing = await getWhatsAppIntegrationForTenant(userId);
  const prev = (existing?.config || {}) as Record<string, unknown>;
  const accessToken = normalizeWhatsAppAccessToken(
    (config.accessToken || prev.accessToken || "") as string
  );
  const phoneNumberId = normalizePhoneNumberId(
    (config.phoneNumberId || prev.phoneNumberId || "") as string
  );
  const apiVersion = String(config.apiVersion || prev.apiVersion || "v19.0").trim() || "v19.0";

  let verifyToken =
    config.verifyToken !== undefined
      ? String(config.verifyToken || "").trim()
      : String(prev.verifyToken || "").trim();
  if (!verifyToken) {
    verifyToken = generateWhatsAppVerifyToken();
  }

  // Meta App Secret for X-Hub-Signature-256 (optional on first save if platform env set)
  const appSecret =
    config.appSecret !== undefined
      ? String(config.appSecret || "").trim()
      : String(prev.appSecret || "").trim();

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "Access Token and Phone Number ID are required. Paste a permanent System User token from your Meta Business account."
    );
  }

  // Enforce unique phone_number_id across tenants (one WABA number → one CRM workspace)
  if (businessId) {
    const conflict = await findIntegrationByPhoneNumberId(phoneNumberId);
    if (conflict && conflict.businessId && conflict.businessId !== businessId) {
      throw new Error(
        "This Phone Number ID is already connected to another Massive Mentor workspace. Disconnect it there first, or use a different WhatsApp number."
      );
    }
  }

  const validation = await validateWhatsAppCredentials({ accessToken, phoneNumberId, apiVersion });
  if (!validation.ok) {
    await upsertIntegration(
      userId,
      "whatsapp",
      { accessToken, phoneNumberId, verifyToken, appSecret, apiVersion },
      {
        status: "invalid_token",
        lastError: validation.error || "Validation failed",
        isActive: false,
        businessId,
      }
    );
    throw new Error(validation.error || "WhatsApp credential validation failed");
  }

  // Graph credentials OK — webhook subscription still pending until Meta completes GET verify
  const row = await upsertIntegration(
    userId,
    "whatsapp",
    {
      accessToken,
      phoneNumberId,
      verifyToken,
      appSecret: appSecret || prev.appSecret || null,
      apiVersion,
      displayName: validation.displayName,
      phoneDisplay: validation.phoneDisplay || null,
      wabaName: validation.wabaName || null,
      wabaId: validation.wabaId || null,
      qualityRating: validation.qualityRating || null,
      // Preserve webhook activity timestamps
      webhookVerifiedAt: prev.webhookVerifiedAt || null,
      lastWebhookReceivedAt: prev.lastWebhookReceivedAt || null,
    },
    {
      status: prev.webhookVerifiedAt ? "connected" : "verification_pending",
      lastError: null,
      lastValidatedAt: new Date(),
      isActive: true,
      businessId,
    }
  );

  const cfgOut = row.config as Record<string, unknown>;
  const connectionStatus = deriveWhatsAppStatus({
    configured: true,
    status: row.status,
    hasVerifyToken: true,
    webhookVerifiedAt: cfgOut.webhookVerifiedAt as string | undefined,
  });

  return {
    integration: {
      provider: "whatsapp",
      status: connectionStatus,
      connectionStatus,
      isActive: true,
      displayName: validation.displayName,
      phoneDisplay: validation.phoneDisplay,
      wabaName: validation.wabaName,
      lastValidatedAt: row.lastValidatedAt,
      businessId: row.businessId,
      webhook: {
        callbackUrl: WHATSAPP_CALLBACK_URL,
        verifyToken,
        status: cfgOut.webhookVerifiedAt ? "verified" : "not_verified",
        lastWebhookReceivedAt: cfgOut.lastWebhookReceivedAt || null,
      },
      configPreview: maskConfig("whatsapp", {
        accessToken,
        phoneNumberId,
        verifyToken,
        apiVersion,
        displayName: validation.displayName,
        phoneDisplay: validation.phoneDisplay,
        wabaName: validation.wabaName,
        wabaId: validation.wabaId,
        qualityRating: validation.qualityRating,
        webhookVerifiedAt: cfgOut.webhookVerifiedAt,
        lastWebhookReceivedAt: cfgOut.lastWebhookReceivedAt,
      }),
    },
  };
}

/** Touch lastWebhookReceivedAt for tenant (POST events from Meta). */
export async function touchWhatsAppWebhookActivity(opts: {
  userId: string;
  businessId?: string | null;
}): Promise<void> {
  const int =
    opts.businessId
      ? await prisma.integration.findFirst({
          where: { provider: "whatsapp", businessId: opts.businessId },
          orderBy: { updatedAt: "desc" },
        })
      : await prisma.integration.findUnique({
          where: { userId_provider: { userId: opts.userId, provider: "whatsapp" } },
        });
  if (!int) return;
  const cfg = decryptConfigSecrets((int.config || {}) as Record<string, unknown>);
  const next = {
    ...cfg,
    lastWebhookReceivedAt: new Date().toISOString(),
    // Receiving events implies Meta already completed verification
    webhookVerifiedAt: cfg.webhookVerifiedAt || new Date().toISOString(),
  };
  await prisma.integration.update({
    where: { id: int.id },
    data: {
      config: encryptConfigSecrets(next) as object,
      status: "connected",
      lastError: null,
    },
  });
}

/** Used by webhook routing — no secrets returned */
export async function findIntegrationByPhoneNumberId(phoneNumberId: string) {
  const id = normalizePhoneNumberId(phoneNumberId);
  if (!id) return null;
  const rows = await prisma.integration.findMany({
    where: { provider: "whatsapp" },
    select: { id: true, userId: true, businessId: true, config: true, isActive: true, status: true },
    take: 2000,
  });
  for (const row of rows) {
    const cfg = decryptConfigSecrets((row.config || {}) as Record<string, unknown>);
    if (normalizePhoneNumberId(String(cfg.phoneNumberId || "")) === id) {
      return {
        ...row,
        config: cfg,
      };
    }
  }
  return null;
}

/** Mark tenant webhook verified after successful Meta GET challenge */
export async function markWhatsAppWebhookVerified(opts: {
  userId: string;
  businessId?: string | null;
}): Promise<void> {
  const int =
    opts.businessId
      ? await prisma.integration.findFirst({
          where: { provider: "whatsapp", businessId: opts.businessId },
          orderBy: { updatedAt: "desc" },
        })
      : await prisma.integration.findUnique({
          where: { userId_provider: { userId: opts.userId, provider: "whatsapp" } },
        });
  if (!int) return;
  const cfg = decryptConfigSecrets((int.config || {}) as Record<string, unknown>);
  const next = {
    ...cfg,
    webhookVerifiedAt: new Date().toISOString(),
  };
  await prisma.integration.update({
    where: { id: int.id },
    data: {
      config: encryptConfigSecrets(next) as object,
      status: "connected",
      lastError: null,
    },
  });
}

export async function sendWhatsAppMessage(
  userId: string,
  to: string,
  message: string,
  opts?: { contactId?: string; templateName?: string; templateParams?: string[] }
) {
  const { resolveWhatsAppMode, prepareBasicWhatsAppOpen } = await import(
    "./whatsapp-mode.service.js"
  );
  const modeInfo = await resolveWhatsAppMode(userId);

  // Render template vars when contact known
  let body = message || "";
  if (opts?.contactId) {
    try {
      const { buildContactTemplateVars, renderTemplate } = await import(
        "./template-vars.service.js"
      );
      const businessId = await getUserBusinessId(userId);
      const vars = await buildContactTemplateVars({
        contactId: opts.contactId,
        actorUserId: userId,
        businessId,
      });
      body = renderTemplate(body, vars) || body;
    } catch {
      /* keep raw body */
    }
  }

  if (modeInfo.mode === "basic") {
    // Templates require Cloud API — ignore templateName in basic mode
    const basic = await prepareBasicWhatsAppOpen(userId, {
      contactId: opts?.contactId,
      to,
      message: body || "Hello",
    });
    return {
      success: true,
      mode: "basic" as const,
      status: "pending_customer_send",
      basic,
      uiHint: "Opening WhatsApp...",
    };
  }

  const { sendWhatsAppCloudMessage } = await import("./whatsapp.service.js");
  try {
    const record = await sendWhatsAppCloudMessage({
      userId,
      to,
      body,
      contactId: opts?.contactId,
      templateName: opts?.templateName,
      templateParams: opts?.templateParams,
    });
    return {
      success: true,
      mode: "enterprise" as const,
      messageId: record.waMessageId || record.id,
      status: record.status,
      record,
    };
  } catch (err) {
    // Invalid / missing Cloud credentials → never hard-fail; open Basic Mode
    const msg = err instanceof Error ? err.message : String(err);
    if (/not configured|inactive|invalid|token/i.test(msg)) {
      const basic = await prepareBasicWhatsAppOpen(userId, {
        contactId: opts?.contactId,
        to,
        message: body || "Hello",
      });
      return {
        success: true,
        mode: "basic" as const,
        status: "pending_customer_send",
        basic,
        uiHint: "Opening WhatsApp...",
        fallbackFromEnterprise: true,
      };
    }
    throw err;
  }
}

export async function sendGmail(_userId: string, _to: string, _subject: string, _body: string) {
  throw new Error(
    "Gmail is not enabled in this release. WhatsApp is the supported messaging integration."
  );
}

export async function createCalendarEvent(
  _userId: string,
  _event: { title: string; start: string; end?: string; attendees?: string[] }
) {
  throw new Error(
    "Google Calendar is not enabled in this release. It will be available in a future update."
  );
}
