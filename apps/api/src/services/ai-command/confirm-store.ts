import crypto from "crypto";
import { env } from "../../config/env.js";

type ConfirmPayload = {
  userId: string;
  businessId: string | null;
  action: string;
  args: Record<string, unknown>;
  exp: number;
  nonce: string;
  message?: string;
};

const usedNonces = new Map<string, number>();
const TTL_MS = 10 * 60 * 1000;

function secret(): string {
  return env.JWT_SECRET;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function issueConfirmToken(
  payload: Omit<ConfirmPayload, "exp" | "nonce"> & { message?: string }
): string {
  const full: ConfirmPayload = {
    ...payload,
    exp: Date.now() + TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const body = b64url(JSON.stringify(full));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyConfirmToken(
  token: string,
  userId: string,
  businessId: string | null
): { ok: true; payload: ConfirmPayload } | { ok: false; error: string } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "Invalid confirmation token" };
  const [body, sig] = parts;
  const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  if (sig !== expect) return { ok: false, error: "Invalid confirmation token" };
  let payload: ConfirmPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid confirmation token" };
  }
  if (!payload.exp || Date.now() > payload.exp) {
    return { ok: false, error: "Confirmation expired — please try again" };
  }
  if (payload.userId !== userId) return { ok: false, error: "Confirmation user mismatch" };
  if ((payload.businessId || null) !== (businessId || null)) {
    return { ok: false, error: "Confirmation workspace mismatch" };
  }
  if (usedNonces.has(payload.nonce)) {
    return { ok: false, error: "Confirmation already used" };
  }
  usedNonces.set(payload.nonce, payload.exp);
  // prune
  const now = Date.now();
  for (const [n, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(n);
  }
  return { ok: true, payload };
}
