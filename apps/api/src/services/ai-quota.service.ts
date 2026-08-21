/**
 * Per-business AI usage quotas, rate limits, and cost controls.
 * User-facing copy is branded as Massive Mentor AI only.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { env } from "../config/env.js";
import {
  formatDailyAiQuotaExceededMessage,
  resolveAiPlanTier,
  type AiPlanLabel,
} from "./ai-branding.js";

export type AiFeature =
  | "mentor"
  | "lead_score"
  | "followup"
  | "whatsapp"
  | "email"
  | "proposal"
  | "forecast"
  | "meeting_summary"
  | "reminders"
  | "next_action"
  | "ai_command"
  | "other";

const DEFAULT_MONTHLY_REQUESTS = Number(process.env.AI_MONTHLY_REQUEST_LIMIT || 3000);
const DEFAULT_DAILY_TOKENS = Number(process.env.AI_DAILY_TOKEN_LIMIT || 500_000);
const DEFAULT_MONTHLY_COST_USD = Number(process.env.AI_MONTHLY_COST_USD_LIMIT || 50);

/** Rough cost estimate USD per 1k tokens (conservative). */
const COST_PER_1K_TOKENS = Number(process.env.AI_COST_PER_1K_TOKENS || 0.002);

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export type AiQuotaLimits = {
  dailyRequests: number;
  monthlyRequests: number;
  dailyTokens: number;
  monthlyCostUsd: number;
  planKey: string;
  planLabel: AiPlanLabel;
};

export async function getAiQuotaLimits(businessId: string | null): Promise<AiQuotaLimits> {
  if (!businessId) {
    const tier = resolveAiPlanTier("starter");
    return {
      dailyRequests: tier.dailyRequests,
      monthlyRequests: DEFAULT_MONTHLY_REQUESTS,
      dailyTokens: DEFAULT_DAILY_TOKENS,
      monthlyCostUsd: DEFAULT_MONTHLY_COST_USD,
      planKey: tier.planKey,
      planLabel: tier.planLabel,
    };
  }
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true, plan: true },
  });
  const settings = (biz?.settings || {}) as Record<string, unknown>;
  const ai = (settings.aiQuota || {}) as Record<string, number>;
  const tier = resolveAiPlanTier(biz?.plan);

  // Enterprise / white-label may override via settings; others use fixed tier caps.
  const dailyRequests =
    typeof ai.dailyRequests === "number" && ai.dailyRequests > 0
      ? ai.dailyRequests
      : tier.dailyRequests;

  const monthlyMult =
    tier.planKey === "enterprise" ? 5 : tier.planKey === "business" ? 3 : tier.planKey === "professional" ? 2 : 1;

  return {
    dailyRequests,
    monthlyRequests:
      typeof ai.monthlyRequests === "number" && ai.monthlyRequests > 0
        ? ai.monthlyRequests
        : Math.floor(DEFAULT_MONTHLY_REQUESTS * monthlyMult),
    dailyTokens:
      typeof ai.dailyTokens === "number" && ai.dailyTokens > 0
        ? ai.dailyTokens
        : Math.floor(DEFAULT_DAILY_TOKENS * monthlyMult),
    monthlyCostUsd:
      typeof ai.monthlyCostUsd === "number" && ai.monthlyCostUsd > 0
        ? ai.monthlyCostUsd
        : DEFAULT_MONTHLY_COST_USD * monthlyMult,
    planKey: tier.planKey,
    planLabel: tier.planLabel,
  };
}

export async function checkAiQuota(userId: string): Promise<{
  allowed: boolean;
  reason?: string;
  usage: {
    dayRequests: number;
    monthRequests: number;
    dayTokens: number;
    monthCostUsd: number;
  };
  limits: AiQuotaLimits;
  businessId: string | null;
  planLabel: AiPlanLabel;
  dailyLimit: number;
}> {
  const businessId = await getUserBusinessId(userId);
  const limits = await getAiQuotaLimits(businessId);
  const day = dayKey();
  const month = monthKey();

  const [dayAgg, monthAgg] = await Promise.all([
    prisma.aiUsageEvent.aggregate({
      where: {
        ...(businessId ? { businessId } : { userId }),
        dayKey: day,
      },
      _sum: { tokens: true },
      _count: true,
    }),
    prisma.aiUsageEvent.aggregate({
      where: {
        ...(businessId ? { businessId } : { userId }),
        monthKey: month,
      },
      _sum: { tokens: true, costUsd: true },
      _count: true,
    }),
  ]);

  const dayRequests = dayAgg._count;
  const monthRequests = monthAgg._count;
  const dayTokens = dayAgg._sum.tokens || 0;
  const monthCostUsd = Number(monthAgg._sum.costUsd || 0);

  const usage = { dayRequests, monthRequests, dayTokens, monthCostUsd };

  if (dayRequests >= limits.dailyRequests) {
    return {
      allowed: false,
      reason: formatDailyAiQuotaExceededMessage({
        planLabel: limits.planLabel,
        dailyLimit: limits.dailyRequests,
      }),
      usage,
      limits,
      businessId,
      planLabel: limits.planLabel,
      dailyLimit: limits.dailyRequests,
    };
  }
  if (monthRequests >= limits.monthlyRequests) {
    return {
      allowed: false,
      reason: [
        `Massive Mentor AI usage limit reached`,
        `You've reached your monthly AI action allowance on the ${limits.planLabel} plan.`,
        `Please try again next month or contact support about a higher limit.`,
      ].join("\n"),
      usage,
      limits,
      businessId,
      planLabel: limits.planLabel,
      dailyLimit: limits.dailyRequests,
    };
  }
  if (dayTokens >= limits.dailyTokens) {
    return {
      allowed: false,
      reason: formatDailyAiQuotaExceededMessage({
        planLabel: limits.planLabel,
        dailyLimit: limits.dailyRequests,
      }),
      usage,
      limits,
      businessId,
      planLabel: limits.planLabel,
      dailyLimit: limits.dailyRequests,
    };
  }
  if (monthCostUsd >= limits.monthlyCostUsd) {
    return {
      allowed: false,
      reason: [
        `Massive Mentor AI usage limit reached`,
        `You've reached your monthly AI allowance on the ${limits.planLabel} plan.`,
        `Please try again after the limit resets or contact support.`,
      ].join("\n"),
      usage,
      limits,
      businessId,
      planLabel: limits.planLabel,
      dailyLimit: limits.dailyRequests,
    };
  }

  return {
    allowed: true,
    usage,
    limits,
    businessId,
    planLabel: limits.planLabel,
    dailyLimit: limits.dailyRequests,
  };
}

export async function recordAiUsage(opts: {
  userId: string;
  businessId?: string | null;
  feature: AiFeature | string;
  tokens?: number;
  model?: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const tokens = Math.max(0, opts.tokens || 0);
  const costUsd = (tokens / 1000) * COST_PER_1K_TOKENS;
  const now = new Date();
  await prisma.aiUsageEvent.create({
    data: {
      userId: opts.userId,
      businessId: opts.businessId || null,
      feature: opts.feature,
      tokens,
      costUsd,
      // Persist model for ops/debug only — never returned in user-facing quota errors.
      model: opts.model || env.GROQ_MODEL || null,
      success: opts.success !== false,
      dayKey: dayKey(now),
      monthKey: monthKey(now),
      metadata: (opts.metadata ?? undefined) as object | undefined,
    },
  });
}

export async function getAiUsageSummary(userId: string) {
  const check = await checkAiQuota(userId);
  return {
    ...check,
    remaining: {
      dayRequests: Math.max(0, check.limits.dailyRequests - check.usage.dayRequests),
      monthRequests: Math.max(0, check.limits.monthlyRequests - check.usage.monthRequests),
      dayTokens: Math.max(0, check.limits.dailyTokens - check.usage.dayTokens),
      monthCostUsd: Math.max(0, check.limits.monthlyCostUsd - check.usage.monthCostUsd),
    },
  };
}
