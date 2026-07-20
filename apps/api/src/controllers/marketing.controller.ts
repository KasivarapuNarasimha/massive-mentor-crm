import { Response } from "express";
import { generateMarketingContent, MarketingInputs } from "../services/marketing.service.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

export async function generateMarketing(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const { businessName, industry, location, targetAudience, goal } = req.body;

    if (!businessName || !industry || !targetAudience || !goal) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: businessName, industry, targetAudience, and goal are required.",
      });
    }

    const inputs: MarketingInputs = {
      businessName: String(businessName).trim(),
      industry: String(industry).trim(),
      location: location ? String(location).trim() : undefined,
      targetAudience: String(targetAudience).trim(),
      goal: String(goal).trim(),
    };

    const result = await generateMarketingContent(inputs);

    res.status(201).json({
      success: true,
      data: {
        inputs,
        result,
      },
    });
  } catch (error: unknown) {
    console.error("Generate marketing content error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const status = errorMessage.includes("Business profile") ? 400 : 500;

    res.status(status).json({
      success: false,
      error: errorMessage || "Failed to generate marketing content",
    });
  }
}
