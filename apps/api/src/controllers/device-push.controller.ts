import { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import {
  registerDevicePushToken,
  refreshDevicePushToken,
  revokeDevicePushToken,
  DEFAULT_PUSH_APP_ID,
} from "../services/device-push.service.js";

const registerSchema = z.object({
  installId: z.string().min(8).max(128),
  platform: z.enum(["android", "ios", "web"]),
  token: z.string().min(20).max(4096),
  provider: z.enum(["fcm", "apns"]).optional().default("fcm"),
  appId: z.string().min(3).max(128).optional(),
  businessId: z.string().min(1).max(64).nullable().optional(),
});

const revokeSchema = z.object({
  installId: z.string().min(8).max(128).optional(),
  appId: z.string().min(3).max(128).optional(),
  allDevices: z.boolean().optional().default(false),
  reason: z.string().max(64).optional(),
});

/** POST /api/devices/push-token — register or refresh */
export async function registerPushToken(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid push token payload",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    const row = await registerDevicePushToken({
      userId: req.user.id,
      installId: body.installId,
      platform: body.platform,
      token: body.token,
      provider: body.provider,
      appId: body.appId || DEFAULT_PUSH_APP_ID,
      businessId: body.businessId ?? null,
    });
    return res.json({
      success: true,
      data: {
        id: row.id,
        installId: row.installId,
        platform: row.platform,
        provider: row.provider,
        appId: row.appId,
        enabled: row.enabled,
        lastSeenAt: row.lastSeenAt,
        businessId: row.businessId,
      },
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    const msg = error instanceof Error ? error.message : "Failed to register push token";
    return res.status(status).json({ success: false, error: msg });
  }
}

/** PUT /api/devices/push-token — explicit refresh (same as register upsert) */
export async function refreshPushToken(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid push token payload",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    const row = await refreshDevicePushToken({
      userId: req.user.id,
      installId: body.installId,
      platform: body.platform,
      token: body.token,
      provider: body.provider,
      appId: body.appId || DEFAULT_PUSH_APP_ID,
      businessId: body.businessId ?? null,
    });
    return res.json({
      success: true,
      data: {
        id: row.id,
        installId: row.installId,
        enabled: row.enabled,
        lastSeenAt: row.lastSeenAt,
      },
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    const msg = error instanceof Error ? error.message : "Failed to refresh push token";
    return res.status(status).json({ success: false, error: msg });
  }
}

/** DELETE /api/devices/push-token — logout revoke (current install by default) */
export async function revokePushToken(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const parsed = revokeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid revoke payload",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    if (!body.allDevices && !body.installId) {
      return res.status(400).json({
        success: false,
        error: "installId is required unless allDevices=true",
      });
    }
    const result = await revokeDevicePushToken({
      userId: req.user.id,
      installId: body.installId,
      appId: body.appId || DEFAULT_PUSH_APP_ID,
      allDevices: body.allDevices,
      reason: body.reason || "logout",
    });
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    const msg = error instanceof Error ? error.message : "Failed to revoke push token";
    return res.status(status).json({ success: false, error: msg });
  }
}
