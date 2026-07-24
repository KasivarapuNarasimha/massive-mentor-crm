/** Normalize Meta WhatsApp Cloud API credentials before Graph API calls. */

export function normalizeWhatsAppAccessToken(raw: string | null | undefined): string {
  if (!raw) return "";
  let t = String(raw).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  // Users often paste "Bearer EAAxxx" — Authorization header must be single Bearer
  t = t.replace(/^Bearer\s+/i, "").trim();
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, "");
  return t;
}

export function normalizePhoneNumberId(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).trim().replace(/\s+/g, "");
}
