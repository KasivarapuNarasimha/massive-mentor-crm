/**
 * Meta WhatsApp Cloud API webhook (public — no JWT).
 *
 * GET  /api/integrations/whatsapp/webhook  — hub.mode / hub.verify_token / hub.challenge
 * POST /api/integrations/whatsapp/webhook  — messages + status updates
 *     Requires valid X-Hub-Signature-256 (HMAC-SHA256 with Meta App Secret).
 */
import type { Request, Response } from "express";
import {
  verifyWhatsAppWebhookChallenge,
  processWhatsAppWebhookPayload,
  authenticateWhatsAppWebhookPost,
} from "../services/whatsapp-webhook.service.js";

/** Meta subscription verification (no signature — uses verify_token query params) */
export async function whatsAppWebhookVerify(req: Request, res: Response) {
  try {
    const mode = String(req.query["hub.mode"] ?? req.query["hub_mode"] ?? "");
    const token = String(
      req.query["hub.verify_token"] ?? req.query["hub_verify_token"] ?? ""
    );
    const challenge = String(
      req.query["hub.challenge"] ?? req.query["hub_challenge"] ?? ""
    );

    console.log(
      `[whatsapp-webhook] GET public handler path=${req.path} originalUrl=${req.originalUrl}`
    );

    const result = await verifyWhatsAppWebhookChallenge({ mode, token, challenge });
    if (!result.ok || result.challenge == null) {
      console.warn(
        `[whatsapp-webhook] GET Forbidden reason=${result.reason || "unknown"} ` +
          `mode=${mode} tokenPresent=${!!token} challengePresent=${!!challenge}`
      );
      // Meta expects 403 when verify fails — but body can help debugging via logs only
      return res.status(403).type("text/plain").send("Forbidden");
    }

    // Success: return ONLY the challenge string (Meta requirement)
    console.log(
      `[whatsapp-webhook] GET OK returning challenge matched=${result.matchedUserId || result.reason}`
    );
    return res.status(200).type("text/plain").send(String(result.challenge));
  } catch (e) {
    console.error("[whatsapp-webhook] GET handler error", e);
    return res.status(500).type("text/plain").send("Error");
  }
}

/**
 * Inbound messages + delivery status callbacks.
 * Must be mounted with express.raw so req.body is a Buffer for HMAC.
 */
export async function whatsAppWebhookReceive(req: Request, res: Response) {
  try {
    const rawBody: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(
          typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
          "utf8"
        );

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("[whatsapp-webhook] POST rejected: body is not valid JSON");
      return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }

    const signature =
      (req.headers["x-hub-signature-256"] as string | undefined) ||
      (req.headers["X-Hub-Signature-256"] as string | undefined);

    const auth = await authenticateWhatsAppWebhookPost({
      rawBody,
      signatureHeader: signature,
      parsedBody: parsed,
    });

    if (!auth.ok) {
      console.error(
        `[whatsapp-webhook] POST rejected: ${auth.reason || "signature validation failed"} ` +
          `ip=${req.ip || "unknown"} sigPresent=${!!signature} bodyBytes=${rawBody.length}`
      );
      return res.status(401).json({
        success: false,
        error: "Invalid webhook signature",
      });
    }

    void processWhatsAppWebhookPayload(parsed).catch((err) => {
      console.error("[whatsapp-webhook] process error", err);
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[whatsapp-webhook] handler error", e);
    return res.status(500).json({ success: false, error: "Webhook handler error" });
  }
}
