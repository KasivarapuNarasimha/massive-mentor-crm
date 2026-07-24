/**
 * Meta WhatsApp Cloud API webhook (public — no JWT).
 *
 * GET  /api/integrations/whatsapp/webhook  — hub.mode / hub.verify_token / hub.challenge
 * POST /api/integrations/whatsapp/webhook  — messages + status updates
 */
import type { Request, Response } from "express";
import {
  verifyWhatsAppWebhookChallenge,
  processWhatsAppWebhookPayload,
} from "../services/whatsapp-webhook.service.js";

/** Meta subscription verification */
export async function whatsAppWebhookVerify(req: Request, res: Response) {
  const mode = String(req.query["hub.mode"] || req.query["hub_mode"] || "");
  const token = String(
    req.query["hub.verify_token"] || req.query["hub_verify_token"] || ""
  );
  const challenge = String(
    req.query["hub.challenge"] || req.query["hub_challenge"] || ""
  );

  const result = await verifyWhatsAppWebhookChallenge({ mode, token, challenge });
  if (!result.ok || result.challenge == null) {
    console.warn(
      `[whatsapp-webhook] verify failed mode=${mode} tokenPresent=${!!token}`
    );
    return res.status(403).send("Forbidden");
  }
  // Meta expects the raw challenge string (not JSON)
  res.status(200).type("text/plain").send(result.challenge);
}

/** Inbound messages + delivery status callbacks */
export async function whatsAppWebhookReceive(req: Request, res: Response) {
  try {
    // Always 200 quickly so Meta does not retry aggressively
    const body = req.body;
    void processWhatsAppWebhookPayload(body).catch((err) => {
      console.error("[whatsapp-webhook] process error", err);
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error("[whatsapp-webhook] handler error", e);
    return res.status(200).json({ success: true });
  }
}
