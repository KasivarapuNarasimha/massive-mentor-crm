/**
 * Massive Mentor email brand tokens + URL helpers.
 * Inline-CSS safe; no runtime CSS frameworks.
 *
 * Production CRM links always use https://crm.massivementor.in when env is
 * missing or still set to localhost under NODE_ENV=production.
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

const PROD_CRM_URL = "https://crm.massivementor.in";
const PROD_ADMIN_URL = "https://admin.massivementor.in";
const PROD_WEBSITE = "https://massivementor.in";
const PROD_SUPPORT_EMAIL = "team@massivementor.in";
const PROD_SUPPORT_WHATSAPP = "+91 9182920047";

function isProd(): boolean {
  return env.NODE_ENV === "production";
}

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}

function stripSlash(url: string): string {
  return String(url || "").trim().replace(/\/$/, "");
}

/**
 * Public CRM app base URL for login / reset links in emails.
 * Prefer APP_URL → CUSTOMER_APP_URL; never emit localhost in production.
 */
export function getAppUrl(): string {
  let raw =
    stripSlash(env.APP_URL || "") ||
    stripSlash(env.CUSTOMER_APP_URL || "") ||
    "";

  if (!raw) {
    return isProd() ? PROD_CRM_URL : "http://localhost:3000";
  }

  // Hard block: production must never email localhost links
  if (isProd() && isLocalUrl(raw)) {
    console.warn(
      `[email] APP_URL/CUSTOMER_APP_URL is localhost in production — using ${PROD_CRM_URL}`
    );
    return PROD_CRM_URL;
  }

  // Prefer crm. over legacy app. host when env still points at app.*
  if (isProd() && /\/\/app\.massivementor\.in/i.test(raw)) {
    return PROD_CRM_URL;
  }

  return raw;
}

export function getAdminAppUrl(): string {
  let raw = stripSlash(env.ADMIN_APP_URL || "") || getAppUrl();
  if (isProd() && isLocalUrl(raw)) {
    return PROD_ADMIN_URL;
  }
  return raw;
}

export function getLoginUrl(path = "/login"): string {
  const base = getAppUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function getSupportEmail(): string {
  return stripSlash(env.SUPPORT_EMAIL || "") || PROD_SUPPORT_EMAIL;
}

export function getSupportWhatsApp(): string {
  return stripSlash(env.SUPPORT_WHATSAPP || "") || PROD_SUPPORT_WHATSAPP;
}

export function getSupportWebsite(): string {
  const fromEnv =
    stripSlash(env.SUPPORT_WEBSITE || "") ||
    stripSlash(env.WEBSITE_URL || process.env.WEBSITE_URL || "");
  if (fromEnv && !isLocalUrl(fromEnv)) return fromEnv;
  return PROD_WEBSITE;
}

/** Optional hosted logo (absolute HTTPS recommended for email clients). */
export function getEmailLogoUrl(): string | null {
  const explicit = stripSlash(env.EMAIL_LOGO_URL || process.env.EMAIL_LOGO_URL || "");
  if (explicit && !isLocalUrl(explicit)) return explicit;
  const app = getAppUrl();
  if (isLocalUrl(app)) return null;
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
