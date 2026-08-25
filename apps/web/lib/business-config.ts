/**
 * Client helpers for BusinessConfig metadata (Phase 3).
 * Never hardcode industry — only interpret generic FieldDef / Pipeline shapes.
 */

/** Structured select option (preferred); legacy defs may still use string[] */
export type FieldOption = {
  value: string;
  label: string;
  active?: boolean;
  order?: number;
};

export type CustomFieldEntity =
  | "contact"
  | "deal"
  | "task"
  | "meeting"
  | "feedback"
  | "invoice"
  | "expense"
  | "payment"
  | "product"
  | "vendor";

export type FieldDef = {
  key: string;
  label: string;
  entity: string;
  type: string;
  required?: boolean;
  options?: Array<string | FieldOption>;
  coreMap?: string;
  showInList?: boolean;
  showInForm?: boolean;
  showInFilter?: boolean;
  showInDetail?: boolean;
  defaultValue?: unknown;
  order?: number;
  /** Optional textarea rows (UI only) */
  rows?: number;
  placeholder?: string;
  description?: string;
  /** Soft-deactivate without destroying stored values */
  active?: boolean;
  /** template = industry seed; custom = Settings-created */
  source?: "template" | "custom";
  createdAt?: string;
  updatedAt?: string;
};

/** Normalize options to structured list (legacy string[] → {value,label}) */
export function normalizeFieldOptions(
  options?: Array<string | FieldOption> | null
): FieldOption[] {
  if (!options?.length) return [];
  return options.map((o, i) => {
    if (typeof o === "string") {
      return { value: o, label: o, active: true, order: i };
    }
    return {
      value: o.value,
      label: o.label || o.value,
      active: o.active !== false,
      order: o.order ?? i,
    };
  });
}

/** Active options for create/edit pickers (disabled options omitted unless current value needs them) */
export function activeFieldOptions(
  options?: Array<string | FieldOption> | null,
  keepValue?: string | string[] | null
): FieldOption[] {
  const all = normalizeFieldOptions(options);
  const keep = new Set(
    Array.isArray(keepValue) ? keepValue.map(String) : keepValue != null && keepValue !== "" ? [String(keepValue)] : []
  );
  return all
    .filter((o) => o.active !== false || keep.has(o.value))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const CUSTOM_FIELD_MODULES: Array<{ entity: CustomFieldEntity; label: string; group: string }> = [
  { entity: "contact", label: "Leads & Contacts", group: "CRM" },
  { entity: "deal", label: "Deals", group: "CRM" },
  { entity: "task", label: "Tasks", group: "CRM" },
  { entity: "meeting", label: "Meetings", group: "CRM" },
  { entity: "invoice", label: "Invoices", group: "ERP / Finance" },
  { entity: "expense", label: "Expenses", group: "ERP / Finance" },
  { entity: "payment", label: "Payments", group: "ERP / Finance" },
  { entity: "product", label: "Products", group: "ERP" },
  { entity: "vendor", label: "Vendors", group: "ERP" },
];

export type PipelineStatus = {
  key: string;
  label: string;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
  order?: number;
};

export type PipelineDef = {
  key: string;
  label: string;
  entity: string;
  statuses: PipelineStatus[];
};

export type BusinessConfigDTO = {
  version: number;
  fields?: FieldDef[] | unknown;
  pipelines?: PipelineDef[] | unknown;
  modules?: unknown;
  aiPromptPack?: unknown;
  importMappings?: unknown;
};

export function contactFieldsFromConfig(config: BusinessConfigDTO | null | undefined): FieldDef[] {
  if (!config?.fields || !Array.isArray(config.fields)) return [];
  return (config.fields as FieldDef[])
    .filter((f) => f && f.entity === "contact" && f.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Fields for a given module entity (active only) */
export function entityFieldsFromConfig(
  config: BusinessConfigDTO | null | undefined,
  entity: CustomFieldEntity | string
): FieldDef[] {
  if (!config?.fields || !Array.isArray(config.fields)) return [];
  return (config.fields as FieldDef[])
    .filter((f) => f && f.entity === entity && f.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function formFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => f.active !== false && f.showInForm !== false);
}

export function listFields(fields: FieldDef[]): FieldDef[] {
  const listed = fields.filter((f) => f.showInList);
  return listed.length ? listed : fields.filter((f) => ["name", "phone", "company", "status"].includes(f.key) || f.coreMap);
}

export function filterFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => f.showInFilter);
}

/**
 * Lead statuses for UI: unified 15-status list + BusinessConfig extras.
 * Always returns a usable list even when config is missing.
 */
export function leadStatusesFromConfig(config: BusinessConfigDTO | null | undefined): PipelineStatus[] {
  const pipelines = (config?.pipelines || []) as PipelineDef[];
  const lead =
    pipelines.find((p) => p.entity === "contact" && p.key === "lead") ||
    pipelines.find((p) => p.entity === "contact");
  const fromConfig = lead?.statuses?.length
    ? lead.statuses.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  // Start with unified product defaults (required 15-status order)
  const byKey = new Map<string, PipelineStatus>();
  for (const req of FALLBACK_LEAD_STATUSES) {
    byKey.set(req.key, { ...req });
  }

  // Overlay / add BusinessConfig (custom labels + extra statuses)
  for (const s of fromConfig) {
    if (!s?.key) continue;
    const existing = byKey.get(s.key);
    if (existing) {
      byKey.set(s.key, {
        ...existing,
        label: s.label || existing.label,
        color: s.color || existing.color,
        order: existing.order,
      });
    } else {
      byKey.set(s.key, { ...s });
    }
  }

  if (byKey.has("proposal") && byKey.get("proposal")!.label?.toLowerCase() === "proposal") {
    byKey.set("proposal", { ...byKey.get("proposal")!, label: "Proposal Sent" });
  }

  return [...byKey.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Read a display value from contact core columns or customFields */
export function getContactFieldValue(
  contact: Record<string, unknown>,
  field: FieldDef
): unknown {
  const custom = (contact.customFields || {}) as Record<string, unknown>;
  if (field.coreMap && contact[field.coreMap] !== undefined && contact[field.coreMap] !== null) {
    return contact[field.coreMap];
  }
  if (contact[field.key] !== undefined && contact[field.key] !== null && field.key !== "customFields") {
    return contact[field.key];
  }
  if (custom[field.key] !== undefined) return custom[field.key];
  return null;
}

/**
 * Unified Lead + Deal status list (15) — keep in sync with
 * apps/api/src/lib/lead-statuses.ts and apps/web/lib/pipeline-statuses.ts
 */
export const FALLBACK_LEAD_STATUSES: PipelineStatus[] = [
  { key: "new", label: "New", order: 1 },
  { key: "rnr", label: "RNR", order: 2 },
  { key: "contacted", label: "Contacted", order: 3 },
  { key: "busy", label: "Busy", order: 4 },
  { key: "qualified", label: "Qualified", order: 5 },
  { key: "call_back", label: "Call back", order: 6 },
  { key: "proposal", label: "Proposal Sent", order: 7 },
  { key: "not_interested", label: "Not interested", order: 8 },
  { key: "negotiation", label: "Negotiation", order: 9 },
  { key: "interested", label: "Interested", order: 10 },
  { key: "switch_off", label: "Switch off", order: 11 },
  { key: "no_incoming_calls", label: "No Incoming calls", order: 12 },
  { key: "invalid_number", label: "Invalid number", order: 13 },
  { key: "won", label: "Won", order: 14 },
  { key: "lost", label: "Lost", order: 15 },
];

/** Lead Feedback — stored in Contact.customFields.feedback (no schema migration). */
export const LEAD_FEEDBACK_FIELD: FieldDef = {
  key: "feedback",
  label: "Feedback",
  entity: "contact",
  type: "textarea",
  required: false,
  showInList: false,
  showInForm: true,
  showInFilter: false,
  showInDetail: true,
  order: 90,
  rows: 6,
  placeholder: "Sales / customer feedback notes…",
};

export const FALLBACK_CONTACT_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", entity: "contact", type: "text", required: true, coreMap: "name", showInList: true, showInForm: true, order: 1 },
  { key: "phone", label: "Phone", entity: "contact", type: "phone", coreMap: "phone", showInList: true, showInForm: true, order: 2 },
  { key: "email", label: "Email", entity: "contact", type: "email", coreMap: "email", showInList: true, showInForm: true, order: 3 },
  { key: "company", label: "Company", entity: "contact", type: "text", coreMap: "company", showInList: true, showInForm: true, order: 4 },
  { key: "status", label: "Status", entity: "contact", type: "select", coreMap: "status", showInList: true, showInForm: true, showInFilter: true, order: 5 },
  { key: "source", label: "Source", entity: "contact", type: "text", coreMap: undefined, showInForm: true, order: 6 },
  { key: "value", label: "Value", entity: "contact", type: "currency", coreMap: "value", showInForm: true, order: 7 },
  { key: "description", label: "Description", entity: "contact", type: "textarea", coreMap: "description", showInForm: true, order: 8 },
  LEAD_FEEDBACK_FIELD,
];

/**
 * Ensure Lead form always includes Feedback even when BusinessConfig fields omit it.
 * Does not replace existing fields; only injects when missing.
 */
export function ensureLeadFormFields(fields: FieldDef[]): FieldDef[] {
  if (!fields.length) return [...FALLBACK_CONTACT_FIELDS];
  if (fields.some((f) => f.key === "feedback")) {
    return fields;
  }
  const maxOrder = fields.reduce((m, f) => Math.max(m, f.order ?? 0), 0);
  return [
    ...fields,
    { ...LEAD_FEEDBACK_FIELD, order: maxOrder + 1 },
  ];
}

/** Normalize template slug for comparisons. */
export function normalizeTemplateSlug(
  templateSlug: string | null | undefined
): string {
  return String(templateSlug || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

/**
 * Business / industry template detection (from Business.templateSlug).
 * Real Estate portal uses slug `real_estate` (aliases: real-estate, realestate).
 */
export function isRealEstateBusiness(
  templateSlug: string | null | undefined
): boolean {
  const s = normalizeTemplateSlug(templateSlug);
  return s === "real_estate" || s === "realestate";
}

export function isCoachingBusiness(
  templateSlug: string | null | undefined
): boolean {
  const s = normalizeTemplateSlug(templateSlug);
  return (
    s === "coaching_institute" ||
    s === "coaching" ||
    s.includes("coaching") ||
    s.includes("education") ||
    s.includes("tuition") ||
    s.includes("school") ||
    s.includes("college")
  );
}

export function isHospitalBusiness(
  templateSlug: string | null | undefined
): boolean {
  const s = normalizeTemplateSlug(templateSlug);
  return s === "hospital" || s.includes("clinic") || s.includes("healthcare");
}

/**
 * Templates where "Company" is not a meaningful lead-list column
 * (B2C education / property / healthcare). Agency/generic keep Company.
 */
export function templateHidesCompanyInLeadList(
  templateSlug: string | null | undefined
): boolean {
  return (
    isRealEstateBusiness(templateSlug) ||
    isCoachingBusiness(templateSlug) ||
    isHospitalBusiness(templateSlug)
  );
}

/**
 * Templates where Email is secondary for list density
 * (Real Estate telecalling focus). Coaching keeps email when showInList.
 */
export function templateHidesEmailInLeadList(
  templateSlug: string | null | undefined
): boolean {
  return isRealEstateBusiness(templateSlug);
}

/**
 * Prefer Feedback list column over AI Score for B2C verticals
 * where sales notes matter more than model scores in the table.
 */
export function templatePrefersFeedbackColumn(
  templateSlug: string | null | undefined
): boolean {
  return (
    isRealEstateBusiness(templateSlug) ||
    isCoachingBusiness(templateSlug) ||
    isHospitalBusiness(templateSlug)
  );
}

/** Read Lead Feedback from Contact.customFields.feedback (existing storage). */
export function getLeadFeedbackText(
  contact: Record<string, unknown> | null | undefined
): string {
  if (!contact) return "";
  const custom = (contact.customFields || {}) as Record<string, unknown>;
  const raw =
    custom.feedback !== undefined && custom.feedback !== null
      ? custom.feedback
      : contact.feedback !== undefined && contact.feedback !== null
        ? contact.feedback
        : null;
  if (raw == null) return "";
  const s = String(raw).trim();
  return s;
}

/**
 * Apply template-aware list/filter visibility on top of BusinessConfig fields.
 * Works for already-provisioned configs without requiring re-install of the template.
 * Does not remove form fields unless they are list/filter-only flags.
 */
export function applyTemplateLeadFieldVisibility(
  fields: FieldDef[],
  templateSlug: string | null | undefined
): FieldDef[] {
  const hideCompany = templateHidesCompanyInLeadList(templateSlug);
  const hideEmail = templateHidesEmailInLeadList(templateSlug);
  if (!hideCompany && !hideEmail) return fields;

  return fields.map((f) => {
    const key = (f.key || "").toLowerCase();
    const core = (f.coreMap || "").toLowerCase();
    const isCompany = key === "company" || core === "company";
    const isEmail = key === "email" || core === "email";
    if (hideCompany && isCompany) {
      return { ...f, showInList: false, showInFilter: false };
    }
    if (hideEmail && isEmail) {
      return { ...f, showInList: false, showInFilter: false };
    }
    return f;
  });
}

/**
 * @deprecated Use applyTemplateLeadFieldVisibility — kept for callers.
 * Real Estate Leads list: hide Company + Email columns/filters (UI only).
 */
export function applyRealEstateLeadListFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => {
    const key = (f.key || "").toLowerCase();
    const core = (f.coreMap || "").toLowerCase();
    if (key === "email" || core === "email") return false;
    if (key === "company" || core === "company") return false;
    return true;
  });
}

/**
 * List columns: fields with showInList, after template visibility rules.
 * Cap keeps table usable; prefers core identity + industry extras.
 */
export function leadListColumns(
  fields: FieldDef[],
  templateSlug: string | null | undefined,
  max = 6
): FieldDef[] {
  const adjusted = applyTemplateLeadFieldVisibility(fields, templateSlug);
  const listed = listFields(adjusted);
  // Prefer name, phone, status, then template extras (budget, course, …)
  const priority = (f: FieldDef): number => {
    const k = (f.coreMap || f.key || "").toLowerCase();
    if (k === "name") return 0;
    if (k === "phone") return 1;
    if (k === "status") return 2;
    if (k === "email") return 3;
    if (k === "company") return 4;
    if (k === "value" || k === "budget" || k === "fee") return 5;
    return 10 + (f.order ?? 50);
  };
  return listed.slice().sort((a, b) => priority(a) - priority(b)).slice(0, max);
}

export function leadFilterColumns(
  fields: FieldDef[],
  templateSlug: string | null | undefined
): FieldDef[] {
  const adjusted = applyTemplateLeadFieldVisibility(fields, templateSlug);
  return filterFields(adjusted);
}
