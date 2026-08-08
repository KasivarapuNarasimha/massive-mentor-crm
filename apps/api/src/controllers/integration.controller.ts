import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  listIntegrations,
  upsertIntegration,
  toggleIntegration,
  sendWhatsAppMessage,
  sendGmail,
  createCalendarEvent,
  configureAndValidateWhatsApp,
} from "../services/integration.service.js";

export async function getIntegrations(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const integrations = await listIntegrations(req.user.id);
    res.json({ success: true, data: { integrations } });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

export async function configureIntegration(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { provider, config } = req.body as {
      provider?: string;
      config?: Record<string, unknown>;
    };
    if (!provider || !config || typeof config !== "object") {
      return res.status(400).json({ success: false, error: "provider and config are required" });
    }

    if (provider === "whatsapp") {
      const result = await configureAndValidateWhatsApp(req.user.id, {
        accessToken: config.accessToken as string | undefined,
        phoneNumberId: config.phoneNumberId as string | undefined,
        verifyToken: config.verifyToken as string | undefined,
        appSecret: config.appSecret as string | undefined,
        apiVersion: config.apiVersion as string | undefined,
      });
      return res.json({ success: true, data: result });
    }

    if (provider === "gmail" || provider === "google_calendar") {
      return res.status(400).json({
        success: false,
        error: `${provider} is not enabled in this release. Use WhatsApp for messaging.`,
      });
    }

    const result = await upsertIntegration(req.user.id, provider, config);
    res.json({ success: true, data: { integration: result } });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to configure",
    });
  }
}

export async function validateWhatsAppHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { accessToken, phoneNumberId, apiVersion } = req.body as {
      accessToken?: string;
      phoneNumberId?: string;
      apiVersion?: string;
    };
    const { validateWhatsAppCredentials } = await import("../services/integration.service.js");
    const { normalizeWhatsAppAccessToken } = await import("../services/whatsapp-token.util.js");
    if (!accessToken || !phoneNumberId) {
      return res.status(400).json({ success: false, error: "accessToken and phoneNumberId required" });
    }
    const result = await validateWhatsAppCredentials({
      accessToken: normalizeWhatsAppAccessToken(accessToken),
      phoneNumberId,
      apiVersion,
    });
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error, data: result });
    }
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Validation failed",
    });
  }
}

/** Test Connection — uses saved tenant credentials against Graph API */
export async function testWhatsAppConnectionHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { testWhatsAppConnection } = await import("../services/integration.service.js");
    const result = await testWhatsAppConnection(req.user.id);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error || "Connection failed",
        data: result,
      });
    }
    res.json({
      success: true,
      data: {
        status: "Connected",
        connectionStatus: result.connectionStatus,
        displayName: result.displayName,
        phoneDisplay: result.phoneDisplay,
        wabaName: result.wabaName,
        wabaId: result.wabaId,
        qualityRating: result.qualityRating,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Test connection failed",
    });
  }
}

export async function toggleIntegrationHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { provider, isActive } = req.body;
    await toggleIntegration(req.user.id, provider, isActive);
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed" });
  }
}

export async function sendWhatsApp(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { to, message, contactId, templateName, templateParams } = req.body;
    if (!to) return res.status(400).json({ success: false, error: "Recipient phone (to) is required" });
    const result = await sendWhatsAppMessage(req.user.id, to, message || "", {
      contactId,
      templateName,
      templateParams,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

/** GET current Basic vs Enterprise effective mode (Basic is default). */
export async function getWhatsAppModeHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { resolveWhatsAppMode } = await import("../services/whatsapp-mode.service.js");
    const mode = await resolveWhatsAppMode(req.user.id);
    res.json({ success: true, data: mode });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

/** POST preferred mode: basic (default) | enterprise. Invalid Cloud creds still fall back to basic. */
export async function setWhatsAppPreferredModeHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const raw = String(req.body?.preferredMode || req.body?.mode || "").toLowerCase();
    if (raw !== "basic" && raw !== "enterprise") {
      return res.status(400).json({
        success: false,
        error: "preferredMode must be 'basic' or 'enterprise'",
      });
    }
    const { setPreferredWhatsAppMode } = await import("../services/whatsapp-mode.service.js");
    const mode = await setPreferredWhatsAppMode(req.user.id, raw);
    res.json({ success: true, data: mode });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

/**
 * Confirm manual send after Basic Mode opened WhatsApp Web/App.
 * Body: { sent: boolean, contactId?, logIds?, phone? }
 */
export async function confirmBasicWhatsAppHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const sent = req.body?.sent === true || req.body?.sent === "true" || req.body?.sent === 1;
    const contactId =
      req.body?.contactId != null && req.body.contactId !== ""
        ? String(req.body.contactId)
        : null;
    const phone = req.body?.phone != null ? String(req.body.phone) : undefined;
    const logIds = Array.isArray(req.body?.logIds)
      ? (req.body.logIds as unknown[]).map(String).filter(Boolean)
      : [];
    const { confirmBasicWhatsAppSend } = await import("../services/whatsapp-mode.service.js");
    const result = await confirmBasicWhatsAppSend(req.user.id, {
      sent,
      contactId,
      logIds,
      phone,
    });
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

export async function listWhatsAppHistory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { listWhatsAppHistory: list } = await import("../services/whatsapp.service.js");
    const contactId = req.query.contactId ? String(req.query.contactId) : undefined;
    const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
    const data = await list(req.user.id, { contactId, page, pageSize: 50 });
    res.json({ success: true, data });
  } catch (error: unknown) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    });
  }
}

export async function sendGmailHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { to, subject, body } = req.body;
    const result = await sendGmail(req.user.id, to, subject, body);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(501).json({
      success: false,
      error: error instanceof Error ? error.message : "Not implemented",
    });
  }
}

export async function createCalendarEventHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const event = req.body;
    const result = await createCalendarEvent(req.user.id, event);
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    res.status(501).json({
      success: false,
      error: error instanceof Error ? error.message : "Not implemented",
    });
  }
}
