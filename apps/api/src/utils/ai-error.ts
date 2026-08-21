import { AIError, AIRateLimitError } from "../services/ai/errors.js";

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
 * Never return raw Groq/OpenAI JSON blobs to the client.
 */
export function sanitizeAiUserError(
  error: unknown,
  fallback = "AI service is temporarily unavailable. Please try again."
): { status: number; message: string } {
  const raw = extractProviderMessage(error);
  const lower = raw.toLowerCase();

  if (
    /not properly configured|api key|ai_provider|not-configured|provider_not_configured/i.test(
      raw
    )
  ) {
    return {
      status: 503,
      message:
        "AI provider not configured — set a valid GROQ_API_KEY (or OpenAI key) and restart the API",
    };
  }
  if (/rate limit|429/i.test(raw)) {
    return { status: 429, message: "AI rate limit reached — wait a moment and try again" };
  }
  if (/timed out|timeout|etimedout|econnreset/i.test(raw)) {
    return { status: 504, message: "AI request timed out — try again" };
  }
  if (
    /model_not_found|does not exist or you do not have access|invalid model/i.test(raw) ||
    lower.includes("model_not_found")
  ) {
    return {
      status: 503,
      message:
        "AI model is unavailable. Update GROQ_MODEL to a supported Groq model and restart the API.",
    };
  }
  if (/parse json|invalid ai|json_object|json_validate|invalid_request|empty response/i.test(raw)) {
    return { status: 502, message: "Invalid AI response format — please retry" };
  }
  // Strip leaked provider JSON / status prefixes if present
  if (/^\s*\d{3}\s*[\{\[]/.test(raw) || /"error"\s*:\s*\{/.test(raw)) {
    return { status: 503, message: fallback };
  }
  return { status: 500, message: fallback };
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
    throw new AIRateLimitError(provider, original);
  }
  const msg = original.message || fallbackMessage;
  // Prefer stable codes for model issues so HTTP mappers can sanitize cleanly
  if (/model_not_found|does not exist or you do not have access/i.test(msg)) {
    throw new AIError(msg, "MODEL_NOT_FOUND", provider, original);
  }
  throw new AIError(msg, "PROVIDER_ERROR", provider, original);
}
