import { Response } from "express";
import { generateAndSaveRoadmap, getRoadmap } from "../services/roadmap.service.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

export async function generateRoadmap(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const roadmap = await generateAndSaveRoadmap(req.user.id);

    res.status(201).json({
      success: true,
      data: { roadmap },
    });
  } catch (error: unknown) {
    console.error("Generate roadmap error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const status = errorMessage.includes("Business profile not found") ? 400 : 500;

    res.status(status).json({
      success: false,
      error: errorMessage || "Failed to generate roadmap",
    });
  }
}

export async function getCurrentRoadmap(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const roadmap = await getRoadmap(req.user.id);

    if (!roadmap) {
      return res.json({
        success: true,
        data: {
          roadmap: null,
          message: "No roadmap generated yet. Generate one first.",
        },
      });
    }

    res.json({
      success: true,
      data: { roadmap },
    });
  } catch (error: unknown) {
    console.error("Get roadmap error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch roadmap",
    });
  }
}
