export class AIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider?: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'AIError';
  }
}

export class AIRateLimitError extends AIError {
  constructor(provider: string, originalError?: Error) {
    super(`Rate limit exceeded for provider: ${provider}`, 'RATE_LIMIT', provider, originalError);
    this.name = 'AIRateLimitError';
  }
}

export class AIInvalidResponseError extends AIError {
  constructor(message: string, provider: string, originalError?: Error) {
    super(message, 'INVALID_RESPONSE', provider, originalError);
    this.name = 'AIInvalidResponseError';
  }
}

export class AIProviderNotConfiguredError extends AIError {
  constructor(provider: string) {
    super(`AI provider not configured: ${provider}. Please check your environment variables.`, 'PROVIDER_NOT_CONFIGURED', provider);
    this.name = 'AIProviderNotConfiguredError';
  }
}
