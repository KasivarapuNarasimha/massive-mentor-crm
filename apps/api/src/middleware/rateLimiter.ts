import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from './auth.js';

/**
 * Lightweight rate limiters for sensitive / costly endpoints.
 * Uses in-memory store (fine for MVP; resets on restart).
 * Production-safe windows and limits chosen to avoid impacting normal users
 * while protecting against brute force and AI abuse.
 */

const isDev = process.env.NODE_ENV !== "production";

// Strict limiter for authentication (login + register) to prevent brute-force / spam
// Dev: high limits so local UI/E2E testing is not blocked
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 500 : 5,
  message: {
    success: false,
    error: 'Too many login attempts from this IP. Please try again in 15 minutes.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Even stricter for registration (prevent account spam)
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isDev ? 200 : 3,
  message: {
    success: false,
    error: 'Too many accounts created from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
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
});

// AI Mentor chat limiter — applied after auth so we can key by user id
export const mentorChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25, // Generous for normal conversation (roughly 1-2 messages per minute sustained)
  message: {
    success: false,
    error: 'You have sent too many messages to the AI Mentor. Please wait a few minutes before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Prefer per-user limiting for authenticated requests (much better UX than pure IP)
  keyGenerator: (req: Request) => {
    // After requireAuth middleware, req.user.id is available (typed via AuthenticatedRequest)
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.id) {
      return `user:${authReq.user.id}`;
    }
    // Fallback to IP for safety (shouldn't normally happen for /chat)
    return req.ip || 'unknown';
  },
});

/** General API rate limit — mitigates abuse / scraping */
export const apiGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 2000 : 300,
  message: {
    success: false,
    error: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || req.path === "/ready",
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
});
