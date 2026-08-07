import OpenAI from 'openai';
import { AIProvider, AIResponse, GenerateOptions, AIUsage } from '../types.js';
import { AIInvalidResponseError } from '../errors.js';
import { logAIUsage, logAIError } from '../logger.js';
import { rethrowProviderError } from '../../../utils/ai-error.js';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'gpt-4o-mini') {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.client = new OpenAI({ apiKey });
    this.defaultModel = defaultModel;
  }

  async generateJSON<T = unknown>(
    prompt: string,
    options: GenerateOptions = {}
  ): Promise<AIResponse<T>> {
    const model = options.model || this.defaultModel;

    try {
      // Ensure "json" appears in messages (required by some providers with json_object format)
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
        throw new AIInvalidResponseError('Empty response from OpenAI', 'openai');
      }

      let parsed: T;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        throw new AIInvalidResponseError('Failed to parse JSON response from OpenAI', 'openai', parseError as Error);
      }

      const usage: AIUsage = {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
        model,
        provider: 'openai',
      };

      logAIUsage(usage, 'generateJSON');

      return {
        data: parsed,
        usage,
        raw: completion,
      };
    } catch (error: unknown) {
      logAIError(error, 'openai', 'generateJSON');
      rethrowProviderError('openai', error, 'Unknown OpenAI error');
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
        provider: 'openai',
      };

      logAIUsage(usage, 'generateText');

      return {
        data: content,
        usage,
        raw: completion,
      };
    } catch (error: unknown) {
      logAIError(error, 'openai', 'generateText');
      rethrowProviderError('openai', error, 'Unknown OpenAI error');
    }
  }
}
