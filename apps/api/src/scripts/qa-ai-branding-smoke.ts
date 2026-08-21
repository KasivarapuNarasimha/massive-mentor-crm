import {
  formatDailyAiQuotaExceededMessage,
  resolveAiPlanTier,
  scrubAiProviderBranding,
} from "../services/ai-branding.js";
import { sanitizeAiUserError } from "../utils/ai-error.js";
import { AIRateLimitError } from "../services/ai/errors.js";

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
function assert(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? ` — ${detail}` : ""));
}

assert("starter=50", resolveAiPlanTier("starter").dailyRequests === 50);
assert("professional=150", resolveAiPlanTier("professional_monthly").dailyRequests === 150);
assert("business=300", resolveAiPlanTier("business").dailyRequests === 300);
assert("enterprise high", resolveAiPlanTier("enterprise").dailyRequests >= 1000);

const msg = formatDailyAiQuotaExceededMessage({ planLabel: "Professional", dailyLimit: 150 });
assert("quota message branded", msg.includes("Massive Mentor AI usage limit reached") && msg.includes("150") && msg.includes("Professional"));
assert("quota message no groq", !/groq|openai|gpt-oss|tpd/i.test(msg));

const rate = sanitizeAiUserError(new AIRateLimitError("groq")).message;
assert("rate limit sanitized", rate.includes("Massive Mentor AI") && !/groq/i.test(rate));

const provider = sanitizeAiUserError(
  new Error('429 {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` TPD"}}')
).message;
assert("provider json scrubbed", !/groq|openai|gpt-oss|tpd/i.test(provider) && /Massive Mentor AI/i.test(provider));

const scrubbed = scrubAiProviderBranding("Powered by Groq / OpenAI gpt-oss-120b");
assert("scrub helper", !/groq|openai|gpt-oss/i.test(scrubbed));

const failed = checks.filter((c) => !c.ok);
console.log(`\nPassed: ${checks.length - failed.length}/${checks.length}`);
process.exitCode = failed.length ? 1 : 0;
