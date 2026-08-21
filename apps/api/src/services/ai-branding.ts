/**
 * User-facing Massive Mentor AI branding helpers.
 * Never expose third-party provider/model names to CRM users.
 */

export const MASSIVE_MENTOR_AI = "Massive Mentor AI";

/** Daily AI action caps by commercial plan tier. */
export const AI_PLAN_DAILY_ACTIONS = {
  starter: 50,
  professional: 150,
  business: 300,
  /** High default; settings.aiQuota.dailyRequests can customize further. */
  enterprise: 5000,
} as const;

export type AiPlanLabel = "Starter" | "Professional" | "Business" | "Enterprise";

export function resolveAiPlanTier(plan: string | null | undefined): {
  planKey: keyof typeof AI_PLAN_DAILY_ACTIONS;
  planLabel: AiPlanLabel;
  dailyRequests: number;
} {
  const p = String(plan || "starter").toLowerCase();
  if (
    p.includes("enterprise") ||
    p.includes("white_label") ||
    p.includes("whitelabel") ||
    p.includes("white-label")
  ) {
    return {
      planKey: "enterprise",
      planLabel: "Enterprise",
      dailyRequests: AI_PLAN_DAILY_ACTIONS.enterprise,
    };
  }
  if (p.includes("business")) {
    return {
      planKey: "business",
      planLabel: "Business",
      dailyRequests: AI_PLAN_DAILY_ACTIONS.business,
    };
  }
  if (p.includes("professional") || p === "pro" || p.startsWith("pro_")) {
    return {
      planKey: "professional",
      planLabel: "Professional",
      dailyRequests: AI_PLAN_DAILY_ACTIONS.professional,
    };
  }
  // starter, basic, trial, unknown → Starter tier caps
  return {
    planKey: "starter",
    planLabel: "Starter",
    dailyRequests: AI_PLAN_DAILY_ACTIONS.starter,
  };
}

/** Multi-line user-facing daily quota exhaustion copy. */
export function formatDailyAiQuotaExceededMessage(opts: {
  planLabel: string;
  dailyLimit: number;
}): string {
  const limit = opts.dailyLimit;
  const plan = opts.planLabel || "Starter";
  return [
    `${MASSIVE_MENTOR_AI} usage limit reached`,
    `You've used your ${limit} AI actions for today on the ${plan} plan.`,
    `Please try again after the daily limit resets.`,
  ].join("\n");
}

/** Provider / capacity limits — still branded, never names Groq/OpenAI/models. */
export function formatAiTemporarilyUnavailableMessage(): string {
  return `${MASSIVE_MENTOR_AI} is temporarily unavailable. Please try again in a few minutes.`;
}

/** Strip accidental third-party provider/model leakage from any user-facing string. */
export function scrubAiProviderBranding(message: string): string {
  let out = message;
  out = out.replace(/\bgroq\b/gi, MASSIVE_MENTOR_AI);
  out = out.replace(/\bopenai\b/gi, MASSIVE_MENTOR_AI);
  out = out.replace(/\bgpt-oss[-\w]*/gi, "AI model");
  out = out.replace(/\bgpt-4[^\s,]*/gi, "AI model");
  out = out.replace(/\bclaude[^\s,]*/gi, "AI model");
  out = out.replace(/\btpd\b/gi, "daily limit");
  out = out.replace(/rate_limit_exceeded/gi, "usage limit reached");
  out = out.replace(/tokens per day/gi, "daily usage");
  out = out.replace(/GROQ_API_KEY/gi, "AI configuration");
  out = out.replace(/GROQ_MODEL/gi, "AI configuration");
  out = out.replace(/AI_PROVIDER/gi, "AI configuration");
  // Collapse awkward doubles after replacements
  out = out.replace(new RegExp(`${MASSIVE_MENTOR_AI} / your AI provider`, "gi"), MASSIVE_MENTOR_AI);
  return out;
}
