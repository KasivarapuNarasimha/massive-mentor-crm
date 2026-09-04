/**
 * Tenant Custom Fields engine — definitions live in BusinessConfig.fields;
 * values live on each record's customFields JSON.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { ensureBusinessConfig } from "./template.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import {
  customFieldEntitySchema,
  fieldDefSchema,
  fieldOptionSchema,
  fieldTypeSchema,
  type FieldDef,
} from "../types/template-manifest.js";
import { z } from "zod";

export type FieldOption = z.infer<typeof fieldOptionSchema>;
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

const ADMIN_ROLES = new Set([
  "super_admin",
  "owner",
  "ceo",
  "business_admin",
  "admin",
  "manager",
]);

export function normalizeOptions(
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

export function activeOptions(
  options?: Array<string | FieldOption> | null,
  keepValue?: unknown
): FieldOption[] {
  const all = normalizeOptions(options);
  const keep = new Set<string>();
  if (Array.isArray(keepValue)) keepValue.forEach((v) => keep.add(String(v)));
  else if (keepValue != null && keepValue !== "") keep.add(String(keepValue));
  return all
    .filter((o) => o.active !== false || keep.has(o.value))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function slugifyKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `field_${Date.now().toString(36)}`;
}

async function resolveBusinessId(userId: string): Promise<string> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("No active business workspace");
  return businessId;
}

export async function assertCanManageCustomFields(userId: string): Promise<string> {
  const role = await resolveActorRole(userId);
  if (!ADMIN_ROLES.has(role)) {
    throw Object.assign(new Error("Insufficient permissions to manage custom fields"), {
      status: 403,
    });
  }
  return role;
}

async function loadFields(businessId: string): Promise<FieldDef[]> {
  await ensureBusinessConfig(businessId);
  const config = await prisma.businessConfig.findUnique({ where: { businessId } });
  const raw = config?.fields;
  if (!Array.isArray(raw)) return [];
  const out: FieldDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.key !== "string" || !f.key) continue;
    out.push(f as unknown as FieldDef);
  }
  return out;
}

async function saveFields(businessId: string, fields: FieldDef[]): Promise<FieldDef[]> {
  await prisma.businessConfig.update({
    where: { businessId },
    data: {
      fields: fields as unknown as object[],
      version: { increment: 1 },
    },
  });
  return fields;
}

export async function listCustomFieldDefs(
  userId: string,
  entity?: string,
  opts?: { includeInactive?: boolean }
) {
  const businessId = await resolveBusinessId(userId);
  let fields = await loadFields(businessId);
  if (entity) {
    customFieldEntitySchema.parse(entity);
    fields = fields.filter((f) => f.entity === entity);
  }
  if (!opts?.includeInactive) {
    fields = fields.filter((f) => f.active !== false);
  }
  return fields.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

const createBodySchema = z.object({
  label: z.string().min(1).max(120),
  entity: customFieldEntitySchema,
  type: fieldTypeSchema,
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().optional(),
  showInForm: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  showInList: z.boolean().optional(),
  showInFilter: z.boolean().optional(),
  options: z.array(z.union([z.string(), fieldOptionSchema])).optional(),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});

export async function createCustomField(userId: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = createBodySchema.parse(body);
  const fields = await loadFields(businessId);

  let key = input.key || slugifyKey(input.label);
  const existingKeys = new Set(fields.map((f) => f.key));
  if (existingKeys.has(key)) {
    let i = 2;
    while (existingKeys.has(`${key}_${i}`)) i += 1;
    key = `${key}_${i}`;
  }

  const needsOptions = ["select", "multiselect", "radio"].includes(input.type);
  const options = needsOptions ? normalizeOptions(input.options || []) : undefined;
  if (needsOptions && (!options || options.length === 0)) {
    throw Object.assign(new Error("Dropdown/select fields require at least one option"), {
      status: 400,
    });
  }

  const maxOrder = fields.reduce((m, f) => Math.max(m, f.order ?? 0), 0);
  const now = new Date().toISOString();
  const def: FieldDef = {
    key,
    label: input.label.trim(),
    entity: input.entity,
    type: input.type,
    required: input.required ?? false,
    description: input.description,
    placeholder: input.placeholder,
    defaultValue: input.defaultValue,
    order: input.order ?? maxOrder + 10,
    showInForm: input.showInForm !== false,
    showInDetail: input.showInDetail !== false,
    showInList: input.showInList ?? false,
    showInFilter: input.showInFilter ?? false,
    options,
    active: true,
    source: "custom",
    createdAt: now,
    updatedAt: now,
  };

  fieldDefSchema.parse(def);
  const next = [...fields, def];
  await saveFields(businessId, next);
  return def;
}

const updateBodySchema = z.object({
  label: z.string().min(1).max(120).optional(),
  required: z.boolean().optional(),
  description: z.string().max(500).optional().nullable(),
  placeholder: z.string().max(200).optional().nullable(),
  defaultValue: z.unknown().optional(),
  order: z.number().optional(),
  showInForm: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  showInList: z.boolean().optional(),
  showInFilter: z.boolean().optional(),
  active: z.boolean().optional(),
  options: z.array(z.union([z.string(), fieldOptionSchema])).optional(),
  type: fieldTypeSchema.optional(),
});

export async function updateCustomField(userId: string, key: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = updateBodySchema.parse(body);
  const fields = await loadFields(businessId);
  const idx = fields.findIndex((f) => f.key === key);
  if (idx < 0) {
    throw Object.assign(new Error("Custom field not found"), { status: 404 });
  }
  const current = fields[idx];
  if (current.coreMap && input.type && input.type !== current.type) {
    throw Object.assign(new Error("Cannot change type of a core/system field"), { status: 400 });
  }

  const nextDef: FieldDef = {
    ...current,
    label: input.label?.trim() ?? current.label,
    required: input.required ?? current.required,
    description:
      input.description === null ? undefined : input.description ?? current.description,
    placeholder:
      input.placeholder === null ? undefined : input.placeholder ?? current.placeholder,
    defaultValue: input.defaultValue !== undefined ? input.defaultValue : current.defaultValue,
    order: input.order ?? current.order,
    showInForm: input.showInForm ?? current.showInForm,
    showInDetail: input.showInDetail ?? current.showInDetail,
    showInList: input.showInList ?? current.showInList,
    showInFilter: input.showInFilter ?? current.showInFilter,
    active: input.active ?? current.active,
    type: input.type ?? current.type,
    options:
      input.options !== undefined
        ? normalizeOptions(input.options)
        : current.options
          ? normalizeOptions(current.options as Array<string | FieldOption>)
          : undefined,
    updatedAt: new Date().toISOString(),
    source: current.source || (current.coreMap ? "template" : "custom"),
  };

  fieldDefSchema.parse(nextDef);
  const next = [...fields];
  next[idx] = nextDef;
  await saveFields(businessId, next);
  return nextDef;
}

export async function setCustomFieldOptions(
  userId: string,
  key: string,
  options: unknown
) {
  const parsed = z.array(z.union([z.string(), fieldOptionSchema])).parse(options);
  return updateCustomField(userId, key, { options: parsed });
}

export async function deactivateCustomField(userId: string, key: string) {
  return updateCustomField(userId, key, { active: false });
}

/**
 * Validate + sanitize a customFields payload against definitions.
 * Allows legacy values for soft-disabled options.
 */
export async function validateCustomFieldsPayload(
  userId: string,
  entity: CustomFieldEntity,
  values: Record<string, unknown> | null | undefined,
  opts?: { partial?: boolean }
): Promise<Record<string, unknown>> {
  const businessId = await resolveBusinessId(userId);
  const defs = (await loadFields(businessId)).filter(
    (f) => f.entity === entity && f.active !== false && !f.coreMap
  );
  const incoming = values && typeof values === "object" ? { ...values } : {};
  const out: Record<string, unknown> = {};

  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(incoming, def.key);
    const raw = has ? incoming[def.key] : undefined;

    if (!has) {
      if (!opts?.partial && def.required) {
        throw Object.assign(new Error(`Missing required field: ${def.label}`), { status: 400 });
      }
      continue;
    }

    if (raw == null || raw === "") {
      if (def.required) {
        throw Object.assign(new Error(`${def.label} is required`), { status: 400 });
      }
      out[def.key] = null;
      continue;
    }

    out[def.key] = coerceAndValidate(def, raw);
  }

  // Preserve unknown keys already on the record only when merging partially — caller merges
  return out;
}

function coerceAndValidate(def: FieldDef, raw: unknown): unknown {
  const type = def.type;
  if (type === "boolean") return Boolean(raw);
  if (type === "number" || type === "currency" || type === "rating" || type === "nps") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) {
      throw Object.assign(new Error(`${def.label} must be a valid number`), { status: 400 });
    }
    return n;
  }
  if (type === "email") {
    const s = String(raw).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      throw Object.assign(new Error(`${def.label} must be a valid email`), { status: 400 });
    }
    return s;
  }
  if (type === "url") {
    const s = String(raw).trim();
    try {
      // allow without protocol by prefixing
      const u = new URL(s.includes("://") ? s : `https://${s}`);
      if (!u.hostname) throw new Error("bad");
      return s;
    } catch {
      throw Object.assign(new Error(`${def.label} must be a valid URL`), { status: 400 });
    }
  }
  if (type === "select" || type === "radio") {
    const s = String(raw);
    const opts = normalizeOptions(def.options as Array<string | FieldOption>);
    if (!opts.some((o) => o.value === s)) {
      throw Object.assign(new Error(`Invalid option for ${def.label}`), { status: 400 });
    }
    return s;
  }
  if (type === "multiselect") {
    const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const opts = new Set(normalizeOptions(def.options as Array<string | FieldOption>).map((o) => o.value));
    for (const v of arr) {
      if (!opts.has(v)) {
        throw Object.assign(new Error(`Invalid option for ${def.label}`), { status: 400 });
      }
    }
    return arr;
  }
  return String(raw);
}

/** Merge validated custom field patch into existing JSON bag */
export function mergeCustomFields(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

/**
 * Resolve customFields for create (full/partial) or update (merge into existing).
 * Safe no-op when values are missing.
 */
export async function resolveCustomFieldsWrite(
  userId: string,
  entity: CustomFieldEntity,
  incoming: unknown,
  existing?: unknown,
  opts?: { partial?: boolean }
): Promise<Record<string, unknown>> {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      return { ...(existing as Record<string, unknown>) };
    }
    return {};
  }
  const patch = await validateCustomFieldsPayload(
    userId,
    entity,
    incoming as Record<string, unknown>,
    { partial: opts?.partial !== false }
  );
  if (existing !== undefined) return mergeCustomFields(existing, patch);
  return patch;
}

/* ─── Standard / coreMap field safe updates ─── */

const updateStandardBodySchema = z.object({
  label: z.string().min(1).max(120).optional(),
  required: z.boolean().optional(),
  description: z.string().max(500).optional().nullable(),
  placeholder: z.string().max(200).optional().nullable(),
  defaultValue: z.unknown().optional(),
  order: z.number().optional(),
  showInForm: z.boolean().optional(),
  showInDetail: z.boolean().optional(),
  showInList: z.boolean().optional(),
  showInFilter: z.boolean().optional(),
  active: z.boolean().optional(),
});

/**
 * Safe edits for coreMap / standard fields: label, required, visibility, default, active.
 * Rejects type/key/coreMap/entity changes.
 */
export async function updateStandardField(userId: string, key: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = updateStandardBodySchema.parse(body);
  const fields = await loadFields(businessId);
  const idx = fields.findIndex((f) => f.key === key);
  if (idx < 0) {
    throw Object.assign(new Error("Field not found"), { status: 404 });
  }
  const current = fields[idx];

  const nextDef: FieldDef = {
    ...current,
    label: input.label?.trim() ?? current.label,
    required: input.required ?? current.required,
    description:
      input.description === null ? undefined : input.description ?? current.description,
    placeholder:
      input.placeholder === null ? undefined : input.placeholder ?? current.placeholder,
    defaultValue:
      input.defaultValue === null
        ? undefined
        : input.defaultValue !== undefined
          ? input.defaultValue
          : current.defaultValue,
    order: input.order ?? current.order,
    showInForm: input.showInForm ?? current.showInForm,
    showInDetail: input.showInDetail ?? current.showInDetail,
    showInList: input.showInList ?? current.showInList,
    showInFilter: input.showInFilter ?? current.showInFilter,
    active: input.active ?? current.active,
    // key, type, entity, coreMap intentionally unchanged
    updatedAt: new Date().toISOString(),
    source: current.source || (current.coreMap ? "template" : "custom"),
  };

  fieldDefSchema.parse(nextDef);
  const next = [...fields];
  next[idx] = nextDef;
  await saveFields(businessId, next);
  return nextDef;
}

/* ─── Lead pipeline status CRUD (BusinessConfig.pipelines JSON) ─── */

type PipelineStatusRow = {
  key: string;
  label: string;
  color?: string;
  isWon?: boolean;
  isLost?: boolean;
  order: number;
  active?: boolean;
};

type PipelineRow = {
  key: string;
  label: string;
  entity: string;
  statuses: PipelineStatusRow[];
  defaultStatusKey?: string;
};

async function loadPipelines(businessId: string): Promise<PipelineRow[]> {
  await ensureBusinessConfig(businessId);
  const config = await prisma.businessConfig.findUnique({ where: { businessId } });
  const raw = config?.pipelines;
  if (!Array.isArray(raw)) return [];
  const out: PipelineRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.key !== "string" || !p.key) continue;
    const statusesRaw = Array.isArray(p.statuses) ? p.statuses : [];
    const statuses: PipelineStatusRow[] = [];
    for (const s of statusesRaw) {
      if (!s || typeof s !== "object" || Array.isArray(s)) continue;
      const row = s as Record<string, unknown>;
      if (typeof row.key !== "string" || !row.key) continue;
      statuses.push({
        key: row.key,
        label: typeof row.label === "string" && row.label ? row.label : row.key,
        color: typeof row.color === "string" ? row.color : undefined,
        isWon: row.isWon === true,
        isLost: row.isLost === true,
        order: typeof row.order === "number" ? row.order : statuses.length + 1,
        active: row.active !== false,
      });
    }
    out.push({
      key: p.key,
      label: typeof p.label === "string" && p.label ? p.label : p.key,
      entity: typeof p.entity === "string" ? p.entity : "contact",
      statuses,
      defaultStatusKey:
        typeof p.defaultStatusKey === "string" ? p.defaultStatusKey : undefined,
    });
  }
  return out;
}

async function savePipelines(businessId: string, pipelines: PipelineRow[]): Promise<void> {
  await prisma.businessConfig.update({
    where: { businessId },
    data: {
      pipelines: pipelines as unknown as object[],
      version: { increment: 1 },
    },
  });
}

async function ensureLeadPipeline(businessId: string): Promise<{
  pipelines: PipelineRow[];
  leadIndex: number;
}> {
  const { mergeLeadStatusesWithCanonical } = await import("../lib/lead-statuses.js");
  let pipelines = await loadPipelines(businessId);
  let leadIndex = pipelines.findIndex((p) => p.entity === "contact" && p.key === "lead");
  if (leadIndex < 0) {
    leadIndex = pipelines.findIndex((p) => p.entity === "contact");
  }
  if (leadIndex < 0) {
    const statuses = mergeLeadStatusesWithCanonical([]).map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      isWon: s.isWon,
      isLost: s.isLost,
      order: s.order,
      active: s.active !== false,
    }));
    pipelines = [
      ...pipelines,
      {
        key: "lead",
        label: "Lead Pipeline",
        entity: "contact",
        statuses,
        defaultStatusKey: "new",
      },
    ];
    leadIndex = pipelines.length - 1;
    await savePipelines(businessId, pipelines);
  } else {
    // Soft-merge so stored JSON stays complete when tenant first edits
    const merged = mergeLeadStatusesWithCanonical(pipelines[leadIndex].statuses);
    const prev = pipelines[leadIndex];
    pipelines[leadIndex] = {
      ...prev,
      statuses: merged.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        isWon: s.isWon,
        isLost: s.isLost,
        order: s.order,
        active: s.active !== false,
      })),
      defaultStatusKey: prev.defaultStatusKey || "new",
    };
    // Only persist if we filled missing defaults (length / keys changed)
    const prevKeys = prev.statuses.map((s) => s.key).join(",");
    const nextKeys = pipelines[leadIndex].statuses.map((s) => s.key).join(",");
    if (prevKeys !== nextKeys || prev.statuses.length !== merged.length) {
      await savePipelines(businessId, pipelines);
    }
  }
  return { pipelines, leadIndex };
}

function slugifyStatusKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || `status_${Date.now().toString(36)}`;
}

export async function listLeadPipelineStatuses(
  userId: string,
  opts?: { includeInactive?: boolean }
) {
  const businessId = await resolveBusinessId(userId);
  const { pipelines, leadIndex } = await ensureLeadPipeline(businessId);
  const lead = pipelines[leadIndex];
  const { mergeLeadStatusesWithCanonical, activeLeadStatuses } = await import(
    "../lib/lead-statuses.js"
  );
  let statuses = mergeLeadStatusesWithCanonical(lead.statuses);
  if (!opts?.includeInactive) {
    statuses = activeLeadStatuses(statuses);
  }
  return {
    pipeline: {
      key: lead.key,
      label: lead.label,
      entity: lead.entity,
      defaultStatusKey: lead.defaultStatusKey || "new",
    },
    statuses,
  };
}

const addStatusBodySchema = z.object({
  label: z.string().min(1).max(80),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  color: z.string().max(32).optional(),
  order: z.number().optional(),
});

export async function addLeadPipelineStatus(userId: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = addStatusBodySchema.parse(body);
  const { normalizeStatusKey, IMMUTABLE_LEAD_STATUS_KEYS, mergeLeadStatusesWithCanonical } =
    await import("../lib/lead-statuses.js");

  const { pipelines, leadIndex } = await ensureLeadPipeline(businessId);
  const lead = pipelines[leadIndex];
  const merged = mergeLeadStatusesWithCanonical(lead.statuses);
  const existingKeys = new Set(merged.map((s) => s.key));

  let key = input.key || slugifyStatusKey(input.label);
  key = normalizeStatusKey(key);
  if (IMMUTABLE_LEAD_STATUS_KEYS.has(key) || existingKeys.has(key)) {
    let i = 2;
    const base = key;
    while (existingKeys.has(key) || IMMUTABLE_LEAD_STATUS_KEYS.has(key)) {
      key = `${base}_${i}`;
      i += 1;
    }
  }

  const maxOrder = merged.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
  const nextStatus: PipelineStatusRow = {
    key,
    label: input.label.trim(),
    color: input.color,
    order: input.order ?? maxOrder + 1,
    active: true,
  };

  const nextStatuses = [...merged.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
    order: s.order,
    active: s.active !== false,
  })), nextStatus];

  pipelines[leadIndex] = { ...lead, statuses: nextStatuses };
  await savePipelines(businessId, pipelines);
  return nextStatus;
}

const updateStatusBodySchema = z.object({
  label: z.string().min(1).max(80).optional(),
  color: z.string().max(32).optional().nullable(),
  order: z.number().optional(),
  active: z.boolean().optional(),
});

export async function updateLeadPipelineStatus(
  userId: string,
  statusKey: string,
  body: unknown
) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = updateStatusBodySchema.parse(body);
  const { normalizeStatusKey, IMMUTABLE_LEAD_STATUS_KEYS, mergeLeadStatusesWithCanonical } =
    await import("../lib/lead-statuses.js");

  const nk = normalizeStatusKey(statusKey);
  const { pipelines, leadIndex } = await ensureLeadPipeline(businessId);
  const lead = pipelines[leadIndex];
  const merged = mergeLeadStatusesWithCanonical(lead.statuses);
  const idx = merged.findIndex((s) => s.key === nk);
  if (idx < 0) {
    throw Object.assign(new Error("Lead status not found"), { status: 404 });
  }

  if (IMMUTABLE_LEAD_STATUS_KEYS.has(nk) && input.active === false) {
    throw Object.assign(new Error("Cannot archive won/lost statuses"), { status: 400 });
  }

  const current = merged[idx];
  const updated: PipelineStatusRow = {
    key: current.key, // key immutable — label-only renames
    label: input.label?.trim() || current.label,
    color:
      input.color === null ? undefined : input.color !== undefined ? input.color : current.color,
    isWon: current.isWon,
    isLost: current.isLost,
    order: input.order ?? current.order,
    active:
      IMMUTABLE_LEAD_STATUS_KEYS.has(nk)
        ? true
        : input.active !== undefined
          ? input.active
          : current.active !== false,
  };

  const nextStatuses = merged.map((s, i) =>
    i === idx
      ? updated
      : {
          key: s.key,
          label: s.label,
          color: s.color,
          isWon: s.isWon,
          isLost: s.isLost,
          order: s.order,
          active: s.active !== false,
        }
  );

  pipelines[leadIndex] = { ...lead, statuses: nextStatuses };
  await savePipelines(businessId, pipelines);
  return updated;
}

export async function archiveLeadPipelineStatus(userId: string, statusKey: string) {
  return updateLeadPipelineStatus(userId, statusKey, { active: false });
}

const reorderBodySchema = z.object({
  keys: z.array(z.string().min(1)).min(1),
});

export async function reorderLeadPipelineStatuses(userId: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = reorderBodySchema.parse(body);
  const { normalizeStatusKey, mergeLeadStatusesWithCanonical } = await import(
    "../lib/lead-statuses.js"
  );

  const { pipelines, leadIndex } = await ensureLeadPipeline(businessId);
  const lead = pipelines[leadIndex];
  const merged = mergeLeadStatusesWithCanonical(lead.statuses);
  const byKey = new Map(merged.map((s) => [s.key, s]));

  const seen = new Set<string>();
  const ordered: PipelineStatusRow[] = [];
  let order = 1;
  for (const raw of input.keys) {
    const k = normalizeStatusKey(raw);
    const hit = byKey.get(k);
    if (!hit || seen.has(k)) continue;
    seen.add(k);
    ordered.push({
      key: hit.key,
      label: hit.label,
      color: hit.color,
      isWon: hit.isWon,
      isLost: hit.isLost,
      order: order++,
      active: hit.active !== false,
    });
  }
  // Append any statuses omitted from keys (keep relative order)
  for (const s of merged) {
    if (seen.has(s.key)) continue;
    ordered.push({
      key: s.key,
      label: s.label,
      color: s.color,
      isWon: s.isWon,
      isLost: s.isLost,
      order: order++,
      active: s.active !== false,
    });
  }

  pipelines[leadIndex] = { ...lead, statuses: ordered };
  await savePipelines(businessId, pipelines);
  return ordered;
}

const defaultStatusBodySchema = z.object({
  defaultStatusKey: z.string().min(1),
});

export async function setLeadPipelineDefaultStatus(userId: string, body: unknown) {
  await assertCanManageCustomFields(userId);
  const businessId = await resolveBusinessId(userId);
  const input = defaultStatusBodySchema.parse(body);
  const { normalizeStatusKey, mergeLeadStatusesWithCanonical, activeLeadStatuses } =
    await import("../lib/lead-statuses.js");

  const { pipelines, leadIndex } = await ensureLeadPipeline(businessId);
  const lead = pipelines[leadIndex];
  const nk = normalizeStatusKey(input.defaultStatusKey);
  const merged = mergeLeadStatusesWithCanonical(lead.statuses);
  const active = activeLeadStatuses(merged);
  if (!active.some((s) => s.key === nk)) {
    throw Object.assign(new Error("defaultStatusKey must be an active lead status"), {
      status: 400,
    });
  }

  // Persist merged statuses + default
  pipelines[leadIndex] = {
    ...lead,
    defaultStatusKey: nk,
    statuses: merged.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      isWon: s.isWon,
      isLost: s.isLost,
      order: s.order,
      active: s.active !== false,
    })),
  };
  await savePipelines(businessId, pipelines);
  return { defaultStatusKey: nk };
}
