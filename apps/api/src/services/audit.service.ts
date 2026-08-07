import { prisma } from "../lib/prisma.js";

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
  | "template_install"
  | "lead_create"
  | "lead_update"
  | "lead_delete"
  | "deal_change"
  | "role_change"
  | "permission_change"
  | "media_upload"
  | "media_delete"
  | "whatsapp_broadcast"
  | "assignment_change";

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
 * Critical actions expected: login/logout, lead/deal CRUD, role/permission,
 * media upload/delete, WhatsApp broadcast, assignment changes.
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
    // Structured ops signal (no PII beyond ids)
    const { log } = await import("../lib/logger.js");
    log.info("audit.write", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      businessId: input.businessId,
    });
  } catch (err) {
    const { logError } = await import("../lib/logger.js");
    logError(err, { module: "audit", function: "recordAudit" });
  }
}
