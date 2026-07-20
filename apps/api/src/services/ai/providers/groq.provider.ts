import Groq from 'groq-sdk';
import { AIProvider, AIResponse, GenerateOptions, AIUsage } from '../types.js';
import { AIError, AIRateLimitError, AIInvalidResponseError } from '../errors.js';
import { logAIUsage, logAIError } from '../logger.js';

export class GroqProvider implements AIProvider {
  private client: Groq;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'llama-3.3-70b-versatile') {
    if (!apiKey) {
      throw new Error('Groq API key is required');
    }
    this.client = new Groq({ apiKey });
    this.defaultModel = defaultModel;
  }

  async generateJSON<T = any>(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<AIResponse<T>> {
    const model = options.model || this.defaultModel;

    try {
      // Groq requires the word "json" somewhere in messages when using response_format: json_object
      const systemParts = [
        options.systemPrompt?.trim(),
        'You must respond with valid JSON only (a single JSON object). No markdown fences or commentary.',
      ].filter(Boolean);
      const userContent = /\bjson\b/i.test(prompt)
        ? prompt
        : `${prompt}\n\nRespond with a single valid JSON object only.`;

      const completion = await this.client.chat.completions.create({
        model,
        messages: [
          { role: 'system' as const, content: systemParts.join('\n') },
          { role: 'user' as const, content: userContent },
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1500,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new AIInvalidResponseError('Empty response from Groq', 'groq');
      }

      let parsed: T;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        throw new AIInvalidResponseError('Failed to parse JSON response from Groq', 'groq', parseError as Error);
      }

      const usage: AIUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
        model,
        provider: 'groq',
      };

      logAIUsage(usage, 'generateJSON');

      return {
        data: parsed,
        usage,
        raw: completion,
      };
    } catch (error: any) {
      logAIError(error, 'groq', 'generateJSON');

      if (error.status === 429) {
        throw new AIRateLimitError('groq', error);
      }

      if (error instanceof AIError) {
        throw error;
      }

      throw new AIError(
        error.message || 'Unknown Groq error',
        'PROVIDER_ERROR',
        'groq',
        error
      );
    }
  }

  async generateText(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<AIResponse<string>> {
    const model = options.model || this.defaultModel;

    try {
      const completion = await this.client.chat.completions.create({
        model,
        messages: [
          ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1000,
      });

      const content = completion.choices[0]?.message?.content || '';

      const usage: AIUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
        model,
        provider: 'groq',
      };

      logAIUsage(usage, 'generateText');

      return {
        data: content,
        usage,
        raw: completion,
      };
    } catch (error: any) {
      logAIError(error, 'groq', 'generateText');

      if (error.status === 429) {
        throw new AIRateLimitError('groq', error);
      }

      throw new AIError(
        error.message || 'Unknown Groq error',
        'PROVIDER_ERROR',
        'groq',
        error
      );
    }
  }
}
