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
