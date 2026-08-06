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

/** True if template still contains unresolved {{placeholders}} */
export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(text || "");
}
