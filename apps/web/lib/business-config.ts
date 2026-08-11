/**
 * Client helpers for BusinessConfig metadata (Phase 3).
 * Never hardcode industry — only interpret generic FieldDef / Pipeline shapes.
 */

export type FieldDef = {
  key: string;
  label: string;
  entity: string;
  type: string;
  required?: boolean;
  options?: string[];
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
};

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
    .filter((f) => f && f.entity === "contact")
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function formFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => f.showInForm !== false);
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
