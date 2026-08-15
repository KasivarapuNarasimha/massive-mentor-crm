/**
 * Copy/paste-safe temporary password generation + login normalization.
 * Product-generated passwords never contain whitespace.
 */
import crypto from "crypto";

/** Ambiguous-free alphabet (no 0/O/1/l/I) — no spaces/tabs/newlines. */
const SAFE_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";

/**
 * Generate a strong temporary password that is safe to copy from email/UI.
 * Format: Mm@XXXXXXXXXX!  (prefix + 10 chars + suffix)
 * Never contains spaces, tabs, or newlines.
 */
export function generateTempPassword(length = 10): string {
  const n = Math.min(24, Math.max(8, length));
  const bytes = crypto.randomBytes(n + 4);
  let body = "";
  for (let i = 0; i < n; i++) {
    body += SAFE_ALPHABET[bytes[i]! % SAFE_ALPHABET.length]!;
  }
  const pwd = `Mm@${body}!`;
  // Hard guarantee — never ship whitespace even if alphabet changes later
  if (/\s/.test(pwd)) {
    return pwd.replace(/\s+/g, "X");
  }
  return pwd;
}

/**
 * Strip accidental outer whitespace / zero-width / BOM from copy-paste
 * (common when selecting password cells in HTML emails).
 * Does NOT remove internal characters or intentional internal spaces.
 */
export function normalizeLoginPassword(password: string): string {
  if (typeof password !== "string") return "";
  // Outer ends only (not internal spaces). Includes NBSP, ZWSP, BOM common in email copy.
  return password.replace(
    /^[\s\u00A0\u1680\u2000-\u200A\u200B\u200C\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\s\u00A0\u1680\u2000-\u200A\u200B\u200C\u200D\u2028\u2029\u202F\u205F\u3000\uFEFF]+$/g,
    ""
  );
}

/** True if string contains any whitespace (including NBSP / zero-width). */
export function passwordContainsWhitespace(password: string): boolean {
  return /[\s\u00A0\u200B\u200C\u200D\uFEFF]/.test(password);
}
