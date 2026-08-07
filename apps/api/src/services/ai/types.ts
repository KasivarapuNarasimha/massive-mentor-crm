export type AIProviderType = 'openai' | 'groq' | 'gemini' | 'claude';

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  provider: AIProviderType;
}

export interface AIResponse<T = unknown> {
  data: T;
  usage?: AIUsage;
  raw?: unknown; // provider payload for debugging
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AIProvider {
  generateJSON<T = unknown>(
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIResponse<T>>;

  generateText(
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIResponse<string>>;
}
