import { Response } from "express";
import { generateAndSaveSWOT, getLatestSWOT } from "@/services/swot.service";
import { AuthenticatedRequest } from "@/middleware/auth";

export async function generateSWOT(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const swot = await generateAndSaveSWOT(req.user.id);

    res.status(201).json({
      success: true,
      data: { swot },
    });
  } catch (error: unknown) {
    console.error("Generate SWOT error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const status = errorMessage.includes("Business profile not found") ? 400 : 500;

    res.status(status).json({
      success: false,
      error: errorMessage || "Failed to generate SWOT analysis",
    });
  }
}

export async function getLatestSWOTAnalysis(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const swot = await getLatestSWOT(req.user.id);

    if (!swot) {
      return res.json({
        success: true,
        data: {
          swot: null,
          message: "No SWOT analysis found. Generate one first.",
        },
      });
    }

    res.json({
      success: true,
      data: { swot },
    });
  } catch (error: unknown) {
    console.error("Get latest SWOT error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch SWOT analysis",
    });
  }
}
