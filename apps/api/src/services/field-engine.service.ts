import type { FieldDef } from "../types/template-manifest.js";
import { getBusinessConfig } from "./template.service.js";
import { prisma } from "../lib/prisma.js";

export type CoreContactFields = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  status?: string;
  value?: number | null;
  description?: string | null;
  source?: string | null;
};

export type AppliedContactFields = {
  core: CoreContactFields;
  customFields: Record<string, unknown>;
  errors: string[];
};

const CORE_MAP_KEYS = new Set([
  "name",
  "phone",
  "email",
  "company",
  "value",
  "status",
  "title",
  "description",
]);

/**
 * Load contact field definitions for a business (config-driven).
 * Returns empty array if no config — callers fall back to legacy core-only behavior.
 */
export async function getContactFieldDefs(businessId: string | null | undefined): Promise<FieldDef[]> {
  if (!businessId) return [];
  const config = await getBusinessConfig(businessId);
  if (!config?.fields) return [];
  const fields = config.fields as FieldDef[];
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && f.entity === "contact" && f.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Generic entity field defs from BusinessConfig (active only) */
export async function getEntityFieldDefs(
  businessId: string | null | undefined,
  entity: string
): Promise<FieldDef[]> {
  if (!businessId) return [];
  const config = await getBusinessConfig(businessId);
  if (!config?.fields) return [];
  const fields = config.fields as FieldDef[];
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && f.entity === entity && f.active !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getLeadPipelineStatuses(
  businessId: string | null | undefined
): Promise<Array<{ key: string; label: string; color?: string }>> {
  const { UNIFIED_PIPELINE_STATUSES, mergeLeadStatusesWithCanonical } = await import(
    "../lib/lead-statuses.js"
  );
  if (!businessId) {
    return UNIFIED_PIPELINE_STATUSES.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
    }));
  }
  const config = await getBusinessConfig(businessId);
  if (!config?.pipelines) {
    return UNIFIED_PIPELINE_STATUSES.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
    }));
  }
  const pipelines = config.pipelines as Array<{
    key: string;
    entity: string;
    statuses?: Array<{ key: string; label: string; color?: string; order?: number }>;
  }>;
  if (!Array.isArray(pipelines)) {
    return UNIFIED_PIPELINE_STATUSES.map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
    }));
  }
  const lead =
    pipelines.find((p) => p.entity === "contact" && p.key === "lead") ||
    pipelines.find((p) => p.entity === "contact");
  const fromConfig = lead?.statuses?.length ? lead.statuses : [];
  return mergeLeadStatusesWithCanonical(fromConfig).map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
  }));
}

/**
 * Apply metadata field defs to a raw input bag.
 * - coreMap fields write through to Contact columns
 * - other fields go into customFields JSON
 * Never branches on industry — only on FieldDef.type / coreMap.
 */
export function applyContactFieldDefs(
  fieldDefs: FieldDef[],
  input: Record<string, unknown>,
  options?: { partial?: boolean }
): AppliedContactFields {
  const errors: string[] = [];
  const core: CoreContactFields = {};
  const customFields: Record<string, unknown> = {};
  const partial = options?.partial === true;

  // Start with explicit core keys if provided (backward compatible payloads)
  if (input.name !== undefined) core.name = String(input.name ?? "").trim();
  if (input.email !== undefined) core.email = input.email === null || input.email === "" ? null : String(input.email);
  if (input.phone !== undefined) core.phone = input.phone === null || input.phone === "" ? null : String(input.phone);
  if (input.company !== undefined)
    core.company = input.company === null || input.company === "" ? null : String(input.company);
  if (input.status !== undefined) core.status = String(input.status);
  if (input.value !== undefined) {
    if (input.value === null || input.value === "") core.value = null;
    else {
      const n = typeof input.value === "number" ? input.value : parseFloat(String(input.value).replace(/,/g, ""));
      if (Number.isNaN(n)) errors.push("Value must be a number");
      else core.value = n;
    }
  }
  if (input.notes !== undefined || input.description !== undefined) {
    const d = input.notes ?? input.description;
    core.description = d === null || d === "" ? null : String(d);
  }
  if (input.source !== undefined)
    core.source = input.source === null || input.source === "" ? null : String(input.source);

  // Merge customFields bag if client already sent one
  if (input.customFields && typeof input.customFields === "object" && !Array.isArray(input.customFields)) {
    Object.assign(customFields, input.customFields as Record<string, unknown>);
  }

  for (const def of fieldDefs) {
    const raw = input[def.key] !== undefined ? input[def.key] : customFields[def.key];
    if (raw === undefined) {
      continue;
    }

    const coerced = coerceFieldValue(def, raw, errors);
    if (coerced === undefined && raw !== null && raw !== "") continue;

    if (def.coreMap && CORE_MAP_KEYS.has(def.coreMap)) {
      applyCoreMap(core, def.coreMap, coerced, errors);
    } else if (!CORE_MAP_KEYS.has(def.key)) {
      // Store as custom attribute
      if (coerced === undefined || coerced === "") {
        delete customFields[def.key];
      } else {
        customFields[def.key] = coerced;
      }
    } else {
      // field key is itself a core name without coreMap
      applyCoreMap(core, def.key, coerced, errors);
    }
  }

  // Required checks (full apply only)
  if (!partial) {
    for (const def of fieldDefs) {
      if (!def.required) continue;
      if (def.coreMap === "name" || def.key === "name") {
        if (!core.name?.trim()) errors.push(`${def.label || "Name"} is required`);
      } else if (!def.coreMap) {
        const v = customFields[def.key];
        if (v === undefined || v === null || v === "") {
          errors.push(`${def.label || def.key} is required`);
        }
      }
    }
    // Always need a name for Contact model
    if (!core.name?.trim()) {
      // last resort from input
      if (typeof input.name === "string" && input.name.trim()) core.name = input.name.trim();
      else if (!errors.some((e) => e.toLowerCase().includes("name"))) {
        errors.push("Name is required");
      }
    }
  }

  return { core, customFields, errors };
}

function applyCoreMap(
  core: CoreContactFields,
  mapKey: string,
  value: unknown,
  errors: string[]
): void {
  switch (mapKey) {
    case "name":
      core.name = value == null ? "" : String(value).trim();
      break;
    case "phone":
      core.phone = value == null || value === "" ? null : String(value);
      break;
    case "email":
      core.email = value == null || value === "" ? null : String(value);
      break;
    case "company":
      core.company = value == null || value === "" ? null : String(value);
      break;
    case "status":
      core.status = value == null ? undefined : String(value);
      break;
    case "value": {
      if (value == null || value === "") {
        core.value = null;
      } else {
        const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
        if (Number.isNaN(n)) errors.push("Value must be a number");
        else core.value = n;
      }
      break;
    }
    case "description":
      core.description = value == null || value === "" ? null : String(value);
      break;
    default:
      break;
  }
}

function normalizeOpts(
  options?: FieldDef["options"]
): Array<{ value: string; label: string; active?: boolean }> {
  if (!options?.length) return [];
  return options.map((o) =>
    typeof o === "string"
      ? { value: o, label: o, active: true }
      : { value: o.value, label: o.label || o.value, active: o.active !== false }
  );
}

function coerceFieldValue(def: FieldDef, raw: unknown, errors: string[]): unknown {
  if (raw === null || raw === undefined) return raw;
  switch (def.type) {
    case "number":
    case "currency":
    case "rating":
    case "nps": {
      if (raw === "") return null;
      const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
      if (Number.isNaN(n)) {
        errors.push(`${def.label || def.key} must be a number`);
        return undefined;
      }
      return n;
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "1" || raw === 1) return true;
      if (raw === "false" || raw === "0" || raw === 0) return false;
      return Boolean(raw);
    case "multiselect": {
      const arr = Array.isArray(raw)
        ? raw.map(String)
        : typeof raw === "string"
          ? raw.split(",").map((s) => s.trim()).filter(Boolean)
          : [String(raw)];
      const opts = normalizeOpts(def.options);
      if (opts.length) {
        const allowed = new Set(opts.map((o) => o.value));
        for (const v of arr) {
          if (!allowed.has(v)) {
            errors.push(`Invalid option for ${def.label || def.key}`);
            return undefined;
          }
        }
      }
      return arr;
    }
    case "select":
    case "radio": {
      const s = String(raw).trim();
      if (!s) return s;
      const opts = normalizeOpts(def.options);
      if (opts.length && !opts.some((o) => o.value === s)) {
        errors.push(`Invalid option for ${def.label || def.key}`);
        return undefined;
      }
      return s;
    }
    case "email": {
      const s = String(raw).trim();
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        errors.push(`${def.label || def.key} must be a valid email`);
      }
      return s;
    }
    case "url": {
      const s = String(raw).trim();
      if (!s) return s;
      try {
        const u = new URL(s.includes("://") ? s : `https://${s}`);
        if (!u.hostname) throw new Error("bad");
      } catch {
        errors.push(`${def.label || def.key} must be a valid URL`);
      }
      return s;
    }
    default:
      return String(raw).trim();
  }
}

/**
 * Active customer workspace for CRM/billing.
 * - Never binds to demo portals
 * - Prefer non-deleted customer businesses (null portalKind treated as customer)
 * - When the user has multiple memberships, pick the workspace with the most
 *   active contacts (so a re-created empty trial business does not hide CRM data)
 * - Falls back to businesses the user owns even if membership row was missing
 * - As a last resort, fall back to any non-demo membership (even deleted) that
 *   still holds CRM data so imports remain visible after soft-delete churn
 */
export async function getUserBusinessId(userId: string): Promise<string | null> {
  // Align with ensureDefaultBusiness — same resolution rules (no create)
  try {
    const { resolveExistingCustomerBusiness } = await import("./business.service.js");
    const resolved = await resolveExistingCustomerBusiness(userId);
    if (resolved?.businessId) return resolved.businessId;
  } catch (err) {
    console.error(
      "[tenant] resolveExistingCustomerBusiness failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Soft-deleted fallback with CRM data (legacy recovery)
  const members = await prisma.businessMember.findMany({
    where: {
      userId,
      business: {
        isDemo: false,
        NOT: { portalKind: "demo" },
      },
    },
    select: {
      businessId: true,
      createdAt: true,
      business: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (members.length === 0) return null;

  const active = members.filter((m) => m.business.status !== "deleted");
  const pool = active.length > 0 ? active : members;
  if (pool.length === 1) return pool[0].businessId;

  const scored = await Promise.all(
    pool.map(async (m) => {
      const n = await prisma.contact.count({
        where: { businessId: m.businessId, deletedAt: null },
      });
      return { businessId: m.businessId, n, createdAt: m.createdAt };
    })
  );
  scored.sort((a, b) => b.n - a.n || b.createdAt.getTime() - a.createdAt.getTime());
  return scored[0]?.businessId ?? pool[0].businessId;
}

/**
 * Move this user's contacts from soft-deleted workspaces onto the active
 * business so large imports are not "lost" after a business recreate/delete.
 * Safe: only touches rows owned by userId on deleted businesses.
 */
export async function reclaimContactsFromDeletedBusinesses(
  userId: string,
  activeBusinessId: string
): Promise<number> {
  const deletedBizIds = (
    await prisma.businessMember.findMany({
      where: {
        userId,
        businessId: { not: activeBusinessId },
        business: { status: "deleted", isDemo: false },
      },
      select: { businessId: true },
    })
  ).map((m) => m.businessId);
  if (deletedBizIds.length === 0) return 0;

  const result = await prisma.contact.updateMany({
    where: {
      userId,
      businessId: { in: deletedBizIds },
      deletedAt: null,
    },
    data: { businessId: activeBusinessId },
  });
  if (result.count > 0) {
    console.info(
      `[tenant] reclaimed ${result.count} contacts for user=${userId} → business=${activeBusinessId}`
    );
  }
  return result.count;
}

/**
 * Merge existing customFields with patch (for updates).
 */
export function mergeCustomFields(
  existing: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null || v === "") delete base[k];
    else base[k] = v;
  }
  return base;
}
