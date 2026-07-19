/**
 * Multi-currency formatting + business profile revenue ranges.
 * Used across CRM UI (profile, deals, finance, AI, reports).
 */

export type CurrencyCode =
  | "INR"
  | "USD"
  | "EUR"
  | "GBP"
  | "AED"
  | "SAR"
  | "SGD"
  | "AUD"
  | "CAD";

export type CurrencyMeta = {
  code: CurrencyCode;
  label: string;
  symbol: string;
  locale: string;
};

export const SUPPORTED_CURRENCIES: CurrencyMeta[] = [
  { code: "INR", label: "INR (₹ Indian Rupee)", symbol: "₹", locale: "en-IN" },
  { code: "USD", label: "USD ($ US Dollar)", symbol: "$", locale: "en-US" },
  { code: "EUR", label: "EUR (€ Euro)", symbol: "€", locale: "de-DE" },
  { code: "GBP", label: "GBP (£ British Pound)", symbol: "£", locale: "en-GB" },
  { code: "AED", label: "AED (UAE Dirham)", symbol: "AED", locale: "en-AE" },
  { code: "SAR", label: "SAR (Saudi Riyal)", symbol: "SAR", locale: "en-SA" },
  { code: "SGD", label: "SGD (Singapore Dollar)", symbol: "S$", locale: "en-SG" },
  { code: "AUD", label: "AUD (Australian Dollar)", symbol: "A$", locale: "en-AU" },
  { code: "CAD", label: "CAD (Canadian Dollar)", symbol: "C$", locale: "en-CA" },
];

const CURRENCY_SET = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export function isCurrencyCode(v: string | null | undefined): v is CurrencyCode {
  return !!v && CURRENCY_SET.has(v as CurrencyCode);
}

export function getCurrencyMeta(code?: string | null): CurrencyMeta {
  const c = isCurrencyCode(code || "") ? (code as CurrencyCode) : "INR";
  return SUPPORTED_CURRENCIES.find((x) => x.code === c) || SUPPORTED_CURRENCIES[0];
}

/** Infer default currency from country/location string or browser locale. */
export function detectDefaultCurrency(opts?: {
  location?: string | null;
  locale?: string | null;
}): CurrencyCode {
  const loc = `${opts?.location || ""} ${opts?.locale || ""}`.toLowerCase();

  if (
    loc.includes("india") ||
    loc.includes("bharat") ||
    loc.includes("in-in") ||
    /\bin\b/.test(loc) ||
    loc.includes("mumbai") ||
    loc.includes("delhi") ||
    loc.includes("bangalore") ||
    loc.includes("bengaluru") ||
    loc.includes("hyderabad") ||
    loc.includes("chennai") ||
    loc.includes("kolkata") ||
    loc.includes("pune") ||
    loc.includes("visakhapatnam") ||
    loc.includes("vizag")
  ) {
    return "INR";
  }
  if (loc.includes("united arab") || loc.includes("uae") || loc.includes("dubai") || loc.includes("abu dhabi")) {
    return "AED";
  }
  if (loc.includes("saudi") || loc.includes("riyadh") || loc.includes("jeddah")) return "SAR";
  if (loc.includes("singapore") || loc.includes("sg")) return "SGD";
  if (loc.includes("australia") || loc.includes("sydney") || loc.includes("melbourne")) return "AUD";
  if (loc.includes("canada") || loc.includes("toronto") || loc.includes("vancouver")) return "CAD";
  if (loc.includes("united kingdom") || loc.includes("uk") || loc.includes("london") || loc.includes("britain")) {
    return "GBP";
  }
  if (
    loc.includes("euro") ||
    loc.includes("germany") ||
    loc.includes("france") ||
    loc.includes("spain") ||
    loc.includes("italy") ||
    loc.includes("netherlands")
  ) {
    return "EUR";
  }
  if (loc.includes("united states") || loc.includes("usa") || loc.includes("america") || loc.endsWith("en-us")) {
    return "USD";
  }

  // Browser locale
  try {
    const browser = (opts?.locale || (typeof navigator !== "undefined" ? navigator.language : "") || "").toLowerCase();
    if (browser.startsWith("en-in") || browser === "hi" || browser.startsWith("hi-")) return "INR";
    if (browser.startsWith("en-gb")) return "GBP";
    if (browser.startsWith("en-au")) return "AUD";
    if (browser.startsWith("en-ca") || browser.startsWith("fr-ca")) return "CAD";
    if (browser.startsWith("en-sg")) return "SGD";
    if (browser.startsWith("ar-ae") || browser.startsWith("en-ae")) return "AED";
    if (browser.startsWith("ar-sa") || browser.startsWith("en-sa")) return "SAR";
    if (browser.startsWith("de") || browser.startsWith("fr") || browser.startsWith("es") || browser.startsWith("it") || browser.startsWith("nl")) {
      return "EUR";
    }
    if (browser.startsWith("en-us")) return "USD";
  } catch {
    /* ignore */
  }

  // Product default for Massive Mentor (India-first SaaS)
  return "INR";
}

/** Revenue range labels per currency (stored as annualRevenue string). */
export function getRevenueRangesForCurrency(code?: string | null): string[] {
  const c = isCurrencyCode(code || "") ? (code as CurrencyCode) : "INR";

  if (c === "INR") {
    return [
      "Pre-revenue",
      "₹0–₹5 Lakhs",
      "₹5–₹25 Lakhs",
      "₹25 Lakhs–₹1 Crore",
      "₹1–₹5 Crores",
      "₹5–₹25 Crores",
      "₹25+ Crores",
    ];
  }

  // Western / $ style
  if (c === "USD" || c === "AUD" || c === "CAD" || c === "SGD") {
    const s = getCurrencyMeta(c).symbol;
    return [
      "Pre-revenue",
      `${s}0 – ${s}50K`,
      `${s}50K – ${s}200K`,
      `${s}200K – ${s}500K`,
      `${s}500K – ${s}1M`,
      `${s}1M – ${s}5M`,
      `${s}5M+`,
    ];
  }

  if (c === "EUR") {
    return [
      "Pre-revenue",
      "€0 – €50K",
      "€50K – €200K",
      "€200K – €500K",
      "€500K – €1M",
      "€1M – €5M",
      "€5M+",
    ];
  }

  if (c === "GBP") {
    return [
      "Pre-revenue",
      "£0 – £50K",
      "£50K – £200K",
      "£200K – £500K",
      "£500K – £1M",
      "£1M – £5M",
      "£5M+",
    ];
  }

  // GCC (AED / SAR) — mid-market business bands
  const s = getCurrencyMeta(c).symbol;
  return [
    "Pre-revenue",
    `${s}0 – ${s}200K`,
    `${s}200K – ${s}1M`,
    `${s}1M – ${s}5M`,
    `${s}5M – ${s}20M`,
    `${s}20M – ${s}100M`,
    `${s}100M+`,
  ];
}

/**
 * Map legacy USD-style stored ranges onto a target currency list when possible.
 * Safe for existing users — never drops unrecognized values until user re-saves.
 */
export function migrateRevenueRange(
  existing: string | null | undefined,
  toCurrency: CurrencyCode
): string {
  if (!existing) return "";
  const ranges = getRevenueRangesForCurrency(toCurrency);
  if (ranges.includes(existing)) return existing;

  const e = existing.toLowerCase().replace(/\s+/g, " ").trim();

  // Semantic tier from old labels
  let tier = -1;
  if (e.includes("pre") || e.includes("mvp")) tier = 0;
  else if (e.includes("5m+") || e.includes("25+ crore") || e.includes("100m+")) tier = 6;
  else if (e.includes("1m") || e.includes("1–5 crore") || e.includes("1-5 crore") || e.includes("crore")) {
    if (e.includes("25") || e.includes("5–25") || e.includes("5-25")) tier = 5;
    else if (e.includes("1–5") || e.includes("1-5") || e.includes("$1m")) tier = 4;
    else tier = 3;
  } else if (e.includes("500k") || e.includes("25 lakh") || e.includes("lakhs–₹1") || e.includes("lakhs-₹1")) {
    tier = 3;
  } else if (e.includes("200k") || e.includes("5–25 lakh") || e.includes("5-25 lakh")) {
    tier = 2;
  } else if (e.includes("50k") || e.includes("0–₹5") || e.includes("0-₹5") || e.includes("$0")) {
    tier = 1;
  } else if (e.includes("lakh")) {
    tier = 2;
  }

  if (tier >= 0 && tier < ranges.length) return ranges[tier];
  // Keep legacy value so we don't lose data; UI will still show it as selected if forced
  return existing;
}

const STORAGE_KEY = "massive_mentor_currency";
const CURRENCY_EVENT = "mm:currency-change";

/** Persist preferred display currency (set on profile save/load). Notifies React subscribers. */
export function setAppCurrency(code: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (code && isCurrencyCode(code)) {
      const prev = localStorage.getItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, code);
      if (prev !== code) {
        window.dispatchEvent(new CustomEvent(CURRENCY_EVENT, { detail: { code } }));
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Display currency for the CRM.
 * Priority: explicit localStorage (from Business Profile) → INR.
 * Does NOT fall back to browser locale (en-US was incorrectly showing $).
 */
export function getAppCurrency(): CurrencyCode {
  if (typeof window === "undefined") return "INR";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && isCurrencyCode(v)) return v;
  } catch {
    /* ignore */
  }
  return "INR";
}

/** Subscribe to business currency changes (profile load/save). */
export function onCurrencyChange(cb: (code: CurrencyCode) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { code?: string } | undefined;
    if (detail?.code && isCurrencyCode(detail.code)) cb(detail.code);
    else cb(getAppCurrency());
  };
  window.addEventListener(CURRENCY_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CURRENCY_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Format money for display. Uses explicit code, else app preference, else INR. */
export function formatCurrency(
  amount: number | string | null | undefined,
  currencyCode?: string | null
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const raw =
    (currencyCode && isCurrencyCode(currencyCode) && currencyCode) ||
    (typeof window !== "undefined" ? getAppCurrency() : "INR");
  const meta = getCurrencyMeta(raw);
  const n = num == null || isNaN(num as number) ? 0 : (num as number);

  // AED / SAR: "AED 1,250" style (product requirement)
  if (meta.code === "AED" || meta.code === "SAR") {
    try {
      const body = new Intl.NumberFormat(meta.locale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
      return `${meta.symbol} ${body}`;
    } catch {
      return `${meta.symbol} ${n}`;
    }
  }

  try {
    return new Intl.NumberFormat(meta.locale, {
      style: "currency",
      currency: meta.code,
      maximumFractionDigits: meta.code === "INR" ? 0 : 2,
      minimumFractionDigits: meta.code === "INR" ? 0 : undefined,
    }).format(n);
  } catch {
    return `${meta.symbol}${Number(n).toLocaleString(meta.locale)}`;
  }
}

export function currencySymbol(code?: string | null): string {
  return getCurrencyMeta(code || getAppCurrency()).symbol;
}
