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

export function leadStatusesFromConfig(config: BusinessConfigDTO | null | undefined): PipelineStatus[] {
  if (!config?.pipelines || !Array.isArray(config.pipelines)) return [];
  const pipelines = config.pipelines as PipelineDef[];
  const lead =
    pipelines.find((p) => p.entity === "contact" && p.key === "lead") ||
    pipelines.find((p) => p.entity === "contact");
  if (!lead?.statuses?.length) return [];
  const fromConfig = lead.statuses.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Ensure required production statuses exist even on older BusinessConfig manifests
  const byKey = new Map(fromConfig.map((s) => [s.key, { ...s }]));
  // Prefer human labels for known keys
  if (byKey.has("proposal") && byKey.get("proposal")!.label?.toLowerCase() === "proposal") {
    byKey.set("proposal", { ...byKey.get("proposal")!, label: "Proposal Sent" });
  }
  for (const req of FALLBACK_LEAD_STATUSES) {
    if (!byKey.has(req.key)) byKey.set(req.key, { ...req });
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

export const FALLBACK_LEAD_STATUSES: PipelineStatus[] = [
  // Keep in sync with apps/api DEFAULT_LEAD_PIPELINE + lead-statuses.ts
  { key: "new", label: "New", order: 1 },
  { key: "contacted", label: "Contacted", order: 2 },
  { key: "qualified", label: "Qualified", order: 3 },
  { key: "proposal", label: "Proposal Sent", order: 4 },
  { key: "negotiation", label: "Negotiation", order: 5 },
  { key: "won", label: "Won", order: 6 },
  { key: "lost", label: "Lost", order: 7 },
  // Global telecalling call results — all business types / workspaces
  { key: "rnr", label: "RNR", order: 10 },
  { key: "busy", label: "Busy", order: 11 },
  { key: "call_back", label: "Call back", order: 12 },
  { key: "not_interested", label: "Not interested", order: 13 },
  { key: "interested", label: "Interested", order: 14 },
  { key: "switch_off", label: "Switch off", order: 15 },
  { key: "no_incoming_calls", label: "No Incoming calls", order: 16 },
  { key: "invalid_number", label: "Invalid number", order: 17 },
];

export const FALLBACK_CONTACT_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", entity: "contact", type: "text", required: true, coreMap: "name", showInList: true, showInForm: true, order: 1 },
  { key: "phone", label: "Phone", entity: "contact", type: "phone", coreMap: "phone", showInList: true, showInForm: true, order: 2 },
  { key: "email", label: "Email", entity: "contact", type: "email", coreMap: "email", showInList: true, showInForm: true, order: 3 },
  { key: "company", label: "Company", entity: "contact", type: "text", coreMap: "company", showInList: true, showInForm: true, order: 4 },
  { key: "status", label: "Status", entity: "contact", type: "select", coreMap: "status", showInList: true, showInForm: true, showInFilter: true, order: 5 },
  { key: "source", label: "Source", entity: "contact", type: "text", coreMap: undefined, showInForm: true, order: 6 },
  { key: "value", label: "Value", entity: "contact", type: "currency", coreMap: "value", showInForm: true, order: 7 },
  { key: "description", label: "Description", entity: "contact", type: "textarea", coreMap: "description", showInForm: true, order: 8 },
];
