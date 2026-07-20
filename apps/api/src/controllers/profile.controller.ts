import { Response } from "express";
import { getProfile, upsertProfile, profileSchema } from "../services/profile.service.js";
import { AuthenticatedRequest } from "../middleware/auth.js";

export async function getBusinessProfile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const profile = await getProfile(req.user.id);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Business profile not found",
      });
    }

    res.json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch business profile",
    });
  }
}

export async function updateBusinessProfile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const parsed = profileSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message || "Invalid input",
      });
    }

    const profile = await upsertProfile(req.user.id, parsed.data);

    res.json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save business profile",
    });
  }
}
