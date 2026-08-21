import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { runAiCommand, confirmAiCommand } from "../services/ai-command/service.js";
import { sanitizeAiUserError } from "../utils/ai-error.js";
import { trackAiUsage } from "../middleware/aiQuota.js";

export async function runAiCommandHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const message = String(req.body?.message || "").trim();
    if (!message && !req.body?.choices) {
      return res.status(400).json({ success: false, error: "Message is required" });
    }
    const result = await runAiCommand({
      userId: req.user.id,
      message: message || "(selection)",
      sessionId: req.body?.sessionId ? String(req.body.sessionId) : undefined,
      choices: req.body?.choices && typeof req.body.choices === "object" ? req.body.choices : undefined,
      locale: req.body?.locale ? String(req.body.locale) : undefined,
    });
    await trackAiUsage(req, { success: true, tokens: 1200 });
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[ai-command] run:", error);
    const friendly = sanitizeAiUserError(error);
    return res.status(friendly.status).json({ success: false, error: friendly.message });
  }
}

export async function confirmAiCommandHandler(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const confirmToken = String(req.body?.confirmToken || "").trim();
    if (!confirmToken) {
      return res.status(400).json({ success: false, error: "confirmToken is required" });
    }
    const result = await confirmAiCommand({
      userId: req.user.id,
      confirmToken,
      sessionId: req.body?.sessionId ? String(req.body.sessionId) : undefined,
    });
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[ai-command] confirm:", error);
    const friendly = sanitizeAiUserError(error);
    return res.status(friendly.status).json({ success: false, error: friendly.message });
  }
}
