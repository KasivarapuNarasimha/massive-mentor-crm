import { AIUsage } from './types.js';

const isProd = () => process.env.NODE_ENV === "production";

export function logAIUsage(usage: AIUsage, operation?: string) {
  if (isProd()) {
    // Compact production metric line (no full prompt/completion dump)
    console.info(
      `[AI] ${usage.provider}/${usage.model} op=${operation || "unknown"} tokens=${usage.totalTokens ?? 0}`
    );
    return;
  }
  const timestamp = new Date().toISOString();
  console.log(`[AI] ${timestamp} | Provider: ${usage.provider} | Model: ${usage.model} | Operation: ${operation || 'unknown'}`);
  console.log(`[AI] Tokens → Prompt: ${usage.promptTokens} | Completion: ${usage.completionTokens} | Total: ${usage.totalTokens}`);
}

export function logAIError(error: Error, provider: string, operation?: string) {
  const timestamp = new Date().toISOString();
  console.error(`[AI ERROR] ${timestamp} | Provider: ${provider} | Operation: ${operation || 'unknown'}`);
  console.error(`[AI ERROR] ${error.message}`);
  if (!isProd() && error.stack) {
    console.error(error.stack);
  }
}
