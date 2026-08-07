import { AIProvider, AIResponse, GenerateOptions } from './ai/types.js';
import { AIProviderNotConfiguredError } from './ai/errors.js';
import { PromptTemplates, fillTemplate } from './ai/prompt-templates.js';
import { logAIError } from './ai/logger.js';
import { env } from '../config/env.js';

function isValidOpenAIKey(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes('placeholder')) return false;
  if (trimmed.includes('your-key') || trimmed.includes('replace-with')) return false;
  return trimmed.startsWith('sk-');
}

function isValidGroqKey(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes('placeholder')) return false;
  if (trimmed.includes('your-key') || trimmed.includes('replace-with')) return false;
  return trimmed.startsWith('gsk_');
}

export class AIService {
  private provider!: AIProvider;
  private providerType!: string;

  private constructor() {
    // Private constructor - use AIService.create() instead
  }

  static async create(): Promise<AIService> {
    const instance = new AIService();
    await instance.init();
    return instance;
  }

  private async init() {
    // Values now come from validated env (Zod) instead of raw process.env
    const providerType = env.AI_PROVIDER;
    this.providerType = providerType;

    if (providerType === 'openai') {
      const apiKey = env.OPENAI_API_KEY;
      const model = env.OPENAI_MODEL;

      if (!isValidOpenAIKey(apiKey)) {
        console.error('\n========================================');
        console.error('❌  OPENAI API KEY CONFIGURATION ERROR');
        console.error('========================================');
        console.error('OPENAI_API_KEY is missing, invalid, or still a placeholder.');
        console.error('Current value:', apiKey ? `"${apiKey}"` : '(not set)');
        console.error('');
        console.error('Please update apps/api/.env with a real OpenAI key:');
        console.error('  OPENAI_API_KEY="sk-proj-..."');
        console.error('');
        console.error('You can get a key at: https://platform.openai.com/api-keys');
        console.error('========================================\n');

        throw new AIProviderNotConfiguredError('openai');
      }

      const { OpenAIProvider } = await import('./ai/providers/openai.provider.js');
      console.log(`[AI] OpenAI provider initialized successfully (model: ${model})`);
      this.provider = new OpenAIProvider(apiKey!, model);

    } else if (providerType === 'groq') {
      const apiKey = env.GROQ_API_KEY;
      const model = env.GROQ_MODEL;

      if (!isValidGroqKey(apiKey)) {
        console.error('\n========================================');
        console.error('❌  GROQ API KEY CONFIGURATION ERROR');
        console.error('========================================');
        console.error('GROQ_API_KEY is missing, invalid, or still a placeholder.');
        console.error('Current value:', apiKey ? `"${apiKey}"` : '(not set)');
        console.error('');
        console.error('Please update apps/api/.env with a real Groq key:');
        console.error('  GROQ_API_KEY="gsk_..."');
        console.error('');
        console.error('You can get a key at: https://console.groq.com/keys');
        console.error('========================================\n');

        throw new AIProviderNotConfiguredError('groq');
      }

      const { GroqProvider } = await import('./ai/providers/groq.provider.js');
      console.log(`[AI] Groq provider initialized successfully (model: ${model})`);
      this.provider = new GroqProvider(apiKey!, model);

    } else {
      throw new AIProviderNotConfiguredError(providerType);
    }
  }

  /**
   * Generate structured JSON output using a named prompt template.
   */
  async generateFromTemplate<T = any>(
    templateName: keyof typeof PromptTemplates,
    variables: Record<string, any>,
    options?: GenerateOptions
  ): Promise<AIResponse<T>> {
    try {
      const template = PromptTemplates[templateName];
      const prompt = fillTemplate(template, variables);

      return await this.provider.generateJSON<T>(prompt, options);
    } catch (error: unknown) {
      logAIError(error, this.providerType, `generateFromTemplate:${templateName}`);
      throw error;
    }
  }

  /**
   * Low-level method for direct prompts (use sparingly).
   */
  async generateJSON<T = unknown>(
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIResponse<T>> {
    try {
      return await this.provider.generateJSON<T>(prompt, options);
    } catch (error: unknown) {
      logAIError(error, this.providerType, 'generateJSON');
      throw error;
    }
  }

  async generateText(
    prompt: string,
    options?: GenerateOptions
  ): Promise<AIResponse<string>> {
    try {
      return await this.provider.generateText(prompt, options);
    } catch (error: unknown) {
      logAIError(error, this.providerType, 'generateText');
      throw error;
    }
  }

  getProvider(): string {
    return this.providerType;
  }
}

// Singleton instance for easy import across the application
let aiServiceInstance: AIService | null = null;

export async function getAIService(): Promise<AIService> {
  if (!aiServiceInstance) {
    try {
      aiServiceInstance = await AIService.create();
    } catch (error) {
      console.warn('[AI] AI Service could not be initialized. AI features will be unavailable until properly configured.');
      console.warn('[AI] Error:', (error as Error).message);
      // Return a dummy service that throws on use
      const msg =
        "AI Service is not properly configured. Please set a valid API key for your chosen AI_PROVIDER in apps/api/.env";
      // Typed stub — same public surface as AIService without `as any`
      const stub = {
        generateFromTemplate: async () => {
          throw new Error(msg);
        },
        generateJSON: async () => {
          throw new Error(msg);
        },
        generateText: async () => {
          throw new Error(msg);
        },
        getProvider: () => "not-configured",
      };
      return stub as unknown as AIService;
    }
  }
  return aiServiceInstance;
}
