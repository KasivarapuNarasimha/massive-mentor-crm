/**
 * Server-side currency helpers (mirrors apps/web/lib/currency for API scoring & prompts).
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

export const SUPPORTED_CURRENCY_CODES: CurrencyCode[] = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "SAR",
  "SGD",
  "AUD",
  "CAD",
];

export function isCurrencyCode(v: string | null | undefined): v is CurrencyCode {
  return !!v && (SUPPORTED_CURRENCY_CODES as string[]).includes(v);
}

export function detectDefaultCurrency(location?: string | null): CurrencyCode {
  const loc = (location || "").toLowerCase();
  if (
    loc.includes("india") ||
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
  if (loc.includes("uae") || loc.includes("dubai") || loc.includes("abu dhabi")) return "AED";
  if (loc.includes("saudi") || loc.includes("riyadh")) return "SAR";
  if (loc.includes("singapore")) return "SGD";
  if (loc.includes("australia") || loc.includes("sydney")) return "AUD";
  if (loc.includes("canada") || loc.includes("toronto")) return "CAD";
  if (loc.includes("uk") || loc.includes("london") || loc.includes("britain")) return "GBP";
  if (loc.includes("germany") || loc.includes("france") || loc.includes("europe") || loc.includes("euro")) {
    return "EUR";
  }
  if (loc.includes("usa") || loc.includes("united states") || loc.includes("america")) return "USD";
  // Product default: India-first SaaS — never invent USD from empty location
  return "INR";
}

const LOCALE_BY_CODE: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  SAR: "en-SA",
  SGD: "en-SG",
  AUD: "en-AU",
  CAD: "en-CA",
};

const SYMBOL_BY_CODE: Record<CurrencyCode, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED",
  SAR: "SAR",
  SGD: "S$",
  AUD: "A$",
  CAD: "C$",
};

/** Server-side money format (invoices, PDF/CSV exports, notifications). */
export function formatCurrency(
  amount: number | string | null | undefined,
  currencyCode?: string | null
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const code: CurrencyCode = isCurrencyCode(currencyCode || "")
    ? (currencyCode as CurrencyCode)
    : "INR";
  const locale = LOCALE_BY_CODE[code];
  const n = num == null || isNaN(num as number) ? 0 : (num as number);

  // GCC codes: prefer "AED 1,250" over native rtl symbols
  if (code === "AED" || code === "SAR") {
    try {
      const body = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
      return `${SYMBOL_BY_CODE[code]} ${body}`;
    } catch {
      return `${SYMBOL_BY_CODE[code]} ${n}`;
    }
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "INR" ? 0 : 2,
      minimumFractionDigits: code === "INR" ? 0 : undefined,
    }).format(n);
  } catch {
    return `${SYMBOL_BY_CODE[code]}${n.toLocaleString(locale)}`;
  }
}

/** Health-score heuristic from stored revenue range text (currency-aware labels). */
export function scoreAnnualRevenueRange(annualRevenue: string | null | undefined): number {
  if (!annualRevenue) return 25;
  const r = annualRevenue.toLowerCase();

  if (r.includes("pre")) return 18;

  // INR crore bands
  if (r.includes("25+") && r.includes("crore")) return 98;
  if (r.includes("5–25 crore") || r.includes("5-25 crore") || r.includes("₹5–₹25 crore")) return 92;
  if (r.includes("1–5 crore") || r.includes("1-5 crore") || r.includes("₹1–₹5 crore")) return 85;
  if (r.includes("25 lakh") || (r.includes("crore") && r.includes("25"))) return 78;
  if (r.includes("5–25 lakh") || r.includes("5-25 lakh") || r.includes("₹5–₹25 lakh")) return 65;
  if (r.includes("0–₹5") || r.includes("0-₹5") || r.includes("₹0–₹5")) return 45;
  if (r.includes("lakh")) return 55;
  if (r.includes("crore")) return 80;

  // Western / $ style
  if (r.includes("5m+") || r.includes("100m+")) return 95;
  if (r.includes("1m") || r.includes("20m")) return 85;
  if (r.includes("500k") || r.includes("5m –") || r.includes("5m -")) return 72;
  if (r.includes("200k") || r.includes("1m –") || r.includes("1m -")) return 58;
  if (r.includes("50k") || r.includes("200k –") || r.includes("0 –")) return 42;

  return 35;
}
