import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { getAIService } from "./ai.service.js";
import { sanitizePromptInput } from "../utils/sanitize.js";
import { logActivity } from "./activity.service.js";
import { notifyUser } from "./notification.service.js";
import { scheduleFollowupRefresh } from "./followup-engine.service.js";

/** Persist activity + in-app notification for CRM mutations */
async function notifyCrmCreated(
  userId: string,
  opts: {
    entityType: "contact" | "deal" | "task" | "meeting";
    entityId: string;
    title: string;
    message: string;
    notifType?: string;
  }
) {
  await logActivity({
    userId,
    entityType: opts.entityType,
    entityId: opts.entityId,
    action: "created",
    details: {
      title: opts.message?.match(/"([^"]+)"/)?.[1] || opts.title,
      notifTitle: opts.title,
    },
  }).catch((err) => {
    console.error("[notifyCrmCreated] activity log failed", opts.entityType, opts.entityId, err);
  });
  // Notification write must succeed for the bell to show items; rethrow so callers see failures in logs
  try {
    await notifyUser(userId, {
      type: opts.notifType || "activity",
      title: opts.title,
      message: opts.message,
      entityType: opts.entityType,
      entityId: opts.entityId,
    });
  } catch (err) {
    console.error("[notifyCrmCreated] notification write failed", opts.entityType, opts.entityId, err);
    // Do not fail the CRM create if notification insert fails
  }
}
import {
  applyContactFieldDefs,
  getContactFieldDefs,
  getUserBusinessId,
  mergeCustomFields,
} from "./field-engine.service.js";
import {
  andTenant,
  buildCrmScope,
  buildOwnedEntityScope,
  buildTenantScope,
  buildOwnedTenantScope,
  resolveActorRole,
} from "./tenant-scope.service.js";
import { paginated, skipTake, type PaginatedResult } from "./pagination.js";
import { recordAudit } from "./audit.service.js";
import {
  syncFromDealStageChange,
  syncFromLeadStatusChange,
  type PipelineSyncResult,
} from "./pipeline-sync.service.js";
import { toMoneyNumber } from "../lib/money.js";

// =====================================================
// Core CRM Service (Phase 3 Foundation)
// Unified Contact model supports Leads + Clients
// via type + status for maximum scalability.
// =====================================================

// =====================
// Zod Validation Schemas
// =====================

/**
 * Accept flexible date inputs from the UI:
 * - ISO datetime (2026-07-11T00:00:00.000Z)
 * - HTML date (yyyy-mm-dd)
 * - HTML datetime-local (yyyy-mm-ddThh:mm)
 * - dd-mm-yyyy / dd/mm/yyyy (common locales)
 * Returns normalized ISO-8601 string for storage.
 */
function coerceToIsoDateTime(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;

  const raw = value.trim();
  if (!raw) return null;

  // Already full ISO with timezone or trailing Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(raw)) {
    const d = new Date(raw.length === 16 ? raw + ":00" : raw); // datetime-local without seconds
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // yyyy-mm-dd (HTML date input)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // dd-mm-yyyy or dd/mm/yyyy or dd.mm.yyyy
  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }

  // Last resort: Date parser
  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();

  return undefined; // signal invalid
}

const flexibleDateTime = z.preprocess((val) => {
  if (val === undefined || val === null || val === "") return val === undefined ? undefined : null;
  const iso = coerceToIsoDateTime(val);
  return iso === undefined ? val : iso;
}, z.string().datetime().optional().nullable());

const flexibleDateTimeRequired = z.preprocess((val) => {
  const iso = coerceToIsoDateTime(val);
  return iso === undefined ? val : iso;
}, z.string().datetime({ message: "Invalid datetime — use a valid date" }));

export const contactSchema = z.object({
  type: z.enum(["lead", "client"]).default("lead"),
  status: z.string().min(1).default("new"),
  // Name optional at schema layer when FieldEngine resolves from template/customFields
  name: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  phone: z.string().optional().or(z.literal("")).nullable(),
  company: z.string().optional().or(z.literal("")).nullable(),
  source: z.string().optional().or(z.literal("")).nullable(),
  value: z.number().nonnegative().optional().nullable(),
  /// not_revenue | expected | received — Finance intent only; does not auto-write Finance
  financialStatus: z
    .enum(["not_revenue", "expected", "received"])
    .optional()
    .nullable(),
  notes: z.string().max(5000).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  // Config-driven attributes (Phase 3 FieldEngine)
  customFields: z.record(z.unknown()).optional().nullable(),
  // Future-ready fields
  aiScore: z.number().int().min(0).max(100).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  nextFollowUp: flexibleDateTime,
  whatsapp: z.string().optional().nullable(),
  website: z.string().url().optional().or(z.literal("")).nullable(),
  industry: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
}).passthrough(); // allow template field keys on the root payload

export const dealSchema = z.object({
  contactId: z.string().optional().nullable(),
  title: z.string().min(1, "Title is required"),
  value: z.number().nonnegative().optional().nullable(),
  stage: z.string().min(1).default("new"),
  expectedClose: flexibleDateTime,
  probability: z.number().int().min(0).max(100).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  customFields: z.record(z.unknown()).optional().nullable(),
});

export const taskSchema = z.object({
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  title: z.string().min(1, "Title is required"),
  description: z.string().max(2000).optional().nullable(),
  dueDate: flexibleDateTime,
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  customFields: z.record(z.unknown()).optional().nullable(),
});

export const meetingSchema = z.object({
  contactId: z.string().optional().nullable(),
  dealId: z.string().optional().nullable(),
  title: z.string().min(1, "Title is required"),
  scheduledAt: flexibleDateTimeRequired,
  durationMin: z.number().int().positive().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  outcome: z.string().optional().nullable(),
  customFields: z.record(z.unknown()).optional().nullable(),
});

export const noteSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  content: z.string().min(1, "Content is required").max(10000),
});

export const documentSchema = z.object({
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  title: z.string().min(1),
  url: z.string().url().optional().or(z.literal("")).nullable(),
  mimeType: z.string().optional().nullable(),
});

// =====================
// Type Exports
// =====================

export type ContactInput = z.infer<typeof contactSchema>;
export type DealInput = z.infer<typeof dealSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type MeetingInput = z.infer<typeof meetingSchema>;
export type NoteInput = z.infer<typeof noteSchema>;
export type DocumentInput = z.infer<typeof documentSchema>;

// =====================
// Contact Operations (Leads + Clients)
// =====================

export type ContactListFilters = {
  type?: "lead" | "client";
  status?: string;
  search?: string;
  /**
   * Filter by assignee userId.
   * Use "unassigned" / "__unassigned__" for leads with no assignee.
   */
  assignedTo?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  /** Include soft-deleted (trash). Default false. */
  includeDeleted?: boolean;
  /** Only soft-deleted rows (trash view). */
  trashOnly?: boolean;
};

const CONTACT_SORTABLE = new Set([
  "name",
  "email",
  "company",
  "status",
  "value",
  "createdAt",
  "updatedAt",
  "aiScore",
]);

/**
 * Shared contact WHERE used by list + dashboard KPIs so "My Leads" always matches
 * Leads module totals (tenant + role scope, type=lead, optional status/search).
 */
export async function buildContactListWhere(
  userId: string,
  filters?: ContactListFilters
): Promise<Record<string, unknown>> {
  // Reclaim imports stranded on soft-deleted workspaces (same user)
  try {
    const { getUserBusinessId, reclaimContactsFromDeletedBusinesses } = await import(
      "./field-engine.service.js"
    );
    const activeBiz = await getUserBusinessId(userId);
    if (activeBiz) {
      await reclaimContactsFromDeletedBusinesses(userId, activeBiz);
    }
  } catch (e) {
    console.warn("[crm] reclaim contacts skipped:", e instanceof Error ? e.message : e);
  }

  const scope = await buildCrmScope(userId);
  const extra: Record<string, unknown> = {};

  if (filters?.type) extra.type = filters.type;
  if (filters?.status) extra.status = filters.status;
  if (filters?.assignedTo !== undefined && filters.assignedTo !== null) {
    const a = String(filters.assignedTo).trim();
    if (a === "unassigned" || a === "__unassigned__" || a === "null") {
      extra.assignedTo = null;
    } else if (a) {
      extra.assignedTo = a;
    }
  }
  if (filters?.search) {
    const term = filters.search;
    extra.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { company: { contains: term, mode: "insensitive" } },
      { phone: { contains: term, mode: "insensitive" } },
    ];
  }

  // Soft-delete isolation: active lists never return trash unless requested
  if (filters?.trashOnly) {
    extra.deletedAt = { not: null };
  } else if (!filters?.includeDeleted) {
    extra.deletedAt = null;
  }

  return andTenant(scope.where, extra);
}

/** Exact count used by Dashboard KPI cards — same query as Leads list total. */
export async function countContacts(
  userId: string,
  filters?: ContactListFilters
): Promise<number> {
  const where = await buildContactListWhere(userId, filters);
  return prisma.contact.count({ where: where as never });
}

export async function getContacts(
  userId: string,
  filters?: ContactListFilters
): Promise<PaginatedResult<Record<string, unknown>>> {
  const where = (await buildContactListWhere(userId, filters)) as never;
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  // Legacy: large limit without page still supported for import UIs
  const pageSize = filters?.pageSize
    ? Math.min(200, Math.max(1, filters.pageSize))
    : filters?.limit
      ? Math.min(5000, Math.max(1, filters.limit))
      : 25;
  const sortBy =
    filters?.sortBy && CONTACT_SORTABLE.has(filters.sortBy) ? filters.sortBy : "updatedAt";
  const sortDir = filters?.sortDir === "asc" ? "asc" : "desc";
  const { skip, take } = skipTake(page, pageSize);

  const [total, items] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take,
      include: {
        deals: { take: 3, orderBy: { createdAt: "desc" } },
      },
    }),
  ]);

  return paginated(items as Record<string, unknown>[], total, page, pageSize);
}

export async function getContactById(userId: string, id: string) {
  const scope = await buildCrmScope(userId);
  return prisma.contact.findFirst({
    where: andTenant(scope.where, { id, deletedAt: null }) as never,
    include: {
      deals: true,
      tasks: true,
      meetings: true,
    },
  });
}

export async function createContact(userId: string, input: ContactInput | Record<string, unknown>) {
  const parsed = contactSchema.parse(input);
  const businessId = await getUserBusinessId(userId);
  const fieldDefs = await getContactFieldDefs(businessId);

  // FieldEngine: map template fields + customFields (config-driven)
  const applied = applyContactFieldDefs(fieldDefs, { ...input, ...parsed } as Record<string, unknown>, {
    partial: false,
  });
  if (applied.errors.length) {
    throw new Error(applied.errors[0]);
  }

  const name = (applied.core.name || parsed.name || "").trim();
  if (!name) throw new Error("Name is required");

  return prisma.contact.create({
    data: {
      userId,
      businessId: businessId ?? null,
      type: parsed.type || "lead",
      status: applied.core.status || parsed.status || "new",
      name,
      email: applied.core.email !== undefined ? applied.core.email : parsed.email || null,
      phone: applied.core.phone !== undefined ? applied.core.phone : parsed.phone || null,
      company: applied.core.company !== undefined ? applied.core.company : parsed.company || null,
      source: applied.core.source !== undefined ? applied.core.source : parsed.source || null,
      value: applied.core.value !== undefined ? applied.core.value : parsed.value ?? null,
      description:
        applied.core.description !== undefined
          ? applied.core.description
          : parsed.notes || parsed.description || null,
      aiScore: parsed.aiScore ?? null,
      priority: parsed.priority ?? null,
      assignedTo: parsed.assignedTo ?? null,
      nextFollowUp: parsed.nextFollowUp ? new Date(parsed.nextFollowUp) : null,
      whatsapp: parsed.whatsapp ?? null,
      website: parsed.website || null,
      industry: parsed.industry ?? null,
      tags: parsed.tags ?? [],
      customFields: applied.customFields as object,
    },
  }).then(async (contact) => {
    const kind = contact.type === "client" ? "Client" : "Lead";
    await notifyCrmCreated(userId, {
      entityType: "contact",
      entityId: contact.id,
      title: `${kind} created`,
      message: `${kind} "${contact.name}" was added`,
      notifType: contact.type === "client" ? "activity" : "lead_assigned",
    });
    // Notify assignee when created already assigned to someone else
    if (contact.assignedTo && contact.assignedTo !== userId) {
      await notifyUser(contact.assignedTo, {
        type: "lead_assigned",
        title: "Lead assigned to you",
        message: `"${contact.name}" was assigned to you`,
        entityType: "contact",
        entityId: contact.id,
      }).catch(() => {});
    }
    // Sync deals if created with a late-stage status (e.g. Proposal Sent)
    try {
      const status = String(contact.status || "new");
      if (status && status !== "new") {
        await syncFromLeadStatusChange(
          userId,
          {
            id: contact.id,
            name: contact.name,
            type: contact.type,
            status: contact.status,
            value: contact.value == null ? null : toMoneyNumber(contact.value),
            company: contact.company,
            businessId: contact.businessId,
            userId: contact.userId,
          },
          "new"
        );
      }
    } catch (err) {
      console.error("[createContact] pipeline sync failed", err);
    }
    scheduleFollowupRefresh(userId);
    return contact;
  });
}

export async function updateContact(
  userId: string,
  id: string,
  input: Partial<ContactInput> | Record<string, unknown>
) {
  const { where: tenant } = await buildTenantScope(userId);
  const existing = await prisma.contact.findFirst({
    where: andTenant(tenant, { id, deletedAt: null }) as never,
  });
  if (!existing) {
    throw new Error("Contact not found");
  }

  const parsed = contactSchema.partial().parse(input);
  const businessId = existing.businessId || (await getUserBusinessId(userId));
  const fieldDefs = await getContactFieldDefs(businessId);

  const applied = applyContactFieldDefs(fieldDefs, { ...input, ...parsed } as Record<string, unknown>, {
    partial: true,
  });
  if (applied.errors.length) {
    throw new Error(applied.errors[0]);
  }

  const mergedCustom = mergeCustomFields(existing.customFields, applied.customFields);

  const nextStatus = String(
    applied.core.status ?? parsed.status ?? existing.status
  );
  const statusChanged =
    nextStatus.trim().toLowerCase() !== String(existing.status || "").trim().toLowerCase();

  // Ensure contact has a workspace businessId before deal sync
  const resolvedBusinessId =
    existing.businessId || (await getUserBusinessId(userId)) || null;

  const contact = await prisma.contact.update({
    where: { id },
    data: {
      type: parsed.type ?? existing.type,
      status: nextStatus,
      name: (applied.core.name ?? parsed.name ?? existing.name) as string,
      email:
        applied.core.email !== undefined
          ? applied.core.email
          : parsed.email !== undefined
            ? parsed.email || null
            : existing.email,
      phone:
        applied.core.phone !== undefined
          ? applied.core.phone
          : parsed.phone !== undefined
            ? parsed.phone || null
            : existing.phone,
      company:
        applied.core.company !== undefined
          ? applied.core.company
          : parsed.company !== undefined
            ? parsed.company || null
            : existing.company,
      source:
        applied.core.source !== undefined
          ? applied.core.source
          : parsed.source !== undefined
            ? parsed.source || null
            : existing.source,
      value:
        applied.core.value !== undefined
          ? applied.core.value
          : parsed.value !== undefined
            ? parsed.value
            : existing.value,
      financialStatus:
        parsed.financialStatus !== undefined
          ? parsed.financialStatus || null
          : existing.financialStatus,
      description:
        applied.core.description !== undefined
          ? applied.core.description
          : parsed.notes !== undefined
            ? parsed.notes || null
            : parsed.description !== undefined
              ? parsed.description || null
              : existing.description,
      lastContactedAt:
        parsed.notes || parsed.status || applied.core.status ? new Date() : existing.lastContactedAt,
      aiScore: parsed.aiScore !== undefined ? parsed.aiScore : existing.aiScore,
      priority: parsed.priority !== undefined ? parsed.priority : existing.priority,
      assignedTo: parsed.assignedTo !== undefined ? parsed.assignedTo : existing.assignedTo,
      nextFollowUp:
        parsed.nextFollowUp !== undefined
          ? parsed.nextFollowUp
            ? new Date(parsed.nextFollowUp)
            : null
          : existing.nextFollowUp,
      whatsapp: parsed.whatsapp !== undefined ? parsed.whatsapp : existing.whatsapp,
      website: parsed.website !== undefined ? parsed.website || null : existing.website,
      industry: parsed.industry !== undefined ? parsed.industry : existing.industry,
      tags: parsed.tags !== undefined ? parsed.tags ?? [] : existing.tags,
      customFields: mergedCustom as object,
      // Never leave lead without businessId when workspace exists
      ...(resolvedBusinessId && !existing.businessId
        ? { businessId: resolvedBusinessId }
        : {}),
    },
  });

  // Assignment notifications (store userId, not free-text name)
  const prevAssignee = existing.assignedTo || null;
  const nextAssignee = contact.assignedTo || null;
  if (nextAssignee && nextAssignee !== prevAssignee && nextAssignee !== userId) {
    await notifyUser(nextAssignee, {
      type: "lead_assigned",
      title: "Lead assigned to you",
      message: `"${contact.name}" was assigned to you`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {});
  }
  if (prevAssignee && prevAssignee !== nextAssignee && prevAssignee !== userId) {
    await notifyUser(prevAssignee, {
      type: "activity",
      title: "Lead reassigned",
      message: `"${contact.name}" is no longer assigned to you`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {});
  }

  let pipelineSync: PipelineSyncResult | null = null;
  if (statusChanged) {
    try {
      pipelineSync = await syncFromLeadStatusChange(
        userId,
        {
          id: contact.id,
          name: contact.name,
          type: contact.type,
          status: contact.status,
          value: contact.value == null ? null : toMoneyNumber(contact.value),
          company: contact.company,
          businessId: contact.businessId || resolvedBusinessId,
          userId: contact.userId,
        },
        existing.status
      );
    } catch (err) {
      // Surface pipeline failures so they are not silent in production
      console.error("[updateContact] pipeline sync failed", err);
      throw err instanceof Error
        ? err
        : new Error("Lead updated but deal pipeline sync failed");
    }
  }

  // Re-fetch when sync may have flipped type/status (lead → client) or backfilled businessId
  const finalContact =
    pipelineSync?.contactConvertedToClient || pipelineSync?.dealCreated
      ? (await prisma.contact.findUnique({ where: { id: contact.id } })) || contact
      : contact;

  // Meaningful single-lead/contact update → one Activity row (powers Admin metrics + team toasts).
  // Skip no-op patches; never double-log with bulk_updated (that path is separate).
  const assigneeChanged = prevAssignee !== nextAssignee;
  const customChanged =
    JSON.stringify(existing.customFields ?? {}) !== JSON.stringify(mergedCustom ?? {});
  const meaningfulUpdate =
    statusChanged ||
    assigneeChanged ||
    customChanged ||
    (applied.core.name !== undefined && String(applied.core.name) !== String(existing.name || "")) ||
    (applied.core.phone !== undefined && String(applied.core.phone || "") !== String(existing.phone || "")) ||
    (applied.core.email !== undefined && String(applied.core.email || "") !== String(existing.email || "")) ||
    (applied.core.company !== undefined &&
      String(applied.core.company || "") !== String(existing.company || "")) ||
    (applied.core.description !== undefined &&
      String(applied.core.description || "") !== String(existing.description || "")) ||
    (parsed.priority !== undefined && String(parsed.priority || "") !== String(existing.priority || "")) ||
    (parsed.nextFollowUp !== undefined) ||
    (parsed.source !== undefined && String(parsed.source || "") !== String(existing.source || "")) ||
    (parsed.notes !== undefined);

  if (meaningfulUpdate) {
    await logActivity({
      userId,
      entityType: "contact",
      entityId: finalContact.id,
      action: "updated",
      details: {
        title: finalContact.name,
        status: finalContact.status,
        previousStatus: existing.status,
        statusChanged,
        assigneeChanged,
      },
    }).catch(() => undefined);
    await recordAudit({
      businessId: finalContact.businessId || resolvedBusinessId || null,
      actorUserId: userId,
      action: "lead_update",
      entityType: "contact",
      entityId: finalContact.id,
      metadata: {
        status: finalContact.status,
        previousStatus: existing.status,
        statusChanged,
        assigneeChanged,
      },
    }).catch(() => undefined);
  }

  scheduleFollowupRefresh(userId);
  return { contact: finalContact, pipelineSync };
}

export async function deleteContact(userId: string, id: string) {
  const { where: tenant } = await buildTenantScope(userId);
  const existing = await prisma.contact.findFirst({
    where: andTenant(tenant, { id, deletedAt: null }) as never,
  });
  if (!existing) {
    throw new Error("Contact not found");
  }

  // Soft delete by default (trash) — permanent purge is bulk permanent for admins
  return prisma.contact.update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: userId },
  });
}

/** Roles with full bulk delete (soft + permanent purge) */
const BULK_DELETE_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

/** Roles that may bulk-edit leads */
const BULK_EDIT_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "sales_manager",
  "manager",
  "super_admin",
  "sales_executive", // edit allowed; delete restricted
]);

export async function canBulkEditLeads(userId: string): Promise<boolean> {
  const role = await resolveActorRole(userId);
  return BULK_EDIT_ROLES.has(role) || role.includes("admin") || role.includes("manager");
}

export async function canBulkDeleteLeads(userId: string): Promise<boolean> {
  const role = await resolveActorRole(userId);
  if (BULK_DELETE_ROLES.has(role)) return true;
  // Sales manager: edit only (no bulk delete)
  if (role === "sales_manager" || role === "manager") return false;
  // Sales executive: only if membership permissions include bulk_delete
  if (role === "sales_executive") {
    const mem = await prisma.businessMember.findFirst({
      where: { userId },
      select: { permissions: true },
    });
    const perms = mem?.permissions as Record<string, unknown> | null;
    if (perms && (perms.bulk_delete === true || perms.bulkDelete === true)) return true;
    if (Array.isArray(perms) && (perms as string[]).includes("bulk_delete")) return true;
  }
  return false;
}

export type BulkLeadEditPatch = {
  status?: string;
  assignedTo?: string | null;
  source?: string | null;
  priority?: string | null;
  tags?: string[];
  company?: string | null;
  customFields?: Record<string, unknown>;
};

/**
 * Enterprise bulk edit for leads. Only applies provided (non-empty) fields.
 * Audited as a single platform-style CRM event + per-lead activity.
 */
export async function bulkEditLeads(
  userId: string,
  ids: string[],
  patch: BulkLeadEditPatch
): Promise<{ updated: number; failed: number; ids: string[]; pipelineSyncCount: number }> {
  if (!(await canBulkEditLeads(userId))) {
    throw new Error("You do not have permission to bulk-edit leads");
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw new Error("Select at least one lead");
  if (unique.length > 500) throw new Error("Maximum 500 leads per bulk edit");

  const scope = await buildCrmScope(userId);
  const contacts = await prisma.contact.findMany({
    where: andTenant(scope.where, {
      id: { in: unique },
      type: "lead",
      deletedAt: null,
    }) as never,
  });

  const data: Record<string, unknown> = {};
  if (patch.status !== undefined && String(patch.status).trim()) data.status = String(patch.status).trim();
  if (patch.assignedTo !== undefined) data.assignedTo = patch.assignedTo ? String(patch.assignedTo).trim() : null;
  if (patch.source !== undefined) data.source = patch.source ? String(patch.source).trim() : null;
  if (patch.priority !== undefined) data.priority = patch.priority ? String(patch.priority).trim() : null;
  if (patch.company !== undefined) data.company = patch.company ? String(patch.company).trim() : null;
  if (patch.tags !== undefined) data.tags = Array.isArray(patch.tags) ? patch.tags : [];
  if (Object.keys(data).length === 0 && !patch.customFields) {
    throw new Error("No fields to update");
  }

  let updated = 0;
  const okIds: string[] = [];
  let pipelineSyncCount = 0;
  for (const c of contacts) {
    try {
      const nextCustom =
        patch.customFields && Object.keys(patch.customFields).length
          ? mergeCustomFields(c.customFields, patch.customFields)
          : undefined;
      const nextStatus =
        data.status !== undefined ? String(data.status) : c.status;
      const statusChanged =
        data.status !== undefined &&
        String(data.status).trim().toLowerCase() !==
          String(c.status || "").trim().toLowerCase();

      const contact = await prisma.contact.update({
        where: { id: c.id },
        data: {
          ...data,
          ...(nextCustom !== undefined ? { customFields: nextCustom as object } : {}),
          lastContactedAt: new Date(),
        } as never,
      });
      await logActivity({
        userId,
        entityType: "contact",
        entityId: c.id,
        action: "bulk_updated",
        details: { patch: data, customFields: patch.customFields || null },
      }).catch(() => undefined);

      if (statusChanged) {
        try {
          const sync = await syncFromLeadStatusChange(
            userId,
            {
              id: contact.id,
              name: contact.name,
              type: contact.type,
              status: nextStatus,
              value: contact.value == null ? null : toMoneyNumber(contact.value),
              company: contact.company,
              businessId: contact.businessId,
              userId: contact.userId,
            },
            c.status
          );
          if (
            sync.dealsUpdated ||
            sync.dealCreated ||
            sync.contactConvertedToClient
          ) {
            pipelineSyncCount++;
          }
        } catch (err) {
          console.error("[bulkEditLeads] pipeline sync failed", c.id, err);
        }
      }

      updated++;
      okIds.push(c.id);
    } catch {
      /* count as failed */
    }
  }

  const businessId = await getUserBusinessId(userId);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "lead_bulk_edit",
    entityType: "contact",
    metadata: {
      requested: unique.length,
      updated,
      failed: unique.length - updated,
      fields: Object.keys({ ...data, ...(patch.customFields || {}) }),
      ids: okIds.slice(0, 100),
    },
  });

  scheduleFollowupRefresh(userId);
  return {
    updated,
    failed: unique.length - updated,
    ids: okIds,
    pipelineSyncCount,
  };
}

/**
 * Soft-delete selected leads (trash). Undo via bulkRestoreLeads within retention window.
 * Shared caps used by bulk delete + bulk assign.
 */
export const BULK_LEAD_MAX_ROWS = 50_000;
export const BULK_LEAD_CHUNK = 1_000;

/** @deprecated use BULK_LEAD_MAX_ROWS */
const BULK_DELETE_MAX_IDS = BULK_LEAD_MAX_ROWS;
/** @deprecated use BULK_LEAD_CHUNK */
const BULK_DELETE_CHUNK = BULK_LEAD_CHUNK;

/**
 * Soft-delete or permanently purge leads by explicit IDs (chunked).
 * Supports large selections (up to 50k) via batched updates of 1,000.
 */
export async function bulkSoftDeleteLeads(
  userId: string,
  ids: string[],
  opts?: { permanent?: boolean }
): Promise<{ deleted: number; failed: number; ids: string[]; permanent: boolean; scope: "ids" }> {
  if (!(await canBulkDeleteLeads(userId))) {
    throw new Error(
      "You do not have permission to bulk-delete leads. Contact a Business Admin or CEO."
    );
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw new Error("Select at least one lead");
  if (unique.length > BULK_DELETE_MAX_IDS) {
    throw new Error(`Maximum ${BULK_DELETE_MAX_IDS.toLocaleString()} leads per bulk delete`);
  }

  const permanent = !!opts?.permanent;
  if (permanent) {
    const role = await resolveActorRole(userId);
    if (!BULK_DELETE_ROLES.has(role)) {
      throw new Error("Only Business Admin / CEO can permanently delete leads");
    }
  }

  const scope = await buildCrmScope(userId);
  let deleted = 0;
  const okIds: string[] = [];

  for (let i = 0; i < unique.length; i += BULK_DELETE_CHUNK) {
    const chunk = unique.slice(i, i + BULK_DELETE_CHUNK);
    const contacts = await prisma.contact.findMany({
      where: andTenant(scope.where, {
        id: { in: chunk },
        type: "lead",
        ...(permanent ? {} : { deletedAt: null }),
      }) as never,
      select: { id: true, name: true },
    });

    if (permanent) {
      for (const c of contacts) {
        try {
          await prisma.contact.delete({ where: { id: c.id } });
          deleted++;
          okIds.push(c.id);
        } catch {
          /* skip */
        }
      }
    } else {
      const idsToSoft = contacts.map((c) => c.id);
      if (idsToSoft.length) {
        const result = await prisma.contact.updateMany({
          where: andTenant(scope.where, {
            id: { in: idsToSoft },
            type: "lead",
            deletedAt: null,
          }) as never,
          data: { deletedAt: new Date(), deletedByUserId: userId },
        });
        deleted += result.count;
        // Only track IDs we attempted that matched tenant/type (for undo sample)
        if (result.count > 0) okIds.push(...idsToSoft);
      }
    }
  }

  const businessId = await getUserBusinessId(userId);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: permanent ? "lead_bulk_delete_permanent" : "lead_bulk_delete",
    entityType: "contact",
    metadata: {
      requested: unique.length,
      deleted,
      failed: Math.max(0, unique.length - deleted),
      permanent,
      scope: "ids",
      batchSize: BULK_DELETE_CHUNK,
      ids: okIds.slice(0, 100),
    },
  });

  scheduleFollowupRefresh(userId);
  return {
    deleted,
    failed: Math.max(0, unique.length - deleted),
    ids: okIds,
    permanent,
    scope: "ids",
  };
}

/**
 * Soft-delete ALL leads matching list filters (search/status) — not just the current page.
 * Soft-delete runs in batches of 1,000 to avoid long-running single statements / timeouts.
 */
export async function bulkSoftDeleteLeadsByFilter(
  userId: string,
  filters: { search?: string; status?: string },
  opts?: { permanent?: boolean }
): Promise<{
  deleted: number;
  failed: number;
  ids: string[];
  permanent: boolean;
  scope: "all_filtered";
  matched: number;
}> {
  if (!(await canBulkDeleteLeads(userId))) {
    throw new Error(
      "You do not have permission to bulk-delete leads. Contact a Business Admin or CEO."
    );
  }

  const permanent = !!opts?.permanent;
  if (permanent) {
    const role = await resolveActorRole(userId);
    if (!BULK_DELETE_ROLES.has(role)) {
      throw new Error("Only Business Admin / CEO can permanently delete leads");
    }
  }

  const where = await buildContactListWhere(userId, {
    type: "lead",
    search: filters.search?.trim() || undefined,
    status: filters.status?.trim() || undefined,
    trashOnly: false,
    includeDeleted: false,
  });

  const matched = await prisma.contact.count({ where: where as never });
  if (matched === 0) {
    throw new Error("No leads match the current filters");
  }
  if (matched > BULK_DELETE_MAX_IDS) {
    throw new Error(
      `Too many matching leads (${matched.toLocaleString()}). Refine filters (max ${BULK_DELETE_MAX_IDS.toLocaleString()}).`
    );
  }

  // Sample IDs for undo (first 200) — full undo of 50k would require storing all IDs
  const sample = await prisma.contact.findMany({
    where: where as never,
    select: { id: true },
    take: 200,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const sampleIds = sample.map((c) => c.id);

  let deleted = 0;
  // Process in chunks of 1,000. Re-query the head of the filtered set each time
  // (no cursor) so soft-deleted rows drop out of the next page naturally.
  while (deleted < BULK_DELETE_MAX_IDS) {
    const batch = await prisma.contact.findMany({
      where: where as never,
      select: { id: true },
      take: BULK_DELETE_CHUNK,
      orderBy: { id: "asc" },
    });
    if (!batch.length) break;
    const batchIds = batch.map((c) => c.id);

    if (permanent) {
      let batchDeleted = 0;
      for (const id of batchIds) {
        try {
          await prisma.contact.delete({ where: { id } });
          deleted++;
          batchDeleted++;
        } catch {
          /* skip FK / already gone */
        }
      }
      // Safety: nothing removed → stop to avoid infinite re-fetch of the same rows
      if (batchDeleted === 0) break;
    } else {
      // Re-apply list filters + batch ids so we never soft-delete outside the filtered set
      const result = await prisma.contact.updateMany({
        where: {
          AND: [where, { id: { in: batchIds }, deletedAt: null }],
        } as never,
        data: { deletedAt: new Date(), deletedByUserId: userId },
      });
      deleted += result.count;
      // Safety: if nothing was updated, avoid infinite loop
      if (result.count === 0) break;
    }

    if (batch.length < BULK_DELETE_CHUNK) break;
    if (deleted >= matched) break;
  }

  const businessId = await getUserBusinessId(userId);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: permanent
      ? "lead_bulk_delete_all_filtered_permanent"
      : "lead_bulk_delete_all_filtered",
    entityType: "contact",
    metadata: {
      matched,
      deleted,
      permanent,
      scope: "all_filtered",
      batchSize: BULK_DELETE_CHUNK,
      filters: {
        search: filters.search || null,
        status: filters.status || null,
      },
      sampleIds,
    },
  });

  scheduleFollowupRefresh(userId);
  return {
    deleted,
    failed: Math.max(0, matched - deleted),
    ids: sampleIds,
    permanent,
    scope: "all_filtered",
    matched,
  };
}

export type BulkAssignScope = "ids" | "first_n" | "all_filtered";

export type BulkAssignInput = {
  assignedTo: string;
  scope: BulkAssignScope;
  /** Required when scope === "ids" */
  ids?: string[];
  /** Required when scope === "first_n" — how many filtered leads to assign */
  limit?: number;
  search?: string;
  status?: string;
};

/**
 * Enterprise bulk assign: selected IDs, first N filtered, or all filtered (≤50k).
 * Updates in batches of 1,000. Audited with actor, target, filters, and counts.
 */
export async function bulkAssignLeads(
  userId: string,
  input: BulkAssignInput
): Promise<{
  assigned: number;
  failed: number;
  matched: number;
  requested: number;
  scope: BulkAssignScope;
  limit: number | null;
  assignedTo: string;
  assigneeName: string | null;
  ids: string[];
}> {
  if (!(await canBulkEditLeads(userId))) {
    throw new Error("You do not have permission to bulk-assign leads");
  }

  const assignedTo = String(input.assignedTo || "").trim();
  if (!assignedTo) throw new Error("Select a team member to assign");

  const scopeMode: BulkAssignScope =
    input.scope === "first_n" || input.scope === "all_filtered" || input.scope === "ids"
      ? input.scope
      : "ids";

  // Resolve assignee in same business (or platform user for super_admin edge cases)
  const businessId = await getUserBusinessId(userId);
  let assigneeName: string | null = null;
  if (businessId) {
    const member = await prisma.businessMember.findFirst({
      where: { businessId, userId: assignedTo },
      include: { user: { select: { id: true, name: true, email: true, isDisabled: true } } },
    });
    if (!member?.user) {
      throw new Error("Assignee is not an active member of this workspace");
    }
    if (member.user.isDisabled) {
      throw new Error("Cannot assign leads to a disabled user");
    }
    assigneeName = member.user.name?.trim() || member.user.email;
  } else {
    const user = await prisma.user.findUnique({
      where: { id: assignedTo },
      select: { id: true, name: true, email: true, isDisabled: true },
    });
    if (!user) throw new Error("Assignee user not found");
    if (user.isDisabled) throw new Error("Cannot assign leads to a disabled user");
    assigneeName = user.name?.trim() || user.email;
  }

  const filters = {
    search: input.search?.trim() || undefined,
    status: input.status?.trim() || undefined,
  };

  let targetIds: string[] = [];
  let matched = 0;
  let requested = 0;

  if (scopeMode === "ids") {
    const unique = [...new Set((input.ids || []).filter(Boolean))];
    if (!unique.length) throw new Error("Select at least one lead");
    if (unique.length > BULK_LEAD_MAX_ROWS) {
      throw new Error(`Maximum ${BULK_LEAD_MAX_ROWS.toLocaleString()} leads per bulk assign`);
    }
    const crmScope = await buildCrmScope(userId);
    // Validate tenant ownership in batches; only assign scoped leads
    const valid: string[] = [];
    for (let i = 0; i < unique.length; i += BULK_LEAD_CHUNK) {
      const chunk = unique.slice(i, i + BULK_LEAD_CHUNK);
      const found = await prisma.contact.findMany({
        where: andTenant(crmScope.where, {
          id: { in: chunk },
          type: "lead",
          deletedAt: null,
        }) as never,
        select: { id: true },
      });
      valid.push(...found.map((c) => c.id));
    }
    targetIds = valid;
    matched = unique.length;
    requested = unique.length;
  } else {
    const where = await buildContactListWhere(userId, {
      type: "lead",
      search: filters.search,
      status: filters.status,
      trashOnly: false,
      includeDeleted: false,
    });
    matched = await prisma.contact.count({ where: where as never });
    if (matched === 0) {
      throw new Error("No leads match the current filters");
    }
    if (matched > BULK_LEAD_MAX_ROWS && scopeMode === "all_filtered") {
      throw new Error(
        `Too many matching leads (${matched.toLocaleString()}). Refine filters (max ${BULK_LEAD_MAX_ROWS.toLocaleString()}).`
      );
    }

    let limit =
      scopeMode === "all_filtered"
        ? Math.min(matched, BULK_LEAD_MAX_ROWS)
        : Math.floor(Number(input.limit));

    if (scopeMode === "first_n") {
      if (!Number.isFinite(limit) || limit < 1) {
        throw new Error("Enter a count between 1 and 50,000");
      }
      if (limit > BULK_LEAD_MAX_ROWS) {
        throw new Error(`Maximum ${BULK_LEAD_MAX_ROWS.toLocaleString()} leads per bulk assign`);
      }
      if (limit > matched) {
        // Cap to matched — do not error (UX: "first 1500 of 800" → assign all 800)
        limit = matched;
      }
    }

    requested = limit;

    // Fetch first N (or all) in stable list order: updatedAt desc, id asc
    // Keyset pagination avoids deep OFFSET for 10k–50k rows
    const collected: string[] = [];
    let cursorUpdatedAt: Date | null = null;
    let cursorId: string | null = null;
    while (collected.length < limit) {
      const take = Math.min(BULK_LEAD_CHUNK, limit - collected.length);
      const keyset: Record<string, unknown> | null =
        cursorUpdatedAt && cursorId
          ? {
              OR: [
                { updatedAt: { lt: cursorUpdatedAt } },
                {
                  AND: [{ updatedAt: cursorUpdatedAt }, { id: { gt: cursorId } }],
                },
              ],
            }
          : null;
      const pageWhere = (keyset ? { AND: [where, keyset] } : where) as never;
      const batch: Array<{ id: string; updatedAt: Date }> = await prisma.contact.findMany({
        where: pageWhere,
        select: { id: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take,
      });
      if (!batch.length) break;
      collected.push(...batch.map((c: { id: string }) => c.id));
      const last: { id: string; updatedAt: Date } = batch[batch.length - 1]!;
      cursorUpdatedAt = last.updatedAt;
      cursorId = last.id;
      if (batch.length < take) break;
    }
    targetIds = collected;
  }

  if (!targetIds.length) {
    throw new Error(
      scopeMode === "ids"
        ? "No assignable leads found for the selected IDs (wrong type, deleted, or out of scope)"
        : "No assignable leads found for the current filters"
    );
  }

  // Apply assignment in batches of 1,000 — re-apply tenant scope for defense-in-depth
  const crmScopeForUpdate = await buildCrmScope(userId);
  let assigned = 0;
  const sampleIds: string[] = [];
  for (let i = 0; i < targetIds.length; i += BULK_LEAD_CHUNK) {
    const chunk = targetIds.slice(i, i + BULK_LEAD_CHUNK);
    const result = await prisma.contact.updateMany({
      where: andTenant(crmScopeForUpdate.where, {
        id: { in: chunk },
        type: "lead",
        deletedAt: null,
      }) as never,
      data: {
        assignedTo,
        lastContactedAt: new Date(),
      },
    });
    assigned += result.count;
    if (sampleIds.length < 100) {
      sampleIds.push(...chunk.slice(0, 100 - sampleIds.length));
    }
  }

  const failed = Math.max(0, targetIds.length - assigned);

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "lead_bulk_assign",
    entityType: "contact",
    metadata: {
      scope: scopeMode,
      assignedTo,
      assigneeName,
      filters: {
        search: filters.search || null,
        status: filters.status || null,
      },
      matched,
      requested,
      assigned,
      failed,
      limit: scopeMode === "first_n" ? requested : null,
      batchSize: BULK_LEAD_CHUNK,
      sampleIds,
      timestamp: new Date().toISOString(),
    },
  });

  scheduleFollowupRefresh(userId);
  return {
    assigned,
    failed,
    matched,
    requested,
    scope: scopeMode,
    limit: scopeMode === "first_n" ? requested : null,
    assignedTo,
    assigneeName,
    ids: sampleIds,
  };
}

/**
 * Send email to one or more leads via platform SMTP.
 */
export async function sendLeadEmails(
  userId: string,
  input: {
    contactIds: string[];
    to?: string;
    subject: string;
    body: string;
  }
): Promise<{ sent: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> }> {
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  if (!subject) throw new Error("Subject is required");
  if (!body) throw new Error("Email body is required");
  if (subject.length > 200) throw new Error("Subject is too long");
  if (body.length > 50_000) throw new Error("Email body is too long");

  const ids = [...new Set((input.contactIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one lead");
  if (ids.length > 50) throw new Error("Maximum 50 recipients per send");

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const singleTo = input.to?.trim();
  if (singleTo && !emailRe.test(singleTo)) {
    throw new Error("Invalid recipient email address");
  }

  const scope = await buildCrmScope(userId);
  const contacts = await prisma.contact.findMany({
    where: andTenant(scope.where, {
      id: { in: ids },
      type: "lead",
      deletedAt: null,
    }) as never,
    select: { id: true, name: true, email: true },
  });

  if (!contacts.length) throw new Error("No matching leads found");

  const { sendEmail } = await import("./email.service.js");
  const { buildContactTemplateVars, renderTemplate } = await import(
    "./template-vars.service.js"
  );
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  let sent = 0;
  let failed = 0;

  for (const c of contacts) {
    const to = singleTo || (c.email || "").trim();
    if (!to || !emailRe.test(to)) {
      failed++;
      results.push({ id: c.id, ok: false, error: "Lead has no valid email" });
      continue;
    }
    try {
      // Personalize subject + body per lead (never leave {{placeholders}})
      const vars = await buildContactTemplateVars({
        contactId: c.id,
        actorUserId: userId,
        businessId: scope.businessId,
      });
      const finalSubject = renderTemplate(subject, vars) || subject;
      const finalBody = renderTemplate(body, vars) || body;
      const delivery = await sendEmail({
        to,
        subject: finalSubject,
        text: finalBody,
        html: finalBody.replace(/\n/g, "<br/>\n"),
      });
      if (!delivery.delivered && delivery.mode === "console") {
        // Dev: still count as sent for UX
        console.warn(`[crm-email] console-only delivery to ${to}`);
      }
      await logActivity({
        userId,
        entityType: "contact",
        entityId: c.id,
        action: "email_sent",
        details: { subject: finalSubject, to, mode: delivery.mode },
      }).catch(() => undefined);
      sent++;
      results.push({ id: c.id, ok: true });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : "Send failed";
      console.error(`[crm-email] failed contactId=${c.id}:`, msg);
      results.push({ id: c.id, ok: false, error: msg });
    }
  }

  const businessId = await getUserBusinessId(userId);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "lead_email_sent",
    entityType: "contact",
    metadata: { sent, failed, subject, contactIds: ids.slice(0, 50) },
  });

  if (sent === 0 && failed > 0) {
    throw new Error(results[0]?.error || "Failed to send email");
  }

  return { sent, failed, results };
}

/** Restore soft-deleted leads (undo). */
export async function bulkRestoreLeads(
  userId: string,
  ids: string[]
): Promise<{ restored: number; failed: number }> {
  if (!(await canBulkEditLeads(userId)) && !(await canBulkDeleteLeads(userId))) {
    throw new Error("You do not have permission to restore leads");
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw new Error("No leads to restore");

  const scope = await buildCrmScope(userId);
  const contacts = await prisma.contact.findMany({
    where: andTenant(scope.where, {
      id: { in: unique },
      type: "lead",
      deletedAt: { not: null },
    }) as never,
    select: { id: true },
  });

  let restored = 0;
  for (const c of contacts) {
    try {
      await prisma.contact.update({
        where: { id: c.id },
        data: { deletedAt: null, deletedByUserId: null },
      });
      restored++;
    } catch {
      /* skip */
    }
  }

  const businessId = await getUserBusinessId(userId);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "lead_bulk_restore",
    entityType: "contact",
    metadata: { requested: unique.length, restored, ids: unique.slice(0, 100) },
  });

  scheduleFollowupRefresh(userId);
  return { restored, failed: unique.length - restored };
}

// =====================
// Deal Operations (Pipeline)
// =====================

export type DealListFilters = {
  contactId?: string;
  stage?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export async function getDeals(userId: string, filters?: DealListFilters) {
  const scope = await buildOwnedEntityScope(userId);
  const extra: Record<string, unknown> = {};
  if (filters?.contactId) extra.contactId = filters.contactId;
  if (filters?.stage) extra.stage = filters.stage;
  if (filters?.search) {
    extra.title = { contains: filters.search, mode: "insensitive" };
  }
  const where = andTenant(scope.where, extra) as never;
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters?.pageSize ? Math.min(200, Math.max(1, filters.pageSize)) : 25;
  const sortBy = ["title", "value", "stage", "createdAt", "updatedAt"].includes(filters?.sortBy || "")
    ? filters!.sortBy!
    : "updatedAt";
  const sortDir = filters?.sortDir === "asc" ? "asc" : "desc";
  const { skip, take } = skipTake(page, pageSize);

  const [total, items] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take,
      include: {
        contact: {
          select: { id: true, name: true, type: true, status: true },
        },
      },
    }),
  ]);
  // Surface latest Lead status for My Deals cards (from contact + customFields.leadStatus)
  // Always serialize Decimal `value` to a finite number so clients never string-concatenate money.
  const enriched = items.map((d) => {
    const cf = (d.customFields || {}) as Record<string, unknown>;
    const leadStatus =
      (d.contact as { status?: string } | null)?.status ||
      (typeof cf.leadStatus === "string" ? cf.leadStatus : null) ||
      null;
    const leadStatusLabel =
      (typeof cf.leadStatusLabel === "string" ? cf.leadStatusLabel : null) ||
      leadStatus;
    return {
      ...d,
      value: d.value == null ? null : toMoneyNumber(d.value),
      leadStatus,
      leadStatusLabel,
      contact: d.contact
        ? {
            ...d.contact,
            status: (d.contact as { status?: string }).status,
          }
        : d.contact,
    };
  });
  return paginated(enriched, total, page, pageSize);
}

export async function createDeal(userId: string, input: DealInput) {
  const parsed = dealSchema.parse(input);
  const businessId = await getUserBusinessId(userId);
  // Validate contact is in-tenant before linking (prevent cross-tenant IDOR)
  if (parsed.contactId) {
    const scope = await buildCrmScope(userId);
    const contact = await prisma.contact.findFirst({
      where: andTenant(scope.where, {
        id: parsed.contactId,
        deletedAt: null,
      }) as never,
    });
    if (!contact) throw new Error("Contact not found or not accessible");
  }

  // Prefer contact's businessId when linking, so deal never lands in null tenant
  let dealBusinessId = businessId ?? null;
  if (parsed.contactId) {
    const linked = await prisma.contact.findFirst({
      where: { id: parsed.contactId },
      select: { businessId: true },
    });
    if (linked?.businessId) dealBusinessId = linked.businessId;
  }
  // Phase 1.1 — never create a Deal without workspace isolation
  if (!dealBusinessId) {
    throw new Error(
      "Business workspace is required to create a deal. Join or select a business workspace and try again."
    );
  }

  let customFieldsBag: Record<string, unknown> = {};
  if (parsed.customFields && typeof parsed.customFields === "object") {
    try {
      const { validateCustomFieldsPayload } = await import("./custom-fields.service.js");
      customFieldsBag = await validateCustomFieldsPayload(
        userId,
        "deal",
        parsed.customFields as Record<string, unknown>,
        { partial: true }
      );
    } catch (err) {
      if (err && typeof err === "object" && "status" in err) throw err;
      throw err;
    }
  }

  return prisma.deal.create({
    data: {
      userId,
      businessId: dealBusinessId,
      contactId: parsed.contactId || null,
      title: parsed.title,
      value: parsed.value ?? null,
      stage: parsed.stage,
      expectedClose: parsed.expectedClose ? new Date(parsed.expectedClose) : null,
      probability: parsed.probability ?? null,
      notes: parsed.notes || null,
      customFields: customFieldsBag as object,
    },
  }).then(async (deal) => {
    await notifyCrmCreated(userId, {
      entityType: "deal",
      entityId: deal.id,
      title: "Deal created",
      message: `Deal "${deal.title}" was added${deal.value != null ? ` (${deal.value})` : ""}`,
      notifType: "activity",
    });
    // If created already as Won, record Finance revenue
    try {
      const { syncDealWonFinance } = await import("./finance-crm-sync.service.js");
      await syncDealWonFinance(userId, deal, "lead");
    } catch (err) {
      console.error("[createDeal] finance CRM sync failed", err);
    }
    scheduleFollowupRefresh(userId);
    return deal;
  });
}

export async function updateDeal(userId: string, id: string, input: Partial<DealInput>) {
  // Deal has no assignedTo — use owned-entity scope (never Contact CRM scope)
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.deal.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) throw new Error("Deal not found");

  const parsed = dealSchema.partial().parse(input);

  // Normalize to unified Lead/Deal vocabulary (legacy closed_won → won, lead → new, …)
  const { normalizeStatusKey } = await import("../lib/lead-statuses.js");
  const rawStage = parsed.stage ?? existing.stage;
  const nextStage = normalizeStatusKey(String(rawStage || "new")) || "new";
  const stageChanged =
    String(nextStage).trim().toLowerCase() !==
    String(existing.stage || "").trim().toLowerCase();

  let nextCustom = existing.customFields as object;
  if (parsed.customFields && typeof parsed.customFields === "object") {
    const { validateCustomFieldsPayload, mergeCustomFields: mergeCf } = await import(
      "./custom-fields.service.js"
    );
    const patch = await validateCustomFieldsPayload(
      userId,
      "deal",
      parsed.customFields as Record<string, unknown>,
      { partial: true }
    );
    nextCustom = mergeCf(existing.customFields, patch) as object;
  }

  const updated = await prisma.deal.update({
    where: { id },
    data: {
      contactId: parsed.contactId !== undefined ? (parsed.contactId || null) : existing.contactId,
      title: parsed.title ?? existing.title,
      value: parsed.value !== undefined ? parsed.value : existing.value,
      stage: nextStage,
      expectedClose: parsed.expectedClose !== undefined
        ? (parsed.expectedClose ? new Date(parsed.expectedClose) : null)
        : existing.expectedClose,
      probability: parsed.probability !== undefined ? parsed.probability : existing.probability,
      notes: parsed.notes !== undefined ? (parsed.notes || null) : existing.notes,
      customFields: nextCustom,
    },
  });

  let pipelineSync: PipelineSyncResult | null = null;

  if (stageChanged) {
    if (/^(won|closed_won)$/i.test(nextStage)) {
      await notifyUser(userId, {
        type: "deal_won",
        title: "Deal won",
        message: `Deal "${updated.title}" moved to ${nextStage}`,
        entityType: "deal",
        entityId: updated.id,
      }).catch(() => {});
    } else if (/^(lost|closed_lost)$/i.test(nextStage)) {
      await notifyUser(userId, {
        type: "deal_lost",
        title: "Deal lost",
        message: `Deal "${updated.title}" moved to ${nextStage}`,
        entityType: "deal",
        entityId: updated.id,
      }).catch(() => {});
    }

    // Keep linked Lead/Client status in sync with pipeline stage
    try {
      pipelineSync = await syncFromDealStageChange(
        userId,
        {
          id: updated.id,
          title: updated.title,
          stage: updated.stage,
          contactId: updated.contactId,
          businessId: updated.businessId,
        },
        existing.stage
      );
    } catch (err) {
      console.error("[updateDeal] pipeline sync failed", err);
    }
  }

  // Finance: Deal Won → paid invoice + payment (idempotent); leave Won → void
  try {
    const { syncDealWonFinance } = await import("./finance-crm-sync.service.js");
    await syncDealWonFinance(userId, updated, existing.stage);
  } catch (err) {
    console.error("[updateDeal] finance CRM sync failed", err);
  }

  scheduleFollowupRefresh(userId);
  return { deal: updated, pipelineSync };
}

export async function deleteDeal(userId: string, id: string) {
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.deal.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) {
    throw new Error("Deal not found");
  }
  return prisma.deal.delete({ where: { id } });
}

// =====================
// Task Operations
// =====================

export type TaskListFilters = {
  contactId?: string;
  dealId?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export async function getTasks(userId: string, filters?: TaskListFilters) {
  const scope = await buildOwnedEntityScope(userId);
  const extra: Record<string, unknown> = {};
  if (filters?.contactId) extra.contactId = filters.contactId;
  if (filters?.dealId) extra.dealId = filters.dealId;
  if (filters?.status) extra.status = filters.status;
  if (filters?.search) {
    extra.title = { contains: filters.search, mode: "insensitive" };
  }
  const where = andTenant(scope.where, extra) as never;
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters?.pageSize ? Math.min(200, Math.max(1, filters.pageSize)) : 50;
  // Default newest-first so follow-ups created from Leads appear on page 1
  // (previous dueDate ASC + pageSize 25 hid new tasks behind older/null due dates).
  const sortBy = ["title", "status", "dueDate", "createdAt", "updatedAt", "priority"].includes(
    filters?.sortBy || ""
  )
    ? filters!.sortBy!
    : "createdAt";
  const sortDir =
    filters?.sortDir === "asc" || filters?.sortDir === "desc"
      ? filters.sortDir
      : filters?.sortBy
        ? "asc"
        : "desc";
  const { skip, take } = skipTake(page, pageSize);

  const [total, items] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ [sortBy]: sortDir }, { id: "desc" }],
      skip,
      take,
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createTask(userId: string, input: TaskInput) {
  const parsed = taskSchema.parse(input);
  // Must match getTasks / buildOwnedEntityScope — oldest membership caused
  // Follow-up tasks to be written to a different workspace than the list scope.
  const businessId = await getUserBusinessId(userId);

  const { resolveCustomFieldsWrite } = await import("./custom-fields.service.js");
  const customFieldsBag = await resolveCustomFieldsWrite(
    userId,
    "task",
    parsed.customFields,
    undefined,
    { partial: true }
  );

  return prisma.task.create({
    data: {
      userId,
      businessId: businessId ?? null,
      contactId: parsed.contactId || null,
      dealId: parsed.dealId || null,
      title: parsed.title,
      description: parsed.description || null,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      status: parsed.status,
      priority: parsed.priority || null,
      customFields: customFieldsBag as object,
    },
  }).then(async (task) => {
    await notifyCrmCreated(userId, {
      entityType: "task",
      entityId: task.id,
      title: "Task created",
      message: `Task "${task.title}" was added`,
      notifType: "task_reminder",
    });
    scheduleFollowupRefresh(userId);
    return task;
  });
}

export async function updateTask(userId: string, id: string, input: Partial<TaskInput>) {
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.task.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) throw new Error("Task not found");

  const parsed = taskSchema.partial().parse(input);
  const { resolveCustomFieldsWrite } = await import("./custom-fields.service.js");
  const nextCustom =
    parsed.customFields !== undefined
      ? await resolveCustomFieldsWrite(userId, "task", parsed.customFields, existing.customFields, {
          partial: true,
        })
      : undefined;

  const nextStatus = parsed.status ?? existing.status;
  const completedNow =
    nextStatus === "done" && String(existing.status || "").toLowerCase() !== "done";

  const updated = await prisma.task.update({
    where: { id },
    data: {
      contactId: parsed.contactId !== undefined ? (parsed.contactId || null) : existing.contactId,
      dealId: parsed.dealId !== undefined ? (parsed.dealId || null) : existing.dealId,
      title: parsed.title ?? existing.title,
      description: parsed.description !== undefined ? (parsed.description || null) : existing.description,
      dueDate: parsed.dueDate !== undefined ? (parsed.dueDate ? new Date(parsed.dueDate) : null) : existing.dueDate,
      status: nextStatus,
      priority: parsed.priority !== undefined ? (parsed.priority || null) : existing.priority,
      ...(nextCustom !== undefined ? { customFields: nextCustom as object } : {}),
    },
  });

  if (completedNow) {
    await logActivity({
      userId,
      entityType: "task",
      entityId: updated.id,
      action: "task_completed",
      details: { title: updated.title, contactId: updated.contactId },
    }).catch(() => undefined);
  }

  return updated;
}

export async function deleteTask(userId: string, id: string) {
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.task.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) {
    throw new Error("Task not found");
  }
  return prisma.task.delete({ where: { id } });
}

// =====================
// Meeting Operations
// =====================

export type MeetingListFilters = {
  contactId?: string;
  dealId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export async function getMeetings(userId: string, filters?: MeetingListFilters) {
  const scope = await buildOwnedEntityScope(userId);
  const extra: Record<string, unknown> = {};
  if (filters?.contactId) extra.contactId = filters.contactId;
  if (filters?.dealId) extra.dealId = filters.dealId;
  if (filters?.search) {
    extra.title = { contains: filters.search, mode: "insensitive" };
  }
  const where = andTenant(scope.where, extra) as never;
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters?.pageSize ? Math.min(200, Math.max(1, filters.pageSize)) : 25;
  const sortBy = ["title", "scheduledAt", "createdAt"].includes(filters?.sortBy || "")
    ? filters!.sortBy!
    : "scheduledAt";
  const sortDir = filters?.sortDir === "asc" ? "asc" : "desc";
  const { skip, take } = skipTake(page, pageSize);

  const [total, items] = await Promise.all([
    prisma.meeting.count({ where }),
    prisma.meeting.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take,
      include: {
        contact: { select: { id: true, name: true, company: true, type: true } },
        deal: { select: { id: true, title: true } },
      },
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createMeeting(userId: string, input: MeetingInput) {
  const parsed = meetingSchema.parse(input);
  // Align with getMeetings / buildOwnedEntityScope (same as createTask).
  const businessId = await getUserBusinessId(userId);

  const { resolveCustomFieldsWrite } = await import("./custom-fields.service.js");
  const customFieldsBag = await resolveCustomFieldsWrite(
    userId,
    "meeting",
    parsed.customFields,
    undefined,
    { partial: true }
  );

  return prisma.meeting.create({
    data: {
      userId,
      businessId: businessId ?? null,
      contactId: parsed.contactId || null,
      dealId: parsed.dealId || null,
      title: parsed.title,
      scheduledAt: new Date(parsed.scheduledAt),
      durationMin: parsed.durationMin ?? null,
      notes: parsed.notes || null,
      outcome: parsed.outcome || null,
      customFields: customFieldsBag as object,
    },
  }).then(async (meeting) => {
    await notifyCrmCreated(userId, {
      entityType: "meeting",
      entityId: meeting.id,
      title: "Meeting scheduled",
      message: `Meeting "${meeting.title}" on ${meeting.scheduledAt.toLocaleString()}`,
      notifType: "meeting_reminder",
    });
    scheduleFollowupRefresh(userId);
    return meeting;
  });
}

export async function updateMeeting(userId: string, id: string, input: Partial<MeetingInput>) {
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.meeting.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) throw new Error("Meeting not found");

  const parsed = meetingSchema.partial().parse(input);
  const { resolveCustomFieldsWrite } = await import("./custom-fields.service.js");
  const nextCustom =
    parsed.customFields !== undefined
      ? await resolveCustomFieldsWrite(
          userId,
          "meeting",
          parsed.customFields,
          existing.customFields,
          { partial: true }
        )
      : undefined;

  return prisma.meeting.update({
    where: { id },
    data: {
      contactId: parsed.contactId !== undefined ? (parsed.contactId || null) : existing.contactId,
      dealId: parsed.dealId !== undefined ? (parsed.dealId || null) : existing.dealId,
      title: parsed.title ?? existing.title,
      scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : existing.scheduledAt,
      durationMin: parsed.durationMin !== undefined ? (parsed.durationMin ?? null) : existing.durationMin,
      notes: parsed.notes !== undefined ? (parsed.notes || null) : existing.notes,
      outcome: parsed.outcome !== undefined ? (parsed.outcome || null) : existing.outcome,
      ...(nextCustom !== undefined ? { customFields: nextCustom as object } : {}),
    },
  });
}

export async function deleteMeeting(userId: string, id: string) {
  const { where: tenant } = await buildOwnedTenantScope(userId);
  const existing = await prisma.meeting.findFirst({
    where: andTenant(tenant, { id }) as never,
  });
  if (!existing) {
    throw new Error("Meeting not found");
  }
  return prisma.meeting.delete({ where: { id } });
}

// =====================
// Note Operations (generic attachment)
// =====================

/** Ensure note target entity is in the caller's tenant scope (blocks cross-business IDOR). */
async function assertNoteEntityAccess(
  userId: string,
  entityType: string,
  entityId: string
): Promise<void> {
  const type = String(entityType || "").toLowerCase();
  if (type === "contact" || type === "lead" || type === "client") {
    const scope = await buildCrmScope(userId);
    const row = await prisma.contact.findFirst({
      where: andTenant(scope.where, { id: entityId, deletedAt: null }) as never,
      select: { id: true },
    });
    if (!row) throw new Error("Contact not found or not accessible");
    return;
  }
  if (type === "deal") {
    const scope = await buildOwnedEntityScope(userId);
    const row = await prisma.deal.findFirst({
      where: andTenant(scope.where, { id: entityId }) as never,
      select: { id: true },
    });
    if (!row) throw new Error("Deal not found or not accessible");
    return;
  }
  if (type === "task") {
    const scope = await buildOwnedEntityScope(userId);
    const row = await prisma.task.findFirst({
      where: andTenant(scope.where, { id: entityId }) as never,
      select: { id: true },
    });
    if (!row) throw new Error("Task not found or not accessible");
    return;
  }
  if (type === "meeting") {
    const scope = await buildOwnedEntityScope(userId);
    const row = await prisma.meeting.findFirst({
      where: andTenant(scope.where, { id: entityId }) as never,
      select: { id: true },
    });
    if (!row) throw new Error("Meeting not found or not accessible");
    return;
  }
  // Unknown entity types: still require ownership of any existing notes pattern
}

export async function getNotes(userId: string, entityType: string, entityId: string) {
  await assertNoteEntityAccess(userId, entityType, entityId);
  return prisma.note.findMany({
    where: { userId, entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createNote(userId: string, input: NoteInput) {
  const parsed = noteSchema.parse(input);
  await assertNoteEntityAccess(userId, parsed.entityType, parsed.entityId);

  return prisma.note.create({
    data: {
      userId,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      content: parsed.content,
    },
  });
}

export async function updateNote(userId: string, id: string, input: Partial<NoteInput>) {
  const existing = await prisma.note.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Note not found");

  const parsed = noteSchema.partial().parse(input);

  return prisma.note.update({
    where: { id },
    data: {
      entityType: parsed.entityType ?? existing.entityType,
      entityId: parsed.entityId ?? existing.entityId,
      content: parsed.content ?? existing.content,
    },
  });
}

export async function deleteNote(userId: string, id: string) {
  const existing = await prisma.note.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new Error("Note not found");
  }
  return prisma.note.delete({ where: { id } });
}

// =====================
// Document Operations
// =====================

export type DocumentListFilters = {
  entityType?: string;
  entityId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export async function getDocuments(userId: string, filters?: DocumentListFilters) {
  // Documents are user-owned; SE only sees own docs
  const scope = await buildOwnedEntityScope(userId);
  // Document model has no businessId — filter by userId when ownDataOnly
  const baseWhere = scope.ownDataOnly
    ? { userId }
    : {
        // business-wide: all docs owned by members of business (via userId list)
        userId: scope.businessId
          ? {
              in: (
                await prisma.businessMember.findMany({
                  where: { businessId: scope.businessId },
                  select: { userId: true },
                })
              ).map((m) => m.userId),
            }
          : userId,
      };

  const extra: Record<string, unknown> = {};
  if (filters?.entityType) extra.entityType = filters.entityType;
  if (filters?.entityId) extra.entityId = filters.entityId;
  if (filters?.search) {
    extra.title = { contains: filters.search, mode: "insensitive" };
  }
  const where = andTenant(baseWhere as Record<string, unknown>, extra) as never;
  const page = filters?.page && filters.page > 0 ? filters.page : 1;
  const pageSize = filters?.pageSize ? Math.min(200, Math.max(1, filters.pageSize)) : 25;
  const { skip, take } = skipTake(page, pageSize);

  const [total, items] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: { createdAt: filters?.sortDir === "asc" ? "asc" : "desc" },
      skip,
      take,
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createDocument(userId: string, input: DocumentInput) {
  const parsed = documentSchema.parse(input);

  return prisma.document.create({
    data: {
      userId,
      entityType: parsed.entityType || null,
      entityId: parsed.entityId || null,
      title: parsed.title,
      url: parsed.url || null,
      mimeType: parsed.mimeType || null,
    },
  });
}

export async function updateDocument(userId: string, id: string, input: Partial<DocumentInput>) {
  const existing = await prisma.document.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Document not found");

  const parsed = documentSchema.partial().parse(input);

  return prisma.document.update({
    where: { id },
    data: {
      entityType: parsed.entityType !== undefined ? (parsed.entityType || null) : existing.entityType,
      entityId: parsed.entityId !== undefined ? (parsed.entityId || null) : existing.entityId,
      title: parsed.title ?? existing.title,
      url: parsed.url !== undefined ? (parsed.url || null) : existing.url,
      mimeType: parsed.mimeType !== undefined ? (parsed.mimeType || null) : existing.mimeType,
    },
  });
}

export async function deleteDocument(userId: string, id: string) {
  const existing = await prisma.document.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new Error("Document not found");
  }
  return prisma.document.delete({ where: { id } });
}

// =====================================================
// AI CRM & Sales Intelligence Functions (Batch 4)
// All use central AI service + sanitization. Modular.
// =====================================================

export async function generateLeadScore(userId: string, contactId: string) {
  const { where: tenant } = await buildTenantScope(userId);
  const contact = await prisma.contact.findFirst({
    where: andTenant(tenant, { id: contactId }) as never,
  });
  if (!contact) throw new Error("Contact not found");

  const profile = await prisma.businessProfile.findUnique({ where: { userId } });

  const ai = await getAIService();

  const prompt = `
You are an expert sales analyst.

Business: ${sanitizePromptInput(profile?.businessName)} (${sanitizePromptInput(profile?.industry)})
Description: ${sanitizePromptInput(profile?.description)}

Lead: ${sanitizePromptInput(contact.name)} at ${sanitizePromptInput(contact.company)}
Email: ${sanitizePromptInput(contact.email)}
Source: ${sanitizePromptInput(contact.source)}
Value: ${contact.value || 'unknown'}
Status: ${contact.status}
Industry: ${sanitizePromptInput(contact.industry)}
Description: ${sanitizePromptInput(contact.description || '')}

Return JSON only: { "score": 0-100, "explanation": "1-2 sentence reason" }
`.trim();

  const res = await ai.generateJSON<{ score: number; explanation: string }>(prompt, { temperature: 0.4, maxTokens: 300 });

  // Persist score
  await prisma.contact.update({
    where: { id: contactId },
    data: { aiScore: Math.max(0, Math.min(100, Math.round(res.data.score))) },
  });

  return res.data;
}

export async function generateFollowUpSuggestions(userId: string, contactId: string) {
  const contact = await prisma.contact.findFirst({ where: andTenant((await buildTenantScope(userId)).where, { id: contactId }) as never });
  if (!contact) throw new Error("Contact not found");

  const profile = await prisma.businessProfile.findUnique({ where: { userId } });
  const ai = await getAIService();

  const prompt = `
Business: ${sanitizePromptInput(profile?.businessName)} in ${sanitizePromptInput(profile?.industry)}

Lead: ${sanitizePromptInput(contact.name)} (${sanitizePromptInput(contact.company || '')}), status: ${contact.status}
Last contacted: ${contact.lastContactedAt || 'never'}
Notes: ${sanitizePromptInput(contact.description || '')}

Suggest 4 specific follow-up actions.

Return ONLY JSON: { "suggestions": ["action 1", "action 2", ...] }
`.trim();

  const res = await ai.generateJSON<{ suggestions: string[] }>(prompt, { temperature: 0.7 });
  return res.data;
}

export async function generateWhatsAppMessage(
  userId: string,
  contactId: string,
  tone: string = "Professional",
  language: string = "auto"
) {
  const contact = await prisma.contact.findFirst({ where: andTenant((await buildTenantScope(userId)).where, { id: contactId }) as never });
  if (!contact) throw new Error("Contact not found");

  const profile = await prisma.businessProfile.findUnique({ where: { userId } });
  const ai = await getAIService();

  const langName = language === "auto" ? "the most appropriate language for this lead (detect naturally from name, company, industry and context; prefer English or the lead's likely local Indian language)" : language;

  const prompt = `
You are an expert sales and relationship manager for ${sanitizePromptInput(profile?.businessName || "our company")}.

Generate a high-quality, natural, personalized WhatsApp follow-up message for this lead.

Lead: ${sanitizePromptInput(contact.name)}
Company: ${sanitizePromptInput(contact.company || "N/A")}
Status: ${contact.status}
Value: ${contact.value || "N/A"}
Notes: ${sanitizePromptInput(contact.description || "")}
Source: ${sanitizePromptInput(contact.source || "")}

Requirements:
- Tone: ${tone}
- Language: Generate the ENTIRE message in ${langName}. If a specific language like Telugu/Tamil/etc. is requested, use ONLY that language's script and phrasing throughout the message. Never fall back to English unless explicitly 'en'. Use correct grammar and natural business phrasing.
- Keep it concise (WhatsApp friendly, ideally 1-4 short paragraphs).
- Make it warm, human, and valuable. Include a clear, low-pressure next step or question.
- Personalize using available details. Avoid generic templates.
- Do not use placeholders like [Name] — use actual information.
- Do NOT add any explanations, JSON, or extra text outside the message itself. Output ONLY the WhatsApp message text.
`.trim();

  // Generate plain text first (do NOT force JSON from LLM for better reliability with Indian scripts)
  const res = await ai.generateText(prompt, { temperature: 0.75, maxTokens: 600 });

  const message = (res.data || '').trim();

  // Wrap into JSON on the backend after generation
  return { message };
}

export async function generateEmail(userId: string, contactId: string, goal?: string) {
  const contact = await prisma.contact.findFirst({ where: andTenant((await buildTenantScope(userId)).where, { id: contactId }) as never });
  if (!contact) throw new Error("Contact not found");

  const profile = await prisma.businessProfile.findUnique({ where: { userId } });
  const ai = await getAIService();

  const prompt = `
Write a professional email from ${sanitizePromptInput(profile?.businessName)} to ${sanitizePromptInput(contact.name)} (${sanitizePromptInput(contact.company || '')}).

Goal: ${goal || 'advance the relationship'}

Include subject and body. Personalize using: ${sanitizePromptInput(contact.description || '')}

Return ONLY { "subject": "...", "body": "full email..." }
`.trim();

  const res = await ai.generateJSON<{ subject: string; body: string }>(prompt, { temperature: 0.6 });
  return res.data;
}

export async function generateProposal(userId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: andTenant((await buildOwnedTenantScope(userId)).where, { id: dealId }) as never,
    include: { contact: true },
  });
  if (!deal) throw new Error("Deal not found");

  const profile = await prisma.businessProfile.findUnique({ where: { userId } });
  const ai = await getAIService();

  const prompt = `
Business: ${sanitizePromptInput(profile?.businessName)}

Deal: ${sanitizePromptInput(deal.title)} value ${deal.value || 'TBD'} for ${sanitizePromptInput(deal.contact?.name || '')} at ${sanitizePromptInput(deal.contact?.company || '')}

Stage: ${deal.stage}

Create a proposal outline.

Return ONLY JSON with keys: title, executiveSummary, solution, pricing, nextSteps
`.trim();

  const res = await ai.generateJSON<{
    title?: string;
    executiveSummary?: string;
    solution?: string;
    pricing?: string;
    nextSteps?: string;
  }>(prompt, { temperature: 0.5, maxTokens: 800 });
  return res.data;
}

export async function generateSalesForecast(userId: string) {
  // Tenant-scoped deals only — never userId-only (blocks cross-business leakage)
  const scope = await buildOwnedEntityScope(userId);
  const deals = await prisma.deal.findMany({
    where: scope.where as never,
    select: {
      title: true,
      stage: true,
      value: true,
      probability: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const profile = await prisma.businessProfile.findUnique({ where: { userId } });

  const dealsSummary = deals.slice(0, 20).map((d) => ({
    title: d.title,
    stage: d.stage,
    value: d.value != null ? Number(d.value) : null,
    probability: d.probability,
  }));

  const ai = await getAIService();

  const prompt = `
Business: ${sanitizePromptInput(profile?.businessName)}

Current pipeline (JSON): ${JSON.stringify(dealsSummary)}

Provide sales forecast.

Return ONLY { "forecastRevenue": number, "winRate": number, "insights": ["..."] }
`.trim();

  const res = await ai.generateJSON<{
    forecastRevenue?: number;
    winRate?: number;
    insights?: string[];
  }>(prompt, { temperature: 0.5 });
  return res.data;
}

export async function generateNextBestAction(userId: string, entityType: string, entityId: string) {
  type EntityRow = {
    name?: string | null;
    title?: string | null;
    status?: string | null;
    stage?: string | null;
    description?: string | null;
    notes?: string | null;
  };
  let data: EntityRow | null = null;
  const profile = await prisma.businessProfile.findUnique({ where: { userId } });

  if (entityType === "contact") {
    data = await prisma.contact.findFirst({
      where: andTenant((await buildTenantScope(userId)).where, { id: entityId }) as never,
    });
  } else if (entityType === "deal") {
    data = await prisma.deal.findFirst({
      where: andTenant((await buildOwnedTenantScope(userId)).where, { id: entityId }) as never,
      include: { contact: true },
    });
  }

  if (!data) throw new Error("Entity not found");

  const ai = await getAIService();

  const prompt = `
Business: ${sanitizePromptInput(profile?.businessName)}

For ${entityType}: ${sanitizePromptInput(data.name || data.title)} status ${data.status || data.stage}

Notes: ${sanitizePromptInput(data.description || data.notes || '')}

Recommend next best action.

Return ONLY valid JSON: { "action": "short", "reason": "...", "priority": "high|medium|low", "timing": "..." }
`.trim();

  const res = await ai.generateJSON<{
    action?: string;
    reason?: string;
    priority?: string;
    timing?: string;
  }>(prompt, { temperature: 0.6 });
  return res.data;
}

export async function generateMeetingSummary(userId: string, meetingId: string) {
  // Match listMeetings scope so any meeting visible in the UI can be summarized
  const scope = await buildOwnedEntityScope(userId);
  const meeting = await prisma.meeting.findFirst({
    where: andTenant(scope.where, { id: meetingId }) as never,
    include: {
      contact: { select: { id: true, name: true, company: true, type: true, email: true } },
      deal: { select: { id: true, title: true, stage: true } },
    },
  });
  if (!meeting) throw new Error("Meeting not found");

  const ai = await getAIService();
  const profile = await prisma.businessProfile.findUnique({ where: { userId } }).catch(() => null);

  const when = meeting.scheduledAt
    ? new Date(meeting.scheduledAt).toISOString()
    : "unknown time";
  const contactName = meeting.contact?.name || "Not linked";
  const contactCompany = meeting.contact?.company || "";
  const dealTitle = meeting.deal?.title || "Not linked";

  const prompt = `
You are a CRM meeting secretary for a professional sales/customer success team.
Business: ${sanitizePromptInput(profile?.businessName || "Business")}

Meeting title: ${sanitizePromptInput(meeting.title)}
Scheduled at: ${when}
Duration (minutes): ${meeting.durationMin ?? "not specified"}
Client / Lead: ${sanitizePromptInput(contactName)}${contactCompany ? ` (${sanitizePromptInput(contactCompany)})` : ""}
Related deal: ${sanitizePromptInput(dealTitle)}

Meeting notes / discussion:
${sanitizePromptInput(meeting.notes || "No notes recorded")}

Outcome:
${sanitizePromptInput(meeting.outcome || "No outcome recorded")}

Using ONLY the information above (do not invent attendees or facts), produce a CRM-ready summary.

Return ONLY valid JSON with this exact shape:
{
  "executiveSummary": "2-4 sentence overview for executives",
  "keyDiscussionPoints": ["bullet 1", "bullet 2"],
  "actionItems": ["owner-ready action 1", "action 2"],
  "followUpTasks": ["concrete follow-up task 1", "task 2"],
  "nextMeetingRecommendation": "when/why for next meeting, or null if not needed",
  "summary": "short plain-text summary (legacy field, same spirit as executiveSummary)",
  "keyPoints": ["alias of keyDiscussionPoints for compatibility"]
}
`.trim();

  const res = await ai.generateJSON<Record<string, unknown>>(prompt, {
    temperature: 0.45,
    maxTokens: 1800,
  });
  const data = res.data || {};

  // Normalize for UI (support partial model responses)
  const keyDiscussionPoints = Array.isArray(data.keyDiscussionPoints)
    ? data.keyDiscussionPoints
    : Array.isArray(data.keyPoints)
      ? data.keyPoints
      : [];
  const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];
  const followUpTasks = Array.isArray(data.followUpTasks) ? data.followUpTasks : [];

  return {
    meetingId: meeting.id,
    meetingTitle: meeting.title,
    scheduledAt: meeting.scheduledAt,
    contact: meeting.contact
      ? { id: meeting.contact.id, name: meeting.contact.name, company: meeting.contact.company }
      : null,
    deal: meeting.deal ? { id: meeting.deal.id, title: meeting.deal.title } : null,
    executiveSummary:
      (typeof data.executiveSummary === "string" && data.executiveSummary) ||
      (typeof data.summary === "string" && data.summary) ||
      "",
    keyDiscussionPoints,
    actionItems,
    followUpTasks,
    nextMeetingRecommendation:
      typeof data.nextMeetingRecommendation === "string"
        ? data.nextMeetingRecommendation
        : data.nextMeetingRecommendation === null
          ? null
          : "",
    // legacy aliases
    summary:
      (typeof data.summary === "string" && data.summary) ||
      (typeof data.executiveSummary === "string" && data.executiveSummary) ||
      "",
    keyPoints: keyDiscussionPoints,
  };
}

export type AiReminderSuggestion = {
  id: string;
  title: string;
  description: string;
  /** ISO 8601 datetime in the future (or near-term) relative to today / meeting */
  dueAt: string;
  priority: "high" | "medium" | "low";
  type: "call" | "email" | "whatsapp" | "meeting" | "follow_up";
  assignedUserId: string;
  assignedUserName: string | null;
  assignedUserEmail: string;
  contactId: string | null;
  dealId: string | null;
  meetingId: string | null;
};

function addDaysIso(base: Date, days: number, hour = 10, minute = 0): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  // If still in the past (same-day edge), push +1 day
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

function normalizeReminderType(raw: unknown): AiReminderSuggestion["type"] {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  if (s.includes("call") || s.includes("phone")) return "call";
  if (s.includes("email") || s.includes("mail")) return "email";
  if (s.includes("whatsapp") || s.includes("wa")) return "whatsapp";
  if (s.includes("meeting") || s.includes("demo")) return "meeting";
  return "follow_up";
}

function normalizePriority(raw: unknown): AiReminderSuggestion["priority"] {
  const s = String(raw || "").toLowerCase();
  if (s === "high" || s === "urgent") return "high";
  if (s === "low") return "low";
  return "medium";
}

function parseRelativeDueAt(
  item: Record<string, unknown>,
  anchor: Date,
  index: number
): string {
  // Prefer explicit ISO
  const dueAtRaw = item.dueAt ?? item.dueDate ?? item.due_date;
  if (typeof dueAtRaw === "string" && dueAtRaw.trim()) {
    const parsed = new Date(dueAtRaw);
    if (!Number.isNaN(parsed.getTime())) {
      // Reject ancient placeholder years (e.g. 2023/2024 demo dates)
      const year = parsed.getFullYear();
      const nowY = new Date().getFullYear();
      if (year >= nowY - 1 && year <= nowY + 2) {
        if (parsed.getTime() > Date.now() - 60_000) return parsed.toISOString();
      }
    }
  }
  const days =
    typeof item.daysFromNow === "number"
      ? item.daysFromNow
      : typeof item.days_from_anchor === "number"
        ? item.days_from_anchor
        : typeof item.offsetDays === "number"
          ? item.offsetDays
          : index === 0
            ? 1
            : index === 1
              ? 3
              : 7;
  const hour = typeof item.hour === "number" ? item.hour : 10;
  return addDaysIso(anchor, Math.max(0, Math.floor(days)), hour, 0);
}

/**
 * CRM-aware AI reminders using Contact / Deal / Meeting data.
 * Dates are relative to today (or meeting scheduledAt) — never demo years.
 */
export async function generateReminders(
  userId: string,
  opts: { contactId?: string; dealId?: string; meetingId?: string } = {}
) {
  const profile = await prisma.businessProfile.findUnique({ where: { userId } });
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!actor) throw new Error("User not found");

  const contactScope = await buildCrmScope(userId);
  const dealScope = await buildOwnedEntityScope(userId);
  let contact: {
    id: string;
    name: string;
    status: string;
    type: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    lastContactedAt: Date | null;
    nextFollowUp: Date | null;
    priority: string | null;
  } | null = null;
  let deal: {
    id: string;
    title: string;
    stage: string;
    value: number | null;
    expectedClose: Date | null;
    notes: string | null;
  } | null = null;
  let meeting: {
    id: string;
    title: string;
    scheduledAt: Date;
    notes: string | null;
    outcome: string | null;
    contactId: string | null;
    dealId: string | null;
  } | null = null;

  if (opts.meetingId) {
    meeting = await prisma.meeting.findFirst({
      where: andTenant((await buildOwnedEntityScope(userId)).where, {
        id: opts.meetingId,
      }) as never,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        notes: true,
        outcome: true,
        contactId: true,
        dealId: true,
      },
    });
    if (!meeting) throw new Error("Meeting not found");
    // Prefer linked contact/deal from meeting if not explicitly passed
    if (!opts.contactId && meeting.contactId) opts.contactId = meeting.contactId;
    if (!opts.dealId && meeting.dealId) opts.dealId = meeting.dealId;
  }

  if (opts.contactId) {
    contact = await prisma.contact.findFirst({
      where: andTenant(contactScope.where, { id: opts.contactId, deletedAt: null }) as never,
      select: {
        id: true,
        name: true,
        status: true,
        type: true,
        company: true,
        email: true,
        phone: true,
        lastContactedAt: true,
        nextFollowUp: true,
        priority: true,
      },
    });
    if (!contact) throw new Error("Contact not found");
  }

  if (opts.dealId) {
    const dealRow = await prisma.deal.findFirst({
      where: andTenant(dealScope.where, { id: opts.dealId }) as never,
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        expectedClose: true,
        notes: true,
      },
    });
    if (!dealRow) throw new Error("Deal not found");
    deal = {
      ...dealRow,
      value: dealRow.value == null ? null : toMoneyNumber(dealRow.value),
    };
  }

  if (!contact && !deal && !meeting) {
    throw new Error("Select a contact, deal, or meeting to generate reminders");
  }

  const now = new Date();
  const todayIso = now.toISOString();
  const todayLocal = now.toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });
  // Anchor: meeting date if future/past meeting exists, else today
  const anchor =
    meeting?.scheduledAt && !Number.isNaN(new Date(meeting.scheduledAt).getTime())
      ? new Date(meeting.scheduledAt)
      : now;

  const contextLines = [
    `Business: ${profile?.businessName || "CRM business"}`,
    `Today (server now): ${todayIso} (${todayLocal})`,
    `Anchor date for relative offsets: ${anchor.toISOString()}`,
    actor
      ? `Assigned user (default): ${actor.name || actor.email} <${actor.email}> id=${actor.id}`
      : "",
    contact
      ? `Contact: ${contact.name} | type=${contact.type} | status=${contact.status} | company=${contact.company || "—"} | email=${contact.email || "—"} | phone=${contact.phone || "—"} | lastContacted=${contact.lastContactedAt?.toISOString() || "never"} | nextFollowUp=${contact.nextFollowUp?.toISOString() || "none"} | priority=${contact.priority || "—"} | id=${contact.id}`
      : "Contact: none selected",
    deal
      ? `Deal: ${deal.title} | stage=${deal.stage} | value=${deal.value ?? "—"} | expectedClose=${deal.expectedClose?.toISOString() || "—"} | notes=${(deal.notes || "").slice(0, 300)} | id=${deal.id}`
      : "Deal: none selected",
    meeting
      ? `Meeting: ${meeting.title} | scheduledAt=${meeting.scheduledAt.toISOString()} | notes=${(meeting.notes || "").slice(0, 400)} | outcome=${meeting.outcome || "—"} | id=${meeting.id}`
      : "Meeting: none selected",
  ]
    .filter(Boolean)
    .join("\n");

  const ai = await getAIService();
  const prompt = `
You are a CRM follow-up planner. Use ONLY the real CRM context below.
Do NOT invent years like 2023 or 2024. All due dates must be on or after TODAY.

${contextLines}

Propose 3–5 practical reminders for the assigned user.
Each reminder needs:
- title (short, actionable)
- description (1–2 sentences, CRM-specific)
- daysFromNow (integer offset from the Anchor date; use 0–14 typically; after a past meeting use positive days from today)
- hour (0–23 local business hour, prefer 9–17)
- priority: high | medium | low
- type: call | email | whatsapp | meeting | follow_up

Return ONLY valid JSON:
{
  "reminders": [
    {
      "title": "...",
      "description": "...",
      "daysFromNow": 1,
      "hour": 10,
      "priority": "high",
      "type": "call"
    }
  ]
}
`.trim();

  const res = await ai.generateJSON<{ reminders?: unknown[] }>(prompt, {
    temperature: 0.45,
    maxTokens: 1200,
  });

  const rawList = Array.isArray(res.data?.reminders) ? res.data!.reminders! : [];
  const reminders: AiReminderSuggestion[] = rawList.slice(0, 6).map((raw, index) => {
    const item =
      typeof raw === "string"
        ? { title: raw, description: raw, daysFromNow: index === 0 ? 1 : index === 1 ? 3 : 7 }
        : (raw as Record<string, unknown>) || {};
    const title =
      (typeof item.title === "string" && item.title.trim()) ||
      (typeof item.text === "string" && item.text.trim()) ||
      `Follow up #${index + 1}`;
    const description =
      (typeof item.description === "string" && item.description.trim()) ||
      (typeof item.reason === "string" && item.reason.trim()) ||
      title;

    return {
      id: `ai-rem-${index}-${Date.now()}`,
      title: title.slice(0, 200),
      description: description.slice(0, 1000),
      dueAt: parseRelativeDueAt(item, anchor.getTime() < Date.now() ? now : anchor, index),
      priority: normalizePriority(item.priority),
      type: normalizeReminderType(item.type ?? item.reminderType),
      assignedUserId: actor.id,
      assignedUserName: actor.name,
      assignedUserEmail: actor.email,
      contactId: contact?.id ?? null,
      dealId: deal?.id ?? null,
      meetingId: meeting?.id ?? null,
    };
  });

  // Fallback if AI returns empty — still CRM-relative, never static 2024
  if (reminders.length === 0) {
    const baseName = contact?.name || deal?.title || meeting?.title || "account";
    reminders.push(
      {
        id: `ai-rem-fallback-0-${Date.now()}`,
        title: `Follow up with ${baseName}`,
        description: `Check in based on current CRM status${contact ? ` (${contact.status})` : ""}${deal ? ` / deal stage ${deal.stage}` : ""}.`,
        dueAt: addDaysIso(now, 1, 10),
        priority: "high",
        type: "call",
        assignedUserId: actor.id,
        assignedUserName: actor.name,
        assignedUserEmail: actor.email,
        contactId: contact?.id ?? null,
        dealId: deal?.id ?? null,
        meetingId: meeting?.id ?? null,
      },
      {
        id: `ai-rem-fallback-1-${Date.now()}`,
        title: `Send update to ${baseName}`,
        description: "Share next steps and confirm interest via email or WhatsApp.",
        dueAt: addDaysIso(now, 3, 11),
        priority: "medium",
        type: contact?.phone ? "whatsapp" : "email",
        assignedUserId: actor.id,
        assignedUserName: actor.name,
        assignedUserEmail: actor.email,
        contactId: contact?.id ?? null,
        dealId: deal?.id ?? null,
        meetingId: meeting?.id ?? null,
      },
      {
        id: `ai-rem-fallback-2-${Date.now()}`,
        title: `Schedule next conversation — ${baseName}`,
        description: "Book a short call or demo if still engaged.",
        dueAt: addDaysIso(now, 7, 14),
        priority: "medium",
        type: "meeting",
        assignedUserId: actor.id,
        assignedUserName: actor.name,
        assignedUserEmail: actor.email,
        contactId: contact?.id ?? null,
        dealId: deal?.id ?? null,
        meetingId: meeting?.id ?? null,
      }
    );
  }

  return {
    generatedAt: todayIso,
    anchorDate: anchor.toISOString(),
    contact,
    deal,
    meeting: meeting
      ? {
          id: meeting.id,
          title: meeting.title,
          scheduledAt: meeting.scheduledAt,
        }
      : null,
    assignedUser: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
    },
    reminders,
  };
}

// =====================================================
// AI Generation Logging (for history - Feature 2+)
// =====================================================

export async function logAiGeneration(
  userId: string,
  input: {
    contactId?: string;
    feature: string;
    tone?: string;
    language?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }
) {
  return prisma.aiGeneration.create({
    data: {
      userId,
      contactId: input.contactId || null,
      feature: input.feature,
      tone: input.tone || null,
      language: input.language || null,
      content: input.content,
      metadata: (input.metadata as object | undefined) || undefined,
    },
  });
}

export async function getAiGenerations(
  userId: string,
  filters: {
    contactId?: string;
    feature?: string;
    limit?: number;
  }
) {
  if (filters.contactId) {
    await assertNoteEntityAccess(userId, "contact", filters.contactId);
  }
  return prisma.aiGeneration.findMany({
    where: {
      userId,
      ...(filters.contactId && { contactId: filters.contactId }),
      ...(filters.feature && { feature: filters.feature }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 20, 100),
  });
}