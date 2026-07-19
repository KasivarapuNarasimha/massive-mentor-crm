import { prisma } from "@/lib/prisma";
import {
  decryptConfigSecrets,
  encryptConfigSecrets,
} from "@/lib/secret-crypto";

export type IntegrationProvider = "whatsapp" | "gmail" | "google_calendar";

export async function getIntegration(userId: string, provider: string) {
  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row) return null;
  // Decrypt secrets for runtime use (never send full config to list UI)
  return {
    ...row,
    config: decryptConfigSecrets((row.config || {}) as Record<string, unknown>),
  };
}

export async function listIntegrations(userId: string) {
  const providers: IntegrationProvider[] = ["whatsapp", "gmail", "google_calendar"];
  const rows = await Promise.all(
    providers.map(async (provider) => {
      const int = await getIntegration(userId, provider);
      const cfg = (int?.config || {}) as Record<string, unknown>;
      const configured = isProviderConfigured(provider, cfg);
      return {
        provider,
        isActive: int?.isActive ?? false,
        configured,
        status: int?.status || (configured ? "connected" : "not_connected"),
        lastValidatedAt: int?.lastValidatedAt || null,
        lastError: int?.lastError || null,
        // Never return full secrets — only presence flags + masked previews
        configPreview: maskConfig(provider, cfg),
        mvp: provider === "whatsapp",
      };
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
    return {
      hasAccessToken: !!token,
      accessTokenPreview: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null,
      phoneNumberId: cfg.phoneNumberId ? String(cfg.phoneNumberId) : null,
      hasVerifyToken: !!cfg.verifyToken,
      apiVersion: (cfg.apiVersion as string) || "v19.0",
    };
  }
  return { configuredKeys: Object.keys(cfg) };
}

export async function upsertIntegration(
  userId: string,
  provider: string,
  config: Record<string, unknown>,
  opts?: { isActive?: boolean; status?: string; lastError?: string | null; lastValidatedAt?: Date | null }
) {
  // Merge with existing config so partial updates don't wipe tokens
  // getIntegration returns decrypted secrets — re-encrypt before persist
  const existing = await getIntegration(userId, provider);
  const prev = (existing?.config || {}) as Record<string, unknown>;
  const merged = { ...prev, ...config };
  // Drop empty string overwrites for secrets
  for (const key of Object.keys(merged)) {
    if (merged[key] === "" || merged[key] === undefined) {
      if (prev[key] !== undefined) merged[key] = prev[key];
      else delete merged[key];
    }
  }

  const encryptedConfig = encryptConfigSecrets(merged);

  const row = await prisma.integration.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
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

/**
 * Validate WhatsApp Cloud API credentials against Meta Graph API
 * without sending a customer message.
 */
export async function validateWhatsAppCredentials(opts: {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
}): Promise<{ ok: boolean; displayName?: string; error?: string }> {
  const apiVersion = opts.apiVersion || "v19.0";
  const url = `https://graph.facebook.com/${apiVersion}/${opts.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message || `Meta API error ${res.status}` };
    }
    return {
      ok: true,
      displayName: json.verified_name || json.display_phone_number || opts.phoneNumberId,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error validating credentials" };
  }
}

export async function configureAndValidateWhatsApp(
  userId: string,
  config: {
    accessToken?: string;
    phoneNumberId?: string;
    verifyToken?: string;
    apiVersion?: string;
  }
) {
  const existing = await getIntegration(userId, "whatsapp");
  const prev = (existing?.config || {}) as Record<string, unknown>;
  const accessToken = (config.accessToken || prev.accessToken || "") as string;
  const phoneNumberId = (config.phoneNumberId || prev.phoneNumberId || "") as string;
  const apiVersion = (config.apiVersion || prev.apiVersion || "v19.0") as string;
  const verifyToken = config.verifyToken !== undefined ? config.verifyToken : prev.verifyToken;

  if (!accessToken || !phoneNumberId) {
    throw new Error("Access Token and Phone Number ID are required");
  }

  const validation = await validateWhatsAppCredentials({ accessToken, phoneNumberId, apiVersion });
  if (!validation.ok) {
    await upsertIntegration(
      userId,
      "whatsapp",
      { accessToken, phoneNumberId, verifyToken, apiVersion },
      { status: "error", lastError: validation.error || "Validation failed", isActive: false }
    );
    throw new Error(validation.error || "WhatsApp credential validation failed");
  }

  const row = await upsertIntegration(
    userId,
    "whatsapp",
    { accessToken, phoneNumberId, verifyToken, apiVersion, displayName: validation.displayName },
    {
      status: "connected",
      lastError: null,
      lastValidatedAt: new Date(),
      isActive: true,
    }
  );

  return {
    integration: {
      provider: "whatsapp",
      status: "connected",
      isActive: true,
      displayName: validation.displayName,
      lastValidatedAt: row.lastValidatedAt,
      configPreview: maskConfig("whatsapp", {
        accessToken,
        phoneNumberId,
        verifyToken,
        apiVersion,
      }),
    },
  };
}

/** Real WhatsApp Cloud API send (persists history). */
export async function sendWhatsAppMessage(
  userId: string,
  to: string,
  message: string,
  opts?: { contactId?: string; templateName?: string; templateParams?: string[] }
) {
  const { sendWhatsAppCloudMessage } = await import("@/services/whatsapp.service");
  const record = await sendWhatsAppCloudMessage({
    userId,
    to,
    body: message,
    contactId: opts?.contactId,
    templateName: opts?.templateName,
    templateParams: opts?.templateParams,
  });
  return {
    success: true,
    messageId: record.waMessageId || record.id,
    status: record.status,
    record,
  };
}

/**
 * Gmail / Calendar are not in MVP — throw clear errors (UI hides send forms).
 */
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
