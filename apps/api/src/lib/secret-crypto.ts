/**
 * AES-256-GCM encryption for secrets at rest (integration tokens, etc.).
 * Key derived from TOKEN_ENCRYPTION_KEY || BACKUP_ENCRYPTION_KEY || JWT_SECRET.
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";

const PREFIX = "enc:v1:";

function encryptionKey(): Buffer {
  const raw = (
    process.env.TOKEN_ENCRYPTION_KEY ||
    env.BACKUP_ENCRYPTION_KEY ||
    env.JWT_SECRET ||
    ""
  ).trim();
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt a plaintext secret. Returns enc:v1:iv:tag:ciphertext (hex). */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain; // already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Decrypt if encrypted; pass through plain legacy values. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const rest = stored.slice(PREFIX.length);
    const [ivHex, tagHex, dataHex] = rest.split(":");
    if (!ivHex || !tagHex || !dataHex) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

const SECRET_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "clientSecret",
  "apiKey",
  "apiSecret",
  "verifyToken",
  "webhookSecret",
  "password",
  "privateKey",
  "token",
  "secret",
]);

/** Encrypt known secret fields in an integration config object. */
export function encryptConfigSecrets(
  config: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v && SECRET_KEYS.has(k)) {
      out[k] = encryptSecret(v);
    }
  }
  return out;
}

/** Decrypt known secret fields for runtime use (never return to client). */
export function decryptConfigSecrets(
  config: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v && SECRET_KEYS.has(k)) {
      out[k] = decryptSecret(v);
    }
  }
  return out;
}
