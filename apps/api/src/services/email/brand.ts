/**
 * Massive Mentor email brand tokens + URL helpers.
 * Inline-CSS safe; no runtime CSS frameworks.
 */
import { env } from "../../config/env.js";

export const EMAIL_BRAND = {
  name: "Massive Mentor CRM",
  product: "Massive Mentor",
  /** Primary violet (matches dashboard) */
  violet: "#7c3aed",
  violetDark: "#5b21b6",
  violetSoft: "#ede9fe",
  sky: "#0ea5e9",
  emerald: "#059669",
  amber: "#d97706",
  rose: "#e11d48",
  /** Surfaces — light for Gmail/Outlook reliability */
  pageBg: "#f4f4f5",
  cardBg: "#ffffff",
  cardBorder: "#e4e4e7",
  headerBg: "#0a0a0b",
  text: "#18181b",
  textMuted: "#52525b",
  textSubtle: "#71717a",
  footerBg: "#fafafa",
  white: "#ffffff",
  font:
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  year: 2026,
} as const;

/** Public CRM app base URL — prefer APP_URL, then CUSTOMER_APP_URL. */
export function getAppUrl(): string {
  const raw =
    (env.APP_URL || "").trim() ||
    (env.CUSTOMER_APP_URL || "").trim() ||
    "http://localhost:3000";
  return String(raw).replace(/\/$/, "");
}

export function getAdminAppUrl(): string {
  return (env.ADMIN_APP_URL || getAppUrl()).replace(/\/$/, "");
}

export function getLoginUrl(path = "/login"): string {
  const base = getAppUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function getSupportEmail(): string {
  return (env.SUPPORT_EMAIL || "team@massivementor.in").trim();
}

export function getSupportWhatsApp(): string {
  return (env.SUPPORT_WHATSAPP || "+919000000000").trim();
}

export function getSupportWebsite(): string {
  const fromEnv = (env.SUPPORT_WEBSITE || process.env.WEBSITE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Prefer production marketing site when app is still on localhost
  const app = getAppUrl();
  if (/localhost|127\.0\.0\.1/i.test(app)) {
    return "https://massivementor.in";
  }
  try {
    const u = new URL(app);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://massivementor.in";
  }
}

/** Optional hosted logo (absolute HTTPS recommended for email clients). */
export function getEmailLogoUrl(): string | null {
  const explicit = (env.EMAIL_LOGO_URL || process.env.EMAIL_LOGO_URL || "").trim();
  if (explicit) return explicit;
  // Prefer app-hosted asset when APP_URL is public
  const app = getAppUrl();
  if (/localhost|127\.0\.0\.1/i.test(app)) return null;
  return `${app}/email-logo.png`;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateLong(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatMoneyInr(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n}`;
  }
}
