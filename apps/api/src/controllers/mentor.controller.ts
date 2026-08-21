import { Response } from "express";
import { sendChatMessage, getChatHistory } from "../services/mentor.service.js";
import { AuthenticatedRequest } from "../middleware/auth.js";
import { sanitizeAiUserError } from "../utils/ai-error.js";

export async function chatWithMentor(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { message } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Message is required and cannot be empty",
      });
    }

    const result = await sendChatMessage(req.user.id, message.trim());

    res.json({
      success: true,
      data: {
        message: result.message,
        usage: result.usage,
      },
    });
  } catch (error: unknown) {
    console.error("Mentor chat error:", error);
    const { status, message } = sanitizeAiUserError(
      error,
      "AI Mentor is temporarily unavailable. Please try again."
    );
    res.status(status).json({
      success: false,
      error: message,
    });
  }
}

export async function getMentorHistory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const messages = await getChatHistory(req.user.id, limit);

    res.json({
      success: true,
      data: { messages },
    });
  } catch (error: unknown) {
    console.error("Get mentor history error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch chat history",
    });
  }
}
