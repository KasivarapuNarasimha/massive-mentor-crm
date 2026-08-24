/**
 * Enterprise smart lead assignment:
 * - Single member or equal distribution across all active members
 * - Assignment history (batch / lines / per-lead items)
 * - Edit move + reassign
 * - Transactional updates in batches of 1,000
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { recordAudit } from "./audit.service.js";
import { scheduleFollowupRefresh } from "./followup-engine.service.js";
import {
  andTenant,
  buildCrmScope,
  resolveActorRole,
} from "./tenant-scope.service.js";
import {
  BULK_LEAD_CHUNK,
  BULK_LEAD_MAX_ROWS,
  buildContactListWhere,
  canBulkEditLeads,
} from "./crm.service.js";

export type AssignMode = "single" | "all_members";
export type AssignScope = "ids" | "first_n" | "all_filtered" | "reassign" | "edit_move";

export type AssignableMember = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  username: string | null;
  role: string;
};

export type DistributionRow = {
  userId: string;
  name: string | null;
  email: string;
  count: number;
};

const HISTORY_ADMIN_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

export async function canViewAssignmentHistory(userId: string): Promise<boolean> {
  const role = await resolveActorRole(userId);
  return HISTORY_ADMIN_ROLES.has(role) || role.includes("admin");
}

/** Active workspace members only (not disabled). Any bulk-editor can list for Assign To. */
export async function listAssignableMembers(actorUserId: string): Promise<AssignableMember[]> {
  if (!(await canBulkEditLeads(actorUserId))) {
    throw new Error("You do not have permission to assign leads");
  }
  const businessId = await getUserBusinessId(actorUserId);
  if (!businessId) {
    // Solo user — only themselves if active
    const me = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        employeeCode: true,
        username: true,
        role: true,
        isDisabled: true,
      },
    });
    if (!me || me.isDisabled) return [];
    return [
      {
        id: me.id,
        name: me.name,
        email: me.email,
        phone: me.phone,
        employeeCode: me.employeeCode,
        username: me.username,
        role: me.role,
      },
    ];
  }

  const members = await prisma.businessMember.findMany({
    where: { businessId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          employeeCode: true,
          username: true,
          role: true,
          isDisabled: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return members
    .filter((m) => m.user && !m.user.isDisabled)
    .map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      employeeCode: m.user.employeeCode,
      username: m.user.username,
      role: m.role || m.user.role,
    }));
}

/** Round-robin equal distribution: |count_i - count_j| ≤ 1 */
export function equalDistribute(leadIds: string[], memberIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!memberIds.length) return map;
  for (const m of memberIds) map.set(m, []);
  // Stable order: first members absorb remainder (+1)
  for (let i = 0; i < leadIds.length; i++) {
    const mid = memberIds[i % memberIds.length]!;
    map.get(mid)!.push(leadIds[i]!);
  }
  return map;
}

export function previewEqualDistribution(
  leadCount: number,
  members: AssignableMember[]
): DistributionRow[] {
  if (!members.length || leadCount <= 0) return [];
  const ids = members.map((m) => m.id);
  // Use dummy ids for count only
  const dummy = Array.from({ length: leadCount }, (_, i) => String(i));
  const dist = equalDistribute(dummy, ids);
  return members.map((m) => ({
    userId: m.id,
    name: m.name,
    email: m.email,
    count: dist.get(m.id)?.length ?? 0,
  }));
}

async function collectTargetLeadIds(
  userId: string,
  input: {
    scope: AssignScope;
    ids?: string[];
    limit?: number;
    search?: string;
    status?: string;
    assignedTo?: string;
  }
): Promise<{ targetIds: string[]; matched: number; requested: number }> {
  const scopeMode = input.scope === "first_n" || input.scope === "all_filtered" ? input.scope : "ids";
  const filters = {
    search: input.search?.trim() || undefined,
    status: input.status?.trim() || undefined,
    assignedTo: input.assignedTo?.trim() || undefined,
  };

  if (scopeMode === "ids" || input.scope === "reassign") {
    const unique = [...new Set((input.ids || []).filter(Boolean))];
    if (!unique.length) throw new Error("Select at least one lead");
    if (unique.length > BULK_LEAD_MAX_ROWS) {
      throw new Error(`Maximum ${BULK_LEAD_MAX_ROWS.toLocaleString()} leads per assignment`);
    }
    const crmScope = await buildCrmScope(userId);
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
    return { targetIds: valid, matched: unique.length, requested: unique.length };
  }

  const where = await buildContactListWhere(userId, {
    type: "lead",
    search: filters.search,
    status: filters.status,
    assignedTo: filters.assignedTo,
    trashOnly: false,
    includeDeleted: false,
  });
  const matched = await prisma.contact.count({ where: where as never });
  if (matched === 0) throw new Error("No leads match the current filters");
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
      throw new Error(`Maximum ${BULK_LEAD_MAX_ROWS.toLocaleString()} leads per assignment`);
    }
    if (limit > matched) limit = matched;
  }

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
              { AND: [{ updatedAt: cursorUpdatedAt }, { id: { gt: cursorId } }] },
            ],
          }
        : null;
    const batch: Array<{ id: string; updatedAt: Date }> = await prisma.contact.findMany({
      where: (keyset ? { AND: [where, keyset] } : where) as never,
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
  return { targetIds: collected, matched, requested: limit };
}

export type SmartAssignInput = {
  /** single | all_members  (all_members ignores assignedTo target) */
  mode: AssignMode;
  /** Target user when mode=single */
  assignedTo?: string;
  /**
   * Optional subset for equal distribution (mode=all_members).
   * Must be active assignable members. Order is preserved for remainder placement.
   * If omitted, all active members are used. Does not change equalDistribute math.
   */
  assigneeIds?: string[];
  scope: AssignScope;
  ids?: string[];
  limit?: number;
  search?: string;
  status?: string;
  /** Filter leads currently assigned to this userId (or "unassigned") */
  filterAssignedTo?: string;
  notes?: string;
  /** Preview only — no writes */
  dryRun?: boolean;
};

export type SmartAssignResult = {
  assigned: number;
  failed: number;
  matched: number;
  requested: number;
  mode: AssignMode;
  scope: string;
  distribution: DistributionRow[];
  assignmentId: string | null;
  sequence: number | null;
  dryRun?: boolean;
};

async function nextSequence(businessId: string): Promise<number> {
  const last = await prisma.leadAssignmentBatch.findFirst({
    where: { businessId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

/**
 * Preview or execute smart assignment (single or equal all-members).
 */
export async function smartBulkAssignLeads(
  actorUserId: string,
  input: SmartAssignInput
): Promise<SmartAssignResult> {
  if (!(await canBulkEditLeads(actorUserId))) {
    throw new Error("You do not have permission to assign leads");
  }

  const mode: AssignMode = input.mode === "all_members" ? "all_members" : "single";
  const members = await listAssignableMembers(actorUserId);
  if (!members.length) throw new Error("No active workspace members available");

  let assignees: AssignableMember[] = [];
  if (mode === "all_members") {
    const rawIds = Array.isArray(input.assigneeIds)
      ? input.assigneeIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (rawIds.length) {
      // Preserve caller order (confirm-modal remaining members) for stable remainder.
      const byId = new Map(members.map((m) => [m.id, m]));
      const seen = new Set<string>();
      assignees = [];
      for (const id of rawIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const m = byId.get(id);
        if (!m) {
          throw new Error("One or more assignees are not active members of this workspace");
        }
        assignees.push(m);
      }
      if (!assignees.length) {
        throw new Error("Select at least one member to assign leads");
      }
    } else {
      assignees = members;
    }
  } else {
    const targetId = String(input.assignedTo || "").trim();
    if (!targetId) throw new Error("Select a team member to assign");
    const m = members.find((x) => x.id === targetId);
    if (!m) throw new Error("Assignee is not an active member of this workspace");
    assignees = [m];
  }

  const { targetIds, matched, requested } = await collectTargetLeadIds(actorUserId, {
    scope: input.scope === "reassign" ? "ids" : input.scope,
    ids: input.ids,
    limit: input.limit,
    assignedTo: input.filterAssignedTo,
    search: input.search,
    status: input.status,
  });

  if (!targetIds.length) {
    throw new Error("No assignable leads found");
  }

  const buckets = equalDistribute(
    targetIds,
    assignees.map((a) => a.id)
  );
  const distribution: DistributionRow[] = assignees.map((a) => ({
    userId: a.id,
    name: a.name,
    email: a.email,
    count: buckets.get(a.id)?.length ?? 0,
  }));

  if (input.dryRun) {
    return {
      assigned: 0,
      failed: 0,
      matched,
      requested,
      mode,
      scope: input.scope,
      distribution,
      assignmentId: null,
      sequence: null,
      dryRun: true,
    };
  }

  const businessId = await getUserBusinessId(actorUserId);
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, name: true, email: true },
  });
  const actorName = actor?.name?.trim() || actor?.email || actorUserId;
  const crmScope = await buildCrmScope(actorUserId);

  // No workspace: still assign (no durable history table)
  if (!businessId) {
    let assigned = 0;
    const now = new Date();
    for (const a of assignees) {
      const ids = buckets.get(a.id) || [];
      for (let i = 0; i < ids.length; i += BULK_LEAD_CHUNK) {
        const chunk = ids.slice(i, i + BULK_LEAD_CHUNK);
        const upd = await prisma.contact.updateMany({
          where: andTenant(crmScope.where, {
            id: { in: chunk },
            type: "lead",
            deletedAt: null,
          }) as never,
          data: { assignedTo: a.id, lastContactedAt: now },
        });
        assigned += upd.count;
      }
    }
    await recordAudit({
      businessId: null,
      actorUserId,
      action: "lead_smart_assign",
      entityType: "contact",
      metadata: {
        mode,
        scope: input.scope,
        assigned,
        distribution,
        noBusinessHistory: true,
      },
    });
    scheduleFollowupRefresh(actorUserId);
    return {
      assigned,
      failed: Math.max(0, targetIds.length - assigned),
      matched,
      requested,
      mode,
      scope: input.scope,
      distribution,
      assignmentId: null,
      sequence: null,
    };
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const last = await tx.leadAssignmentBatch.findFirst({
        where: { businessId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (last?.sequence ?? 0) + 1;

      const batch = await tx.leadAssignmentBatch.create({
        data: {
          sequence,
          businessId,
          actorUserId,
          actorName,
          mode,
          scope: input.scope,
          leadCount: targetIds.length,
          memberCount: assignees.length,
          distribution: distribution as object,
          filters: {
            search: input.search || null,
            status: input.status || null,
            limit: input.limit ?? null,
          },
          notes: input.notes?.trim() || null,
          status: "completed",
        },
      });

      let assigned = 0;
      const now = new Date();

      for (const a of assignees) {
        const ids = buckets.get(a.id) || [];
        if (!ids.length) continue;

        await tx.leadAssignmentLine.create({
          data: {
            batchId: batch.id,
            userId: a.id,
            userName: a.name,
            userEmail: a.email,
            leadCount: ids.length,
          },
        });

        for (let i = 0; i < ids.length; i += BULK_LEAD_CHUNK) {
          const chunk = ids.slice(i, i + BULK_LEAD_CHUNK);
          const upd = await tx.contact.updateMany({
            where: andTenant(crmScope.where, {
              id: { in: chunk },
              type: "lead",
              deletedAt: null,
            }) as never,
            data: {
              assignedTo: a.id,
              lastContactedAt: now,
            },
          });
          assigned += upd.count;

          await tx.leadAssignmentItem.createMany({
            data: chunk.map((contactId) => ({
              batchId: batch.id,
              contactId,
              userId: a.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      return {
        batchId: batch.id,
        sequence: batch.sequence,
        assigned,
        failed: Math.max(0, targetIds.length - assigned),
      };
    },
    { maxWait: 15_000, timeout: 120_000 }
  );

  await recordAudit({
    businessId,
    actorUserId,
    action: "lead_smart_assign",
    entityType: "lead_assignment_batch",
    entityId: result.batchId,
    metadata: {
      mode,
      scope: input.scope,
      leadCount: targetIds.length,
      assigned: result.assigned,
      failed: result.failed,
      distribution,
      sequence: result.sequence,
      notes: input.notes || null,
      timestamp: new Date().toISOString(),
    },
  });

  scheduleFollowupRefresh(actorUserId);

  return {
    assigned: result.assigned,
    failed: result.failed,
    matched,
    requested,
    mode,
    scope: input.scope,
    distribution,
    assignmentId: result.batchId,
    sequence: result.sequence,
  };
}

export async function listAssignmentHistory(
  actorUserId: string,
  opts?: { page?: number; pageSize?: number }
) {
  if (!(await canViewAssignmentHistory(actorUserId))) {
    throw new Error("Only Business Admin / Admin can view assignment history");
  }
  const businessId = await getUserBusinessId(actorUserId);
  if (!businessId) return { total: 0, page: 1, pageSize: 25, items: [] };

  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 25));
  const skip = (page - 1) * pageSize;

  const [total, rows] = await Promise.all([
    prisma.leadAssignmentBatch.count({ where: { businessId } }),
    prisma.leadAssignmentBatch.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        lines: { orderBy: { leadCount: "desc" } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      mode: r.mode,
      scope: r.scope,
      leadCount: r.leadCount,
      memberCount: r.memberCount,
      distribution: r.distribution,
      status: r.status,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      lines: r.lines.map((l) => ({
        userId: l.userId,
        userName: l.userName,
        userEmail: l.userEmail,
        leadCount: l.leadCount,
      })),
    })),
  };
}

export async function getAssignmentDetail(actorUserId: string, batchId: string) {
  if (!(await canViewAssignmentHistory(actorUserId))) {
    throw new Error("Only Business Admin / Admin can view assignment history");
  }
  const businessId = await getUserBusinessId(actorUserId);
  if (!businessId) throw new Error("Workspace not found");

  const batch = await prisma.leadAssignmentBatch.findFirst({
    where: { id: batchId, businessId },
    include: {
      lines: { orderBy: { leadCount: "desc" } },
    },
  });
  if (!batch) throw new Error("Assignment not found");

  return {
    id: batch.id,
    sequence: batch.sequence,
    actorUserId: batch.actorUserId,
    actorName: batch.actorName,
    mode: batch.mode,
    scope: batch.scope,
    leadCount: batch.leadCount,
    memberCount: batch.memberCount,
    distribution: batch.distribution,
    filters: batch.filters,
    notes: batch.notes,
    status: batch.status,
    createdAt: batch.createdAt.toISOString(),
    lines: batch.lines.map((l) => ({
      userId: l.userId,
      userName: l.userName,
      userEmail: l.userEmail,
      leadCount: l.leadCount,
    })),
  };
}

/**
 * Move N leads from one member to another within a historical batch (or by current ownership).
 * Creates a new history batch of type edit_move; does not delete old history.
 */
export async function moveAssignmentLeads(
  actorUserId: string,
  input: {
    batchId: string;
    fromUserId: string;
    toUserId: string;
    count: number;
    notes?: string;
  }
): Promise<SmartAssignResult> {
  if (!(await canViewAssignmentHistory(actorUserId))) {
    throw new Error("Only Business Admin / Admin can edit assignments");
  }
  const businessId = await getUserBusinessId(actorUserId);
  if (!businessId) throw new Error("Workspace not found");

  const fromUserId = String(input.fromUserId || "").trim();
  const toUserId = String(input.toUserId || "").trim();
  const count = Math.floor(Number(input.count));
  if (!fromUserId || !toUserId) throw new Error("fromUserId and toUserId are required");
  if (fromUserId === toUserId) throw new Error("Source and destination must differ");
  if (!Number.isFinite(count) || count < 1) throw new Error("Count must be at least 1");

  const members = await listAssignableMembers(actorUserId);
  const toMember = members.find((m) => m.id === toUserId);
  if (!toMember) throw new Error("Destination user is not an active workspace member");

  const batch = await prisma.leadAssignmentBatch.findFirst({
    where: { id: input.batchId, businessId },
  });
  if (!batch) throw new Error("Assignment not found");

  const items = await prisma.leadAssignmentItem.findMany({
    where: { batchId: batch.id, userId: fromUserId },
    take: count,
    orderBy: { id: "asc" },
  });
  if (!items.length) {
    throw new Error("No leads found for that member in this assignment");
  }
  const moveIds = items.map((i) => i.contactId);
  const actualCount = moveIds.length;

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { name: true, email: true },
  });
  const fromMember = members.find((m) => m.id === fromUserId);
  const crmScope = await buildCrmScope(actorUserId);

  const result = await prisma.$transaction(
    async (tx) => {
      const sequence = await (async () => {
        const last = await tx.leadAssignmentBatch.findFirst({
          where: { businessId },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        return (last?.sequence ?? 0) + 1;
      })();

      const distribution: DistributionRow[] = [
        {
          userId: toUserId,
          name: toMember.name,
          email: toMember.email,
          count: actualCount,
        },
      ];

      const newBatch = await tx.leadAssignmentBatch.create({
        data: {
          sequence,
          businessId,
          actorUserId,
          actorName: actor?.name?.trim() || actor?.email || actorUserId,
          mode: "single",
          scope: "edit_move",
          leadCount: actualCount,
          memberCount: 1,
          distribution: distribution as object,
          filters: {
            sourceBatchId: batch.id,
            fromUserId,
            toUserId,
            requested: count,
          },
          notes:
            input.notes?.trim() ||
            `Moved ${actualCount} lead(s) from ${fromMember?.name || fromUserId} → ${toMember.name || toUserId}`,
          status: "completed",
        },
      });

      await tx.leadAssignmentLine.create({
        data: {
          batchId: newBatch.id,
          userId: toUserId,
          userName: toMember.name,
          userEmail: toMember.email,
          leadCount: actualCount,
        },
      });

      let assigned = 0;
      const now = new Date();
      for (let i = 0; i < moveIds.length; i += BULK_LEAD_CHUNK) {
        const chunk = moveIds.slice(i, i + BULK_LEAD_CHUNK);
        const upd = await tx.contact.updateMany({
          where: andTenant(crmScope.where, {
            id: { in: chunk },
            type: "lead",
            deletedAt: null,
          }) as never,
          data: { assignedTo: toUserId, lastContactedAt: now },
        });
        assigned += upd.count;

        await tx.leadAssignmentItem.updateMany({
          where: { batchId: batch.id, contactId: { in: chunk } },
          data: { userId: toUserId },
        });

        await tx.leadAssignmentItem.createMany({
          data: chunk.map((contactId) => ({
            batchId: newBatch.id,
            contactId,
            userId: toUserId,
          })),
          skipDuplicates: true,
        });
      }

      // Refresh line counts on source batch
      const remainingFrom = await tx.leadAssignmentItem.count({
        where: { batchId: batch.id, userId: fromUserId },
      });
      await tx.leadAssignmentLine.updateMany({
        where: { batchId: batch.id, userId: fromUserId },
        data: { leadCount: remainingFrom },
      });
      const toCount = await tx.leadAssignmentItem.count({
        where: { batchId: batch.id, userId: toUserId },
      });
      const existingToLine = await tx.leadAssignmentLine.findFirst({
        where: { batchId: batch.id, userId: toUserId },
      });
      if (existingToLine) {
        await tx.leadAssignmentLine.update({
          where: { id: existingToLine.id },
          data: { leadCount: toCount },
        });
      } else if (toCount > 0) {
        await tx.leadAssignmentLine.create({
          data: {
            batchId: batch.id,
            userId: toUserId,
            userName: toMember.name,
            userEmail: toMember.email,
            leadCount: toCount,
          },
        });
      }

      return {
        batchId: newBatch.id,
        sequence: newBatch.sequence,
        assigned,
        distribution,
      };
    },
    { maxWait: 15_000, timeout: 60_000 }
  );

  await recordAudit({
    businessId,
    actorUserId,
    action: "lead_assignment_edit_move",
    entityType: "lead_assignment_batch",
    entityId: result.batchId,
    metadata: {
      sourceBatchId: batch.id,
      fromUserId,
      toUserId,
      count: actualCount,
      assigned: result.assigned,
      timestamp: new Date().toISOString(),
    },
  });

  scheduleFollowupRefresh(actorUserId);

  return {
    assigned: result.assigned,
    failed: Math.max(0, actualCount - result.assigned),
    matched: actualCount,
    requested: count,
    mode: "single",
    scope: "edit_move",
    distribution: result.distribution,
    assignmentId: result.batchId,
    sequence: result.sequence,
  };
}

/**
 * Live Lead Assignment summary for Business Admin dashboard / exports.
 * Counts are computed from real Contact rows in the actor's CRM scope (tenant-isolated).
 * Uses existing Contact.assignedTo — no duplicate assignment system.
 */
export type LeadAssignmentSummary = {
  totalLeads: number;
  assignedLeads: number;
  unassignedLeads: number;
  byMember: Array<{
    userId: string | null;
    name: string;
    email: string | null;
    count: number;
  }>;
};

export async function getLeadAssignmentSummary(
  actorUserId: string
): Promise<LeadAssignmentSummary> {
  // Any user who can list leads gets scoped counts (SE sees only their slice via buildCrmScope).
  // Admins see full business totals.
  const where = await buildContactListWhere(actorUserId, { type: "lead" });

  const [totalLeads, assignedLeads, unassignedLeads, groups] = await Promise.all([
    prisma.contact.count({ where: where as never }),
    prisma.contact.count({
      where: andTenant(where, { assignedTo: { not: null } }) as never,
    }),
    prisma.contact.count({
      where: andTenant(where, { assignedTo: null }) as never,
    }),
    prisma.contact.groupBy({
      by: ["assignedTo"],
      where: andTenant(where, { assignedTo: { not: null } }) as never,
      _count: { _all: true },
    }),
  ]);

  const userIds = groups
    .map((g) => g.assignedTo)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const uMap = new Map(users.map((u) => [u.id, u]));

  const byMember = groups
    .map((g) => {
      const uid = g.assignedTo;
      const u = uid ? uMap.get(uid) : undefined;
      const name =
        (u?.name && u.name.trim()) ||
        u?.email ||
        // Legacy free-text assignedTo values
        (uid && (uid.includes("@") || uid.length < 24) ? uid : null) ||
        "Unknown user";
      return {
        userId: uid,
        name,
        email: u?.email || null,
        count: g._count._all,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    totalLeads,
    assignedLeads,
    unassignedLeads,
    byMember,
  };
}

// silence unused helper warning if any
void nextSequence;
