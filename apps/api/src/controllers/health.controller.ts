import { Response } from "express";
import { 
  getLatestHealthScore, 
  getRecentHealthScores,
  calculateAndStoreHealthScore 
} from "@/services/health.service";
import { AuthenticatedRequest } from "@/middleware/auth";

export async function getHealthScore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const latestScore = await getLatestHealthScore(req.user.id);

    if (!latestScore) {
      return res.json({
        success: true,
        data: {
          score: null,
          recent: [],
          message: "No health score calculated yet. Please recalculate.",
        },
      });
    }

    const recentScores = await getRecentHealthScores(req.user.id, 3);

    res.json({
      success: true,
      data: { 
        score: latestScore,
        recent: recentScores 
      },
    });
  } catch (error: unknown) {
    console.error("Get health score error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch health score",
    });
  }
}

export async function recalculateHealthScore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const newScore = await calculateAndStoreHealthScore(req.user.id);

    res.json({
      success: true,
      data: { score: newScore },
    });
  } catch (error: unknown) {
    console.error("Recalculate health score error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const status = errorMessage.includes("Business profile not found") ? 400 : 500;
    
    res.status(status).json({
      success: false,
      error: errorMessage || "Failed to recalculate health score",
    });
  }
}
