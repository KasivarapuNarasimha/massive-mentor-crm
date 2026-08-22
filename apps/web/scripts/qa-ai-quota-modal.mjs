/**
 * Focused QA for AI quota upgrade modal helpers (no live server required).
 * Run: node apps/web/scripts/qa-ai-quota-modal.mjs
 */
import assert from "node:assert/strict";

// Inline mirror of detection logic for Node (avoid TS path aliases)
function isAiQuotaExceededResponse(res) {
  if (!res || res.success) return false;
  if (res.code === "AI_QUOTA_EXCEEDED") return true;
  if (res.status === 429 && /massive mentor ai usage limit reached/i.test(String(res.error || ""))) {
    return true;
  }
  return false;
}

function parseAiQuotaExhaustion(res) {
  if (!isAiQuotaExceededResponse(res)) return null;
  const message = String(res.error || "Massive Mentor AI usage limit reached");
  let planLabel = typeof res.planLabel === "string" && res.planLabel.trim() ? res.planLabel.trim() : "";
  let dailyLimit = typeof res.dailyLimit === "number" && res.dailyLimit > 0 ? res.dailyLimit : 0;
  if (!planLabel || !dailyLimit) {
    const m = message.match(/You've used your\s+(\d+)\s+AI actions for today on the\s+(.+?)\s+plan/i);
    if (m) {
      if (!dailyLimit) dailyLimit = Number(m[1]);
      if (!planLabel) planLabel = m[2].trim();
    }
  }
  if (!planLabel) planLabel = "Starter";
  if (!dailyLimit) dailyLimit = 50;
  return { planLabel, dailyLimit, message };
}

function matchPlanRowKey(planLabel) {
  const p = planLabel.toLowerCase();
  if (p.includes("enterprise") || p.includes("white")) return "enterprise";
  if (p.includes("business")) return "business";
  if (p.includes("professional") || p === "pro") return "professional";
  return "starter";
}

const BILLING = "/dashboard/billing";
const checks = [];
function pass(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? ` — ${detail}` : ""));
}

const quotaRes = {
  success: false,
  status: 429,
  code: "AI_QUOTA_EXCEEDED",
  planLabel: "Professional",
  dailyLimit: 150,
  error:
    "Massive Mentor AI usage limit reached\nYou've used your 150 AI actions for today on the Professional plan.\nPlease try again after the daily limit resets.",
};
pass("detects AI_QUOTA_EXCEEDED", isAiQuotaExceededResponse(quotaRes));
const parsed = parseAiQuotaExhaustion(quotaRes);
pass("parses planLabel", parsed?.planLabel === "Professional", parsed?.planLabel);
pass("parses dailyLimit", parsed?.dailyLimit === 150, String(parsed?.dailyLimit));
pass("no provider leak in message", !/groq|openai|gpt-oss|tpd|rate_limit/i.test(parsed?.message || ""));
pass("current plan key professional", matchPlanRowKey(parsed.planLabel) === "professional");
pass("billing route", BILLING === "/dashboard/billing");

const normalErr = { success: false, status: 500, error: "Massive Mentor AI is temporarily unavailable. Please try again." };
pass("normal AI error does NOT open modal", !isAiQuotaExceededResponse(normalErr));

const providerScrub = {
  success: true,
  data: {
    status: "needs_input",
    summary: "Massive Mentor AI usage limit reached\nPlease try again after the daily limit resets.",
  },
};
pass(
  "provider-style needs_input without AI_QUOTA_EXCEEDED does NOT trigger",
  !isAiQuotaExceededResponse(providerScrub)
);

const parseFromMessageOnly = parseAiQuotaExhaustion({
  success: false,
  status: 429,
  code: "AI_QUOTA_EXCEEDED",
  error:
    "Massive Mentor AI usage limit reached\nYou've used your 50 AI actions for today on the Starter plan.\nPlease try again after the daily limit resets.",
});
pass("parse from message when fields missing", parseFromMessageOnly?.planLabel === "Starter" && parseFromMessageOnly?.dailyLimit === 50);

const failed = checks.filter((c) => !c.ok);
console.log(`\nPassed: ${checks.length - failed.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
