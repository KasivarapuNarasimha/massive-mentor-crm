import { AIError, AIRateLimitError } from "../services/ai/errors.js";
import {
  formatAiTemporarilyUnavailableMessage,
  MASSIVE_MENTOR_AI,
  scrubAiProviderBranding,
} from "../services/ai-branding.js";

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return new Error((error as { message: string }).message || fallbackMessage);
  }
  return new Error(fallbackMessage);
}

function extractProviderMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "";
  if (typeof error === "object" && error !== null) {
    const e = error as { message?: unknown; error?: { message?: unknown } };
    if (typeof e.message === "string") return e.message;
    if (typeof e.error?.message === "string") return e.error.message;
  }
  return "";
}

/**
 * Map provider/AI failures to clean user-facing copy.
 * Never return Groq/OpenAI/model names, TPD, or raw provider JSON to the client.
 * Provider details stay in server logs only.
 */
export function sanitizeAiUserError(
  error: unknown,
  fallback = `${MASSIVE_MENTOR_AI} is temporarily unavailable. Please try again.`
): { status: number; message: string } {
  if (error instanceof AIRateLimitError) {
    return {
      status: 429,
      message: [
        `${MASSIVE_MENTOR_AI} usage limit reached`,
        `Please try again after the daily limit resets.`,
      ].join("\n"),
    };
  }

  const raw = extractProviderMessage(error);
  const lower = raw.toLowerCase();

  if (
    /not properly configured|api key|ai_provider|not-configured|provider_not_configured/i.test(
      raw
    )
  ) {
    return {
      status: 503,
      message: `${MASSIVE_MENTOR_AI} is not available right now. Please contact your administrator.`,
    };
  }
  if (
    /rate limit|429|tpd|tokens per day|rate_limit_exceeded|usage limit reached/i.test(raw) ||
    lower.includes("rate_limit")
  ) {
    return {
      status: 429,
      message: [
        `${MASSIVE_MENTOR_AI} usage limit reached`,
        `Please try again after the daily limit resets.`,
      ].join("\n"),
    };
  }
  if (/timed out|timeout|etimedout|econnreset/i.test(raw)) {
    return {
      status: 504,
      message: `${MASSIVE_MENTOR_AI} request timed out. Please try again.`,
    };
  }
  if (
    /model_not_found|does not exist or you do not have access|invalid model/i.test(raw) ||
    lower.includes("model_not_found")
  ) {
    return {
      status: 503,
      message: formatAiTemporarilyUnavailableMessage(),
    };
  }
  if (/parse json|invalid ai|json_object|json_validate|invalid_request|empty response/i.test(raw)) {
    return {
      status: 502,
      message: `${MASSIVE_MENTOR_AI} returned an unexpected response. Please retry.`,
    };
  }
  // Strip leaked provider JSON / status prefixes if present
  if (/^\s*\d{3}\s*[\{\[]/.test(raw) || /"error"\s*:\s*\{/.test(raw)) {
    return { status: 503, message: scrubAiProviderBranding(fallback) };
  }
  return { status: 500, message: scrubAiProviderBranding(fallback) };
}

/** Normalize unknown provider errors into AIError hierarchy without using `any`. */
export function rethrowProviderError(
  provider: "groq" | "openai",
  error: unknown,
  fallbackMessage: string
): never {
  if (error instanceof AIError) {
    throw error;
  }
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  const original = asError(error, fallbackMessage);
  if (status === 429) {
    // Internal error type keeps provider for logs; never send this message to clients.
    throw new AIRateLimitError(provider, original);
  }
  const msg = original.message || fallbackMessage;
  // Prefer stable codes for model issues so HTTP mappers can sanitize cleanly
  if (/model_not_found|does not exist or you do not have access/i.test(msg)) {
    throw new AIError(msg, "MODEL_NOT_FOUND", provider, original);
  }
  throw new AIError(msg, "PROVIDER_ERROR", provider, original);
}
