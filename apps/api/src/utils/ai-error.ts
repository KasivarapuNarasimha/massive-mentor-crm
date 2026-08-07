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
  throw new AIError(original.message || fallbackMessage, "PROVIDER_ERROR", provider, original);
}
