import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "login"
  | "logout"
  | "register"
  | "create"
  | "update"
  | "delete"
  | "import"
  | "export"
  | "ai"
  | "config_change"
  | "ensure_business"
  | "template_install";

export type AuditInput = {
  businessId?: string | null;
  actorUserId?: string | null;
  action: AuditAction | string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Append-only audit logger. Never throws to callers (best-effort).
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        businessId: input.businessId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? undefined) as object | undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err instanceof Error ? err.message : err);
  }
}
