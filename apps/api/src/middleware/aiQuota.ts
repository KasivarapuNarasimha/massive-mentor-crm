/**
 * Enforce per-business AI quotas before expensive LLM routes.
 */
import { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { checkAiQuota, recordAiUsage, type AiFeature } from "../services/ai-quota.service.js";

export function requireAiQuota(feature: AiFeature | string = "other") {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    (async () => {
      try {
        if (!req.user?.id) {
          return res.status(401).json({ success: false, error: "Not authenticated" });
        }
        const check = await checkAiQuota(req.user.id);
        if (!check.allowed) {
          return res.status(429).json({
            success: false,
            error: check.reason || "Massive Mentor AI usage limit reached",
            code: "AI_QUOTA_EXCEEDED",
            planLabel: check.planLabel,
            dailyLimit: check.dailyLimit,
            usage: {
              dayRequests: check.usage.dayRequests,
            },
            limits: {
              dailyRequests: check.limits.dailyRequests,
              planLabel: check.limits.planLabel,
            },
          });
        }
        // Attach for handlers to record usage
        (req as AuthenticatedRequest & { aiQuota?: typeof check }).aiQuota = check;
        (req as AuthenticatedRequest & { aiFeature?: string }).aiFeature = feature;
        // Record usage after successful response (status < 400)
        res.on("finish", () => {
          if (res.statusCode < 400 && req.user?.id) {
            void recordAiUsage({
              userId: req.user.id,
              businessId: check.businessId,
              feature,
              tokens: 800,
              success: true,
            });
          }
        });
        next();
      } catch (err) {
        console.error("[aiQuota]", err);
        // Fail closed for AI (cost control)
        return res.status(503).json({
          success: false,
          error: "Massive Mentor AI is temporarily unavailable. Please try again.",
          code: "AI_QUOTA_CHECK_FAILED",
        });
      }
    })();
  };
}

/** After successful AI call — record usage (tokens optional). */
export async function trackAiUsage(
  req: AuthenticatedRequest,
  opts?: { tokens?: number; success?: boolean; model?: string }
) {
  if (!req.user?.id) return;
  const feature =
    (req as AuthenticatedRequest & { aiFeature?: string }).aiFeature || "other";
  const quota = (req as AuthenticatedRequest & { aiQuota?: { businessId: string | null } })
    .aiQuota;
  await recordAiUsage({
    userId: req.user.id,
    businessId: quota?.businessId,
    feature,
    tokens: opts?.tokens ?? 800, // conservative default if provider omits
    model: opts?.model,
    success: opts?.success !== false,
  }).catch((e) => console.error("[trackAiUsage]", e));
}
