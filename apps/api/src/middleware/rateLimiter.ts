import rateLimit from "express-rate-limit";
import type { Request } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { verifyToken } from "../services/auth.service.js";
import { getSharedRateLimitStore } from "../lib/rate-limit-store.js";

/**
 * Production-safe rate limiters.
 * Shared store (Redis if REDIS_URL, else PostgreSQL) — works across PM2 cluster instances.
 * In-memory is never used in production paths.
 */

const isDev = process.env.NODE_ENV !== "production";

function store(prefix: string) {
  return getSharedRateLimitStore(prefix);
}

// Strict limiter for authentication (login + register) to prevent brute-force / spam
// Dev: high limits so local UI/E2E testing is not blocked
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 500 : 5,
  message: {
    success: false,
    error: "Too many login attempts from this IP. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  store: store("login"),
  validate: false,
});

/** Demo portal enter/login — public demo button; looser than customer login brute-force cap. */
export const demoAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 60,
  message: {
    success: false,
    error: "Too many demo login attempts from this IP. Please try again in a few minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  store: store("demo-auth"),
  validate: false,
});

// Even stricter for registration (prevent account spam)
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 200 : 3,
  message: {
    success: false,
    error: "Too many accounts created from this IP. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: store("register"),
  validate: false,
});

// Password reset request / complete — prevent email flood & token brute force
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 8,
  message: {
    success: false,
    error: "Too many password reset attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: store("pwreset"),
  validate: false,
});

// AI Mentor chat limiter — applied after auth so we can key by user id
export const mentorChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,
  message: {
    success: false,
    error:
      "You have sent too many messages to the AI Mentor. Please wait a few minutes before trying again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: store("mentor"),
  validate: false,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.id) {
      return `user:${authReq.user.id}`;
    }
    return req.ip || "unknown";
  },
});

/**
 * Paths under /api that must NOT share the general bucket.
 * Auth entrypoints keep their dedicated limiters (loginLimiter, etc.).
 * When mounted via app.use("/api", …), req.path is relative to the mount.
 */
function isAuthEntrypointPath(req: Request): boolean {
  const p = (req.path || "").split("?")[0];
  const original = (req.originalUrl || "").split("?")[0];
  const candidates = [p, original.replace(/^\/api/, "") || p];
  const authPaths = new Set([
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/reset-password/validate",
    "/demo/auth/login",
  ]);
  return candidates.some((c) => authPaths.has(c));
}

/**
 * Separate authenticated traffic from unauthenticated IP traffic without a
 * database lookup on every request. `verifyToken` validates the signature and
 * expiry; invalid, expired, or absent credentials always remain in the IP
 * bucket. Customer tokens are user-scoped today; support-mode tokens also
 * carry the impersonated business scope.
 */
/** Exported for focused unit tests — do not use outside rate-limit wiring. */
export function apiRateLimitKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice("Bearer ".length).trim();
      const claims = verifyToken(token);
      if (claims.userId) {
        const businessScope = claims.supportBusinessId?.trim() || "user-scope";
        return `user:${claims.userId}:business:${businessScope}`;
      }
    } catch {
      // Invalid or expired credentials must not bypass public IP limiting.
    }
  }
  return `ip:${req.ip || "unknown"}`;
}

/**
 * General API rate limit — authenticated requests are isolated by verified
 * user (and support business scope); unauthenticated traffic stays IP-based.
 */
export const apiGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 2000 : 300,
  message: {
    success: false,
    error: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: store("api"),
  validate: false,
  keyGenerator: apiRateLimitKey,
  skip: (req) => {
    const p = req.path || "";
    if (p === "/health" || p === "/ready") return true;
    // Login/register/password-reset: dedicated limiters only (avoid lockout after heavy CRM use)
    if (isAuthEntrypointPath(req)) return true;
    return false;
  },
});

/** Stricter export / backup download limiter */
export const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 20,
  message: {
    success: false,
    error: "Too many export/backup requests. Try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: store("export"),
  validate: false,
});
