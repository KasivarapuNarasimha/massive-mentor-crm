/**
 * Production Approval Workflow Engine.
 * Reuses: tenant businessId, roles (resolveActorRole), notifications, audit, email.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import { recordAudit } from "./audit.service.js";
import { notifyUser } from "./notification.service.js";
import { sendEmail } from "./email.service.js";
import { env } from "../config/env.js";
import { paginated, skipTake } from "./pagination.js";

export const APPROVAL_TYPES = [
  "discount",
  "proposal",
  "invoice",
  "expense",
  "leave",
  "purchase",
  "custom",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const APPROVER_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "finance",
  "sales_manager",
  "manager",
  "hr",
  "super_admin",
]);

type WorkflowRules = {
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  autoApproveBelow?: number;
  requireCommentOnReject?: boolean;
};

async function requireBusiness(userId: string) {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Business context required");
  return businessId;
}

function parseRules(raw: unknown): WorkflowRules {
  if (!raw || typeof raw !== "object") return {};
  return raw as WorkflowRules;
}

/** Ensure default workflows exist for a business (idempotent). */
export async function ensureDefaultWorkflows(businessId: string) {
  const defaults: Array<{
    type: ApprovalType;
    name: string;
    description: string;
    rules: WorkflowRules;
    steps: Array<{ level: number; name: string; approverRole: string }>;
  }> = [
    {
      type: "expense",
      name: "Expense Approval",
      description: "Expenses above threshold need manager then finance approval",
      rules: { minAmount: 5000, currency: "INR", autoApproveBelow: 5000 },
      steps: [
        { level: 1, name: "Manager", approverRole: "manager" },
        { level: 2, name: "Finance", approverRole: "finance" },
      ],
    },
    {
      type: "invoice",
      name: "Invoice Approval",
      description: "Large invoices require finance approval before send",
      rules: { minAmount: 50000, currency: "INR" },
      steps: [{ level: 1, name: "Finance / Admin", approverRole: "finance" }],
    },
    {
      type: "discount",
      name: "Discount Approval",
      description: "Discount / special pricing requests",
      rules: {},
      steps: [
        { level: 1, name: "Sales Manager", approverRole: "sales_manager" },
        { level: 2, name: "CEO", approverRole: "ceo" },
      ],
    },
    {
      type: "proposal",
      name: "Proposal Approval",
      description: "Customer proposals before send",
      rules: {},
      steps: [{ level: 1, name: "Manager", approverRole: "manager" }],
    },
    {
      type: "leave",
      name: "Leave Approval",
      description: "Time-off / leave requests",
      rules: {},
      steps: [{ level: 1, name: "HR / Manager", approverRole: "hr" }],
    },
    {
      type: "purchase",
      name: "Purchase Approval",
      description: "Purchase / procurement requests",
      rules: { minAmount: 10000, currency: "INR" },
      steps: [
        { level: 1, name: "Manager", approverRole: "manager" },
        { level: 2, name: "Finance", approverRole: "finance" },
      ],
    },
    {
      type: "custom",
      name: "General Approval",
      description: "Catch-all multi-level approval",
      rules: {},
      steps: [{ level: 1, name: "Admin", approverRole: "business_admin" }],
    },
  ];

  for (const d of defaults) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { businessId, type: d.type, name: d.name },
    });
    if (existing) continue;
    await prisma.approvalWorkflow.create({
      data: {
        businessId,
        type: d.type,
        name: d.name,
        description: d.description,
        enabled: true,
        rules: d.rules,
        steps: {
          create: d.steps.map((s) => ({
            level: s.level,
            name: s.name,
            approverRole: s.approverRole,
            mode: "any",
          })),
        },
      },
    });
  }
}

export async function listWorkflows(userId: string) {
  const businessId = await requireBusiness(userId);
  await ensureDefaultWorkflows(businessId);
  return prisma.approvalWorkflow.findMany({
    where: { businessId },
    include: { steps: { orderBy: { level: "asc" } }, _count: { select: { requests: true } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

export async function upsertWorkflow(
  userId: string,
  input: {
    id?: string;
    type: string;
    name: string;
    description?: string;
    enabled?: boolean;
    rules?: WorkflowRules;
    steps: Array<{
      level: number;
      name?: string;
      approverRole?: string | null;
      approverUserId?: string | null;
      mode?: string;
    }>;
  }
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  if (!APPROVER_ROLES.has(role) && role !== "business_admin") {
    throw new Error("Only admins/managers can configure approval workflows");
  }
  if (!APPROVAL_TYPES.includes(input.type as ApprovalType)) {
    throw new Error(`Invalid type. Use: ${APPROVAL_TYPES.join(", ")}`);
  }
  if (!input.steps?.length) throw new Error("At least one approval level is required");

  const data = {
    type: input.type,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    enabled: input.enabled ?? true,
    rules: (input.rules || {}) as object,
  };

  let workflowId = input.id;
  if (workflowId) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { id: workflowId, businessId },
    });
    if (!existing) throw new Error("Workflow not found");
    await prisma.approvalStepDef.deleteMany({ where: { workflowId } });
    await prisma.approvalWorkflow.update({ where: { id: workflowId }, data });
  } else {
    const created = await prisma.approvalWorkflow.create({
      data: { businessId, ...data },
    });
    workflowId = created.id;
  }

  await prisma.approvalStepDef.createMany({
    data: input.steps.map((s) => ({
      workflowId: workflowId!,
      level: s.level,
      name: s.name || `Level ${s.level}`,
      approverRole: s.approverRole || null,
      approverUserId: s.approverUserId || null,
      mode: s.mode === "all" ? "all" : "any",
    })),
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "approval_workflow_upsert",
    entityType: "ApprovalWorkflow",
    entityId: workflowId,
    metadata: { type: input.type, name: input.name },
  });

  return prisma.approvalWorkflow.findUnique({
    where: { id: workflowId },
    include: { steps: { orderBy: { level: "asc" } } },
  });
}

async function findMatchingWorkflow(
  businessId: string,
  type: string,
  amount?: number | null
) {
  await ensureDefaultWorkflows(businessId);
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { businessId, type, enabled: true },
    include: { steps: { orderBy: { level: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  for (const w of workflows) {
    const rules = parseRules(w.rules);
    if (amount != null && rules.minAmount != null && amount < rules.minAmount) {
      continue;
    }
    if (amount != null && rules.maxAmount != null && amount > rules.maxAmount) {
      continue;
    }
    if (w.steps.length === 0) continue;
    return w;
  }
  // Fallback: first enabled of type with steps
  return (
    workflows.find((w) => w.steps.length > 0) ||
    (await prisma.approvalWorkflow.findFirst({
      where: { businessId, type: "custom", enabled: true },
      include: { steps: { orderBy: { level: "asc" } } },
    }))
  );
}

async function notifyApproversForLevel(
  businessId: string,
  requestId: string,
  level: number,
  title: string,
  workflowId: string | null
) {
  let step = null as {
    approverRole: string | null;
    approverUserId: string | null;
  } | null;

  if (workflowId) {
    step = await prisma.approvalStepDef.findFirst({
      where: { workflowId, level },
    });
  }

  const userIds = new Set<string>();
  if (step?.approverUserId) {
    userIds.add(step.approverUserId);
  } else if (step?.approverRole) {
    const role = step.approverRole;
    // Match membership role OR user.role
    const members = await prisma.businessMember.findMany({
      where: {
        businessId,
        OR: [{ role }, { role: role === "manager" ? "sales_manager" : role }],
      },
      select: { userId: true },
    });
    members.forEach((m) => userIds.add(m.userId));
    // Also users with legacy user.role
    const users = await prisma.user.findMany({
      where: {
        role: { in: [role, role === "manager" ? "sales_manager" : role, role === "business_admin" ? "admin" : role] },
        businessMembers: { some: { businessId } },
      },
      select: { id: true },
    });
    users.forEach((u) => userIds.add(u.id));
    // Always include business owner as safety net
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    if (biz?.ownerUserId) userIds.add(biz.ownerUserId);
  } else {
    const biz = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    if (biz?.ownerUserId) userIds.add(biz.ownerUserId);
  }

  for (const uid of userIds) {
    await notifyUser(uid, {
      type: "system",
      title: "Approval required",
      message: `${title} needs your approval (level ${level})`,
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    const u = await prisma.user.findUnique({
      where: { id: uid },
      select: { email: true },
    });
    if (u?.email) {
      // Non-blocking: do not stall approve/submit on SMTP RTT
      void sendEmail({
        to: u.email,
        subject: `[Massive Mentor] Approval required: ${title}`,
        text: `A request needs your approval (level ${level}):\n\n${title}\n\nOpen the Approvals dashboard in Massive Mentor CRM to approve or reject.`,
        sensitive: false,
      }).catch(() => {
        /* non-fatal if SMTP off */
      });
    }
  }
}

export async function submitRequest(
  userId: string,
  input: {
    type: string;
    title: string;
    description?: string;
    amount?: number | null;
    currency?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
    workflowId?: string | null;
  }
) {
  const businessId = await requireBusiness(userId);
  if (!APPROVAL_TYPES.includes(input.type as ApprovalType) && input.type !== "custom") {
    // allow custom freeform if listed
  }
  const type = (APPROVAL_TYPES.includes(input.type as ApprovalType)
    ? input.type
    : "custom") as string;

  let workflow =
    input.workflowId
      ? await prisma.approvalWorkflow.findFirst({
          where: { id: input.workflowId, businessId, enabled: true },
          include: { steps: { orderBy: { level: "asc" } } },
        })
      : await findMatchingWorkflow(businessId, type, input.amount);

  const rules = parseRules(workflow?.rules);
  // Auto-approve below threshold
  if (
    input.amount != null &&
    rules.autoApproveBelow != null &&
    input.amount < rules.autoApproveBelow
  ) {
    const req = await prisma.approvalRequest.create({
      data: {
        businessId,
        workflowId: workflow?.id || null,
        type,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        amount: input.amount ?? null,
        currency: input.currency || "INR",
        status: "approved",
        currentLevel: 0,
        maxLevel: 0,
        requestedById: userId,
        decidedAt: new Date(),
        metadata: { ...(input.metadata || {}), autoApproved: true },
        actions: {
          create: {
            actorUserId: userId,
            level: 0,
            action: "approve",
            comment: "Auto-approved (below threshold)",
          },
        },
      },
      include: { actions: true, requestedBy: { select: { id: true, email: true, name: true } } },
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "approval_auto_approved",
      entityType: "ApprovalRequest",
      entityId: req.id,
    });
    return req;
  }

  const maxLevel = workflow?.steps?.length || 1;
  const req = await prisma.approvalRequest.create({
    data: {
      businessId,
      workflowId: workflow?.id || null,
      type,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      amount: input.amount ?? null,
      currency: input.currency || "INR",
      status: "pending",
      currentLevel: 1,
      maxLevel,
      requestedById: userId,
      metadata: (input.metadata || undefined) as object | undefined,
      actions: {
        create: {
          actorUserId: userId,
          level: 0,
          action: "submit",
          comment: "Submitted for approval",
        },
      },
    },
    include: {
      actions: true,
      requestedBy: { select: { id: true, email: true, name: true } },
      workflow: { include: { steps: true } },
    },
  });

  await notifyApproversForLevel(
    businessId,
    req.id,
    1,
    req.title,
    workflow?.id || null
  );

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "approval_submitted",
    entityType: "ApprovalRequest",
    entityId: req.id,
    metadata: { type, amount: input.amount },
  });

  return req;
}

export async function actOnRequest(
  userId: string,
  requestId: string,
  action: "approve" | "reject" | "cancel",
  comment?: string
) {
  const businessId = await requireBusiness(userId);
  const role = await resolveActorRole(userId);
  const req = await prisma.approvalRequest.findFirst({
    where: { id: requestId, businessId },
    include: {
      workflow: { include: { steps: { orderBy: { level: "asc" } } } },
      requestedBy: { select: { id: true, email: true, name: true } },
    },
  });
  if (!req) throw new Error("Approval request not found");

  if (action === "cancel") {
    if (req.requestedById !== userId && !APPROVER_ROLES.has(role)) {
      throw new Error("Only the requester or an admin can cancel");
    }
    if (req.status !== "pending") throw new Error("Only pending requests can be cancelled");
    const updated = await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "cancelled",
        decidedAt: new Date(),
        actions: {
          create: {
            actorUserId: userId,
            level: req.currentLevel,
            action: "cancel",
            comment: comment || null,
          },
        },
      },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    });
    await notifyUser(req.requestedById, {
      type: "system",
      title: "Approval cancelled",
      message: `"${req.title}" was cancelled`,
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "approval_cancelled",
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    return updated;
  }

  if (req.status !== "pending") throw new Error("Request is not pending");

  // Authorize approver for current level
  const step = req.workflow?.steps?.find((s) => s.level === req.currentLevel);
  if (step?.approverUserId && step.approverUserId !== userId && role !== "business_admin" && role !== "ceo" && role !== "owner") {
    throw new Error("You are not the assigned approver for this level");
  }
  // Role-based: allow matching role or higher admin roles
  if (step?.approverRole) {
    const ok =
      role === step.approverRole ||
      role === "business_admin" ||
      role === "admin" ||
      role === "ceo" ||
      role === "owner" ||
      role === "super_admin" ||
      (step.approverRole === "manager" && (role === "sales_manager" || role === "manager")) ||
      (step.approverRole === "finance" && role === "finance");
    if (!ok && step.approverUserId !== userId) {
      // Soft check: owner always can
      const biz = await prisma.business.findUnique({ where: { id: businessId } });
      if (biz?.ownerUserId !== userId) {
        throw new Error(`This level requires role: ${step.approverRole}`);
      }
    }
  }

  if (action === "reject") {
    const rules = parseRules(req.workflow?.rules);
    if (rules.requireCommentOnReject && !comment?.trim()) {
      throw new Error("A comment is required when rejecting");
    }
    const updated = await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: "rejected",
        decidedAt: new Date(),
        actions: {
          create: {
            actorUserId: userId,
            level: req.currentLevel,
            action: "reject",
            comment: comment || null,
          },
        },
      },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    });
    await notifyUser(req.requestedById, {
      type: "system",
      title: "Approval rejected",
      message: `"${req.title}" was rejected${comment ? `: ${comment}` : ""}`,
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "approval_rejected",
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    return updated;
  }

  // approve
  await prisma.approvalAction.create({
    data: {
      requestId,
      actorUserId: userId,
      level: req.currentLevel,
      action: "approve",
      comment: comment || null,
    },
  });

  if (req.currentLevel >= req.maxLevel) {
    const updated = await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: "approved", decidedAt: new Date() },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    });
    await notifyUser(req.requestedById, {
      type: "system",
      title: "Approval granted",
      message: `"${req.title}" was fully approved`,
      entityType: "ApprovalRequest",
      entityId: requestId,
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "approval_approved",
      entityType: "ApprovalRequest",
      entityId: requestId,
      metadata: { final: true },
    });
    // Optional: mark linked invoice/expense metadata
    if (req.entityType === "invoice" && req.entityId) {
      await prisma.invoice
        .update({
          where: { id: req.entityId },
          data: { notes: `Approved via workflow ${requestId}` },
        })
        .catch(() => null);
    }
    return updated;
  }

  const nextLevel = req.currentLevel + 1;
  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { currentLevel: nextLevel },
    include: { actions: { orderBy: { createdAt: "asc" } } },
  });
  await notifyApproversForLevel(
    businessId,
    requestId,
    nextLevel,
    req.title,
    req.workflowId
  );
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "approval_level_advanced",
    entityType: "ApprovalRequest",
    entityId: requestId,
    metadata: { toLevel: nextLevel },
  });
  return updated;
}

export async function listRequests(
  userId: string,
  opts?: {
    status?: string;
    type?: string;
    mine?: boolean;
    pendingForMe?: boolean;
    page?: number;
    pageSize?: number;
  }
) {
  const businessId = await requireBusiness(userId);
  await ensureDefaultWorkflows(businessId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(200, opts.pageSize) : 25;
  const where: Record<string, unknown> = { businessId };
  if (opts?.status) where.status = opts.status;
  if (opts?.type) where.type = opts.type;
  if (opts?.mine) where.requestedById = userId;

  const { skip, take } = skipTake(page, pageSize);
  const [total, items] = await Promise.all([
    prisma.approvalRequest.count({ where: where as never }),
    prisma.approvalRequest.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        workflow: { select: { id: true, name: true, type: true } },
        actions: {
          orderBy: { createdAt: "asc" },
          include: { actor: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ]);

  // Optional filter: pending items current user can act on (role match)
  let filtered = items;
  if (opts?.pendingForMe) {
    const role = await resolveActorRole(userId);
    filtered = items.filter((r) => {
      if (r.status !== "pending") return false;
      const step = r.workflow
        ? null
        : null;
      void step;
      // Include all pending for approver roles; finer filter client-side with steps
      return APPROVER_ROLES.has(role) || r.requestedById === userId;
    });
  }

  return paginated(filtered, opts?.pendingForMe ? filtered.length : total, page, pageSize);
}

export async function getRequest(userId: string, id: string) {
  const businessId = await requireBusiness(userId);
  const req = await prisma.approvalRequest.findFirst({
    where: { id, businessId },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      workflow: { include: { steps: { orderBy: { level: "asc" } } } },
      actions: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!req) throw new Error("Not found");
  return req;
}

export async function getApprovalStats(userId: string) {
  const businessId = await requireBusiness(userId);
  const [pending, approved, rejected, cancelled, byType] = await Promise.all([
    prisma.approvalRequest.count({ where: { businessId, status: "pending" } }),
    prisma.approvalRequest.count({ where: { businessId, status: "approved" } }),
    prisma.approvalRequest.count({ where: { businessId, status: "rejected" } }),
    prisma.approvalRequest.count({ where: { businessId, status: "cancelled" } }),
    prisma.approvalRequest.groupBy({
      by: ["type"],
      where: { businessId },
      _count: true,
    }),
  ]);
  return {
    pending,
    approved,
    rejected,
    cancelled,
    total: pending + approved + rejected + cancelled,
    byType: byType.map((t) => ({ type: t.type, count: t._count })),
  };
}

/** Helper for finance modules — submit expense for approval when over threshold */
export async function maybeSubmitExpenseApproval(
  userId: string,
  expense: { id: string; title: string; total: number; currency?: string }
) {
  try {
    const businessId = await requireBusiness(userId);
    const wf = await findMatchingWorkflow(businessId, "expense", expense.total);
    const rules = parseRules(wf?.rules);
    if (rules.minAmount != null && expense.total < rules.minAmount) return null;
    if (!wf) return null;
    return submitRequest(userId, {
      type: "expense",
      title: `Expense: ${expense.title}`,
      amount: expense.total,
      currency: expense.currency || "INR",
      entityType: "expense",
      entityId: expense.id,
      workflowId: wf.id,
    });
  } catch {
    return null;
  }
}

export async function maybeSubmitInvoiceApproval(
  userId: string,
  invoice: { id: string; number: string; total: number; currency?: string }
) {
  try {
    const businessId = await requireBusiness(userId);
    const wf = await findMatchingWorkflow(businessId, "invoice", invoice.total);
    if (!wf) return null;
    const rules = parseRules(wf.rules);
    if (rules.minAmount != null && invoice.total < rules.minAmount) return null;
    return submitRequest(userId, {
      type: "invoice",
      title: `Invoice ${invoice.number}`,
      amount: invoice.total,
      currency: invoice.currency || "INR",
      entityType: "invoice",
      entityId: invoice.id,
      workflowId: wf.id,
    });
  } catch {
    return null;
  }
}
