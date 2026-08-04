import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Always load apps/api/.env relative to this file — not process.cwd().
// (cwd can be monorepo root if someone runs node from the wrong folder.)
// Note: tsx watch does NOT reload .env; restart the API after SMTP edits.
const apiEnvPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
const dotenvResult = loadDotenv({ path: apiEnvPath });
const dotenvLoaded = !dotenvResult.error;
if (!dotenvLoaded) {
  console.warn(
    `[Env] Could not load ${apiEnvPath}: ${dotenvResult.error?.message ?? 'unknown'} (using process.env only)`
  );
} else {
  console.log(`[Env] Loaded dotenv from ${apiEnvPath} (cwd=${process.cwd()})`);
}

// Base schema for all environment variables
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Authentication
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long for security')
    .refine(
      (v) =>
        process.env.NODE_ENV !== 'production' ||
        !/changeme|your.?jwt|secret_key_here|placeholder|example_secret|test_secret/i.test(v),
      {
        message:
          'Production JWT_SECRET must not use a placeholder value — generate a long random secret',
      }
    ),

  // AI Configuration
  AI_PROVIDER: z.enum(['groq', 'openai']).default('groq'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Server
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Comma-separated browser origins allowed by CORS (must include SPA origins)
  FRONTEND_URL: z
    .string()
    .optional()
    .default(
      [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://crm.massivementor.in',
        'https://app.massivementor.in',
        'https://admin.massivementor.in',
        'https://demo.massivementor.in',
      ].join(',')
    ),
  /// Extra CORS origins (comma-separated), merged with FRONTEND_URL
  CORS_ORIGINS: z.string().optional(),

  // Customer CRM public URL (password reset / login links in emails)
  // Production: https://crm.massivementor.in — never localhost in production deploys
  APP_URL: z.string().optional().default('https://crm.massivementor.in'),
  CUSTOMER_APP_URL: z.string().optional().default('https://crm.massivementor.in'),
  // Super Admin portal public URL
  ADMIN_APP_URL: z.string().optional().default('https://admin.massivementor.in'),
  /// Marketing / public website (email footer)
  WEBSITE_URL: z.string().optional().default('https://massivementor.in'),
  /// Optional absolute logo URL for HTML emails (HTTPS recommended)
  EMAIL_LOGO_URL: z.string().optional(),
  SUPPORT_WEBSITE: z.string().optional().default('https://massivementor.in'),

  // Optional SMTP for production email (if unset: log reset links to console in non-prod)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional().default('Massive Mentor <noreply@massivementor.in>'),

  /// Password reset token TTL minutes (15–30 recommended)
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().min(5).max(120).default(30),

  // Enterprise backups (AES key derived from this; use a dedicated secret in production)
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  /// At-rest encryption for integration tokens (falls back to BACKUP_ENCRYPTION_KEY / JWT_SECRET)
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().min(1).max(3650).optional().default(30),
  BACKUP_NOTIFY_EMAIL: z.string().optional(),

  // Trust reverse proxy (Nginx) for secure cookies / rate-limit IP
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  // Razorpay (SaaS billing) — secret never sent to frontend
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /// Default free trial days for new customers
  TRIAL_DAYS: z.coerce.number().min(1).max(90).optional().default(3),

  SUPPORT_EMAIL: z.string().optional().default("team@massivementor.in"),
  /// Display format OK; wa.me uses digits only
  SUPPORT_WHATSAPP: z.string().optional().default("+91 9182920047"),
});

// Custom refinement for AI provider key validation
const envWithAiValidation = envSchema.refine((env) => {
  if (env.AI_PROVIDER === 'groq') {
    return !!env.GROQ_API_KEY && env.GROQ_API_KEY.length > 20 && !env.GROQ_API_KEY.includes('placeholder');
  }
  if (env.AI_PROVIDER === 'openai') {
    return !!env.OPENAI_API_KEY && env.OPENAI_API_KEY.length > 20 && !env.OPENAI_API_KEY.includes('placeholder');
  }
  return true;
}, {
  message: "The required AI API key for the selected AI_PROVIDER is missing or invalid. Please check your .env file.",
  path: ['AI_PROVIDER'], // This will show the error under AI_PROVIDER
});

export type Env = z.infer<typeof envSchema>;

// Parse and validate environment variables at startup
const parsedEnv = envWithAiValidation.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('\n❌ Environment validation failed!\n');
  console.error('Please check your environment variables in apps/api/.env\n');
  console.error(parsedEnv.error.format());
  console.error('\n');
  process.exit(1);
}

export const env = parsedEnv.data;

/** True when SMTP_HOST + SMTP_USER + SMTP_PASS are all non-empty (matches email.service). */
export function isSmtpConfigured(): boolean {
  return !!(
    (env.SMTP_HOST || '').trim() &&
    (env.SMTP_USER || '').trim() &&
    (env.SMTP_PASS || '').trim()
  );
}

function maskSmtpUser(user: string | undefined): string {
  const u = (user || '').trim();
  if (!u) return '(empty)';
  const [local, domain] = u.split('@');
  if (!domain) return '***';
  const shown = !local || local.length <= 2 ? '**' : `${local.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}

/** Startup proof log — secrets never printed. Dev/diagnostic only. */
export function logSmtpStartupStatus(): void {
  if (env.NODE_ENV === "production") {
    // Minimal production signal — no host/user dump
    const configured = isSmtpConfigured();
    console.info(`[Env] SMTP ${configured ? "configured" : "not configured"} (production)`);
    return;
  }
  const configured = isSmtpConfigured();
  const host = (env.SMTP_HOST || '').trim() || '(empty)';
  const port = env.SMTP_PORT ?? 587;
  const secure = env.SMTP_SECURE === true || Number(port) === 465;
  const user = maskSmtpUser(env.SMTP_USER);
  const pass = (env.SMTP_PASS || '').trim();
  const from = (env.SMTP_FROM || '').trim() || '(empty)';
  console.log('┌─ [SMTP] startup detection ─────────────────────────────────────');
  console.log(`│ dotenv file : ${apiEnvPath}`);
  console.log(`│ dotenv ok   : ${dotenvLoaded}`);
  console.log(`│ SMTP_HOST   : ${host}`);
  console.log(`│ SMTP_PORT   : ${port}`);
  console.log(`│ SMTP_SECURE : ${secure}`);
  console.log(`│ SMTP_USER   : ${user}`);
  console.log(`│ SMTP_PASS   : ${pass ? `set (len=${pass.length})` : '(empty)'}`);
  console.log(`│ SMTP_FROM   : ${from}`);
  console.log(`│ smtpConfigured() → ${configured}`);
  console.log(
    `│ delivery    : ${configured ? 'SMTP path (Hostinger) + dev console mirror' : 'API console only (no mailbox delivery)'}`
  );
  console.log('└────────────────────────────────────────────────────────────────');
}

if (env.NODE_ENV !== "production") {
  console.log(`[Env] Environment variables validated successfully (NODE_ENV=${env.NODE_ENV}, AI_PROVIDER=${env.AI_PROVIDER})`);
}
logSmtpStartupStatus();
