/**
 * Shared template variable engine for WhatsApp, Email, SMS, automations.
 * Replaces {{VarName}} with real Lead/Client context. Never leaves raw placeholders.
 */
import { prisma } from "../lib/prisma.js";
import { toMoneyNumber } from "../lib/money.js";
import { formatCurrency } from "../lib/currency.js";

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Canonical keys (case-insensitive match on {{Key}}) */
export const TEMPLATE_VAR_KEYS = [
  "CustomerName",
  "SalesExecutive",
  "Company",
  "Phone",
  "Email",
  "Service",
  "DealValue",
  "BusinessName",
  // Aliases / extras
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

/**
 * Replace all {{Var}} / {{ Var }} placeholders.
 * - Missing / empty values → empty string
 * - Unknown placeholders stripped (customers never see braces)
 * - Collapse leftover blank lines from empty substitutions
 */
export function renderTemplate(
  template: string | null | undefined,
  vars: TemplateVars,
  opts?: { stripUnknown?: boolean; collapseBlankLines?: boolean }
): string {
  if (!template) return "";
  const stripUnknown = opts?.stripUnknown !== false;
  const collapseBlankLines = opts?.collapseBlankLines !== false;

  // Normalize lookup map (lowercase keys)
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(vars || {})) {
    if (v == null) {
      map.set(k.toLowerCase(), "");
      continue;
    }
    const s = String(v).trim();
    map.set(k.toLowerCase(), s);
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
    // Remove lines that became empty or only whitespace after substitution
    // Keep intentional double-newlines lightly collapsed to single blank line max
    out = out
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      // Collapse 3+ newlines to 2
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[ \t]*\n+/, "")
      .replace(/\n+[ \t]*$/, "");
  }

  return out.trim();
}

/** @deprecated alias — prefer renderTemplate */
export function renderCaption(
  template: string,
  vars: {
    customerName?: string;
    salesExecutive?: string;
    company?: string;
    phone?: string;
    email?: string;
    service?: string;
    dealValue?: string | number;
    businessName?: string;
  }
): string {
  return renderTemplate(template, {
    CustomerName: vars.customerName,
    Name: vars.customerName,
    LeadName: vars.customerName,
    ClientName: vars.customerName,
    SalesExecutive: vars.salesExecutive,
    Assignee: vars.salesExecutive,
    AssignedTo: vars.salesExecutive,
    Company: vars.company,
    Phone: vars.phone,
    Email: vars.email,
    Service: vars.service,
    DealValue: vars.dealValue,
    BusinessName: vars.businessName,
  });
}

function serviceFromCustomFields(cf: unknown): string {
  if (!cf || typeof cf !== "object") return "";
  const o = cf as Record<string, unknown>;
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
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const parts = v.filter((x) => typeof x === "string" && x.trim()) as string[];
      if (parts.length) return parts.join(", ");
    }
  }
  return "";
}

/**
 * Build full merge context for a contact + actor (sender).
 * Resolves assignee name, business name, latest deal value, service field.
 */
export async function buildContactTemplateVars(opts: {
  contactId: string;
  actorUserId: string;
  businessId?: string | null;
}): Promise<TemplateVars> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: opts.contactId,
      deletedAt: null,
      ...(opts.businessId
        ? { OR: [{ businessId: opts.businessId }, { userId: opts.actorUserId }] }
        : {}),
    },
  });
  if (!contact) {
    return {};
  }

  const [actor, assignee, business, deal] = await Promise.all([
    prisma.user.findUnique({
      where: { id: opts.actorUserId },
      select: { name: true, email: true },
    }),
    contact.assignedTo
      ? prisma.user.findUnique({
          where: { id: contact.assignedTo },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
    contact.businessId
      ? prisma.business.findUnique({
          where: { id: contact.businessId },
          select: { name: true },
        })
      : opts.businessId
        ? prisma.business.findUnique({
            where: { id: opts.businessId },
            select: { name: true },
          })
        : Promise.resolve(null),
    prisma.deal.findFirst({
      where: {
        contactId: contact.id,
        ...(contact.businessId ? { businessId: contact.businessId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: { value: true, title: true },
    }),
  ]);

  const salesExec =
    assignee?.name?.trim() ||
    assignee?.email ||
    actor?.name?.trim() ||
    actor?.email ||
    "";

  const dealNum =
    deal?.value != null ? toMoneyNumber(deal.value) : null;
  const dealValueStr =
    dealNum != null && dealNum > 0
      ? formatCurrency(dealNum, "INR")
      : contact.value != null
        ? formatCurrency(toMoneyNumber(contact.value), "INR")
        : "";

  const service = serviceFromCustomFields(contact.customFields);
  const phone = (contact.phone || contact.whatsapp || "").trim();
  const company = (contact.company || "").trim();
  const name = (contact.name || "").trim();
  const email = (contact.email || "").trim();
  const businessName = (business?.name || "").trim();

  return {
    CustomerName: name,
    Name: name,
    LeadName: name,
    ClientName: name,
    SalesExecutive: salesExec,
    Assignee: salesExec,
    AssignedTo: salesExec,
    Company: company,
    Phone: phone,
    WhatsApp: (contact.whatsapp || contact.phone || "").trim(),
    Email: email,
    Service: service,
    DealValue: dealValueStr,
    BusinessName: businessName,
    Status: contact.status || "",
    Source: contact.source || "",
    Industry: contact.industry || "",
  };
}

/**
 * Render a template against a contact (async convenience).
 */
export async function renderForContact(
  template: string | null | undefined,
  opts: { contactId: string; actorUserId: string; businessId?: string | null }
): Promise<{ text: string; vars: TemplateVars }> {
  const vars = await buildContactTemplateVars(opts);
  return { text: renderTemplate(template, vars), vars };
}
