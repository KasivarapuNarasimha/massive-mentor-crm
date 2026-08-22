/**
 * Edge-safe verification of demo session JWTs (HS256).
 * Uses the same JWT_SECRET as the API (server-only — never NEXT_PUBLIC_*).
 */

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Cryptographically verify mm_demo_session cookie value.
 * Returns true only for a valid HS256 JWT with portal === "demo" and unexpired exp.
 */
export async function verifyDemoSessionJwt(
  tokenRaw: string,
  secret: string
): Promise<boolean> {
  if (!tokenRaw || !secret || secret.length < 16) return false;

  let token = tokenRaw;
  try {
    token = decodeURIComponent(tokenRaw);
  } catch {
    /* use raw */
  }

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return false;

  const header = bytesToJson(base64UrlToBytes(headerB64));
  if (!header || header.alg !== "HS256") return false;

  const payload = bytesToJson(base64UrlToBytes(payloadB64));
  if (!payload) return false;
  if (payload.portal !== "demo") return false;
  if (typeof payload.userId !== "string" || !payload.userId) return false;
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToBytes(signatureB64);
    // copy into a plain ArrayBuffer for TypeScript DOM typings
    const sigBuf = new ArrayBuffer(signature.byteLength);
    new Uint8Array(sigBuf).set(signature);
    return crypto.subtle.verify("HMAC", key, sigBuf, data);
  } catch {
    return false;
  }
}
