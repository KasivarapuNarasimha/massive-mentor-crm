/**
 * Per-business AI usage quotas, rate limits, and cost controls.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { env } from "../config/env.js";

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

const DEFAULT_DAILY_REQUESTS = Number(process.env.AI_DAILY_REQUEST_LIMIT || 200);
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

export async function getAiQuotaLimits(businessId: string | null) {
  if (!businessId) {
    return {
      dailyRequests: DEFAULT_DAILY_REQUESTS,
      monthlyRequests: DEFAULT_MONTHLY_REQUESTS,
      dailyTokens: DEFAULT_DAILY_TOKENS,
      monthlyCostUsd: DEFAULT_MONTHLY_COST_USD,
    };
  }
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true, plan: true },
  });
  const settings = (biz?.settings || {}) as Record<string, unknown>;
  const ai = (settings.aiQuota || {}) as Record<string, number>;
  // Plan tiers
  let mult = 1;
  if (biz?.plan === "professional" || biz?.plan === "professional_monthly") mult = 2;
  if (biz?.plan === "enterprise" || biz?.plan === "enterprise_monthly") mult = 5;
  if (biz?.plan === "trial") mult = 0.5;

  return {
    dailyRequests: ai.dailyRequests ?? Math.floor(DEFAULT_DAILY_REQUESTS * mult),
    monthlyRequests: ai.monthlyRequests ?? Math.floor(DEFAULT_MONTHLY_REQUESTS * mult),
    dailyTokens: ai.dailyTokens ?? Math.floor(DEFAULT_DAILY_TOKENS * mult),
    monthlyCostUsd: ai.monthlyCostUsd ?? DEFAULT_MONTHLY_COST_USD * mult,
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
  limits: Awaited<ReturnType<typeof getAiQuotaLimits>>;
  businessId: string | null;
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
      reason: `Daily AI request limit reached (${limits.dailyRequests}). Try again tomorrow or upgrade your plan.`,
      usage,
      limits,
      businessId,
    };
  }
  if (monthRequests >= limits.monthlyRequests) {
    return {
      allowed: false,
      reason: `Monthly AI request limit reached (${limits.monthlyRequests}).`,
      usage,
      limits,
      businessId,
    };
  }
  if (dayTokens >= limits.dailyTokens) {
    return {
      allowed: false,
      reason: `Daily AI token budget exhausted.`,
      usage,
      limits,
      businessId,
    };
  }
  if (monthCostUsd >= limits.monthlyCostUsd) {
    return {
      allowed: false,
      reason: `Monthly AI cost budget ($${limits.monthlyCostUsd}) reached.`,
      usage,
      limits,
      businessId,
    };
  }

  return { allowed: true, usage, limits, businessId };
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
