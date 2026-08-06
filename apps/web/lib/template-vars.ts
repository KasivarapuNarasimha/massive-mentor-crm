/**
 * Client-side template variable engine (mirrors API template-vars.service).
 * Used for WhatsApp/email caption previews before send.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Replace {{Var}} placeholders. Empty/missing → ""; unknown stripped.
 * Collapses excess blank lines from empty substitutions.
 */
export function renderTemplate(
  template: string | null | undefined,
  vars: TemplateVars,
  opts?: { stripUnknown?: boolean; collapseBlankLines?: boolean }
): string {
  if (!template) return "";
  const stripUnknown = opts?.stripUnknown !== false;
  const collapseBlankLines = opts?.collapseBlankLines !== false;

  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(vars || {})) {
    if (v == null) {
      map.set(k.toLowerCase(), "");
      continue;
    }
    map.set(k.toLowerCase(), String(v).trim());
  }

  let out = String(template).replace(
    /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
    (_full, key: string) => {
      const k = String(key).toLowerCase();
      if (map.has(k)) return map.get(k) || "";
      return stripUnknown ? "" : `{{${key}}}`;
    }
  );

  if (collapseBlankLines) {
    out = out
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[ \t]*\n+/, "")
      .replace(/\n+[ \t]*$/, "");
  }

  return out.trim();
}

export function varsFromContact(
  contact: {
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    email?: string | null;
    industry?: string | null;
    status?: string | null;
    source?: string | null;
    value?: number | string | null;
    customFields?: Record<string, unknown> | null;
    assignedToName?: string | null;
  },
  extras?: {
    salesExecutive?: string | null;
    businessName?: string | null;
    dealValue?: string | number | null;
    service?: string | null;
  }
): TemplateVars {
  const name = (contact.name || "").trim();
  const sales =
    (extras?.salesExecutive || contact.assignedToName || "").trim();
  const service =
    (extras?.service || serviceFromCustom(contact.customFields) || "").trim();
  const phone = (contact.phone || contact.whatsapp || "").trim();
  const dealValue =
    extras?.dealValue != null && String(extras.dealValue).trim()
      ? String(extras.dealValue).trim()
      : contact.value != null && contact.value !== ""
        ? String(contact.value)
        : "";

  return {
    CustomerName: name,
    Name: name,
    LeadName: name,
    ClientName: name,
    SalesExecutive: sales,
    Assignee: sales,
    AssignedTo: sales,
    Company: (contact.company || "").trim(),
    Phone: phone,
    WhatsApp: (contact.whatsapp || contact.phone || "").trim(),
    Email: (contact.email || "").trim(),
    Service: service,
    DealValue: dealValue,
    BusinessName: (extras?.businessName || "").trim(),
    Status: (contact.status || "").trim(),
    Source: (contact.source || "").trim(),
    Industry: (contact.industry || "").trim(),
  };
}

function serviceFromCustom(cf?: Record<string, unknown> | null): string {
  if (!cf || typeof cf !== "object") return "";
  for (const key of [
    "interestedIn",
    "interested_in",
    "service",
    "services",
    "product",
    "products",
    "requirement",
    "Service",
  ]) {
    const v = cf[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const parts = v.filter((x) => typeof x === "string" && x.trim()) as string[];
      if (parts.length) return parts.join(", ");
    }
  }
  return "";
}

/** Official variables shown in the variable helper */
export const AVAILABLE_TEMPLATE_VARIABLES = [
  "CustomerName",
  "SalesExecutive",
  "Company",
  "Phone",
  "Email",
  "Service",
  "DealValue",
  "BusinessName",
] as const;

/** All recognized keys (including aliases) for validation */
export const KNOWN_TEMPLATE_VARIABLES = [
  ...AVAILABLE_TEMPLATE_VARIABLES,
  "Name",
  "LeadName",
  "ClientName",
  "Assignee",
  "AssignedTo",
  "WhatsApp",
  "Status",
  "Source",
  "Industry",
] as const;

const KNOWN_LOWER = new Set(
  KNOWN_TEMPLATE_VARIABLES.map((k) => k.toLowerCase())
);

/** True if template still contains unresolved {{placeholders}} */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(text || "");
}

/** Extract unique placeholder keys from a template (order preserved). */
export function extractPlaceholders(template: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template || "")) !== null) {
    const key = m[1]!;
    const low = key.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      found.push(key);
    }
  }
  return found;
}

/** Simple edit distance for "did you mean" */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }
  return dp[m]![n]!;
}

export function suggestVariable(unknownKey: string): string | null {
  const u = unknownKey.toLowerCase();
  if (KNOWN_LOWER.has(u)) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const k of AVAILABLE_TEMPLATE_VARIABLES) {
    const d = levenshtein(u, k.toLowerCase());
    // Prefer prefix matches lightly
    const prefixBoost = k.toLowerCase().startsWith(u.slice(0, 3)) ? -1 : 0;
    const score = d + prefixBoost;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  // Only suggest if reasonably close
  if (bestScore <= 4) return best;
  return null;
}

export type UnknownVariableIssue = {
  key: string;
  raw: string;
  suggestion: string | null;
};

/** Find unknown {{vars}} with optional suggestions. */
export function findUnknownVariables(template: string): UnknownVariableIssue[] {
  return extractPlaceholders(template)
    .filter((k) => !KNOWN_LOWER.has(k.toLowerCase()))
    .map((key) => ({
      key,
      raw: `{{${key}}}`,
      suggestion: suggestVariable(key),
    }));
}

export const CAPTION_TEMPLATE_STORAGE_KEY = "mm-whatsapp-caption-template";

export function loadSavedCaptionTemplate(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(CAPTION_TEMPLATE_STORAGE_KEY);
    if (v && v.trim()) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function saveCaptionTemplate(template: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CAPTION_TEMPLATE_STORAGE_KEY, template);
  } catch {
    /* ignore */
  }
}
