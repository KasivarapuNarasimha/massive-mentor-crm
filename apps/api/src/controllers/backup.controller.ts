import { Response } from "express";
import fs from "node:fs";
import type { AuthenticatedRequest } from "@/middleware/auth";
import * as backup from "@/services/backup.service";
import { resolveTenantContext } from "@/services/business.service";
import { resolveActorRole } from "@/services/tenant-scope.service";

function clientMeta(req: AuthenticatedRequest) {
  return {
    ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
    userAgent: req.headers["user-agent"] || null,
  };
}

/** Super Admin: list all backups */
export async function platformListBackups(req: AuthenticatedRequest, res: Response) {
  try {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const businessId = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
    const rows = await backup.listBackups({ type, businessId, limit: 200 });
    const data = rows.map((r) => ({
      ...r,
      sizeBytes: r.sizeBytes?.toString?.() ?? String(r.sizeBytes ?? 0),
    }));
    res.json({ success: true, data: { backups: data } });
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformCreateBackup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const type = req.body?.type === "business" ? "business" : "full";
    const businessId = typeof req.body?.businessId === "string" ? req.body.businessId : null;
    if (type === "business" && !businessId) {
      return res.status(400).json({ success: false, error: "businessId required" });
    }
    const meta = clientMeta(req);
    const { id } = await backup.createBackup({
      type,
      businessId,
      trigger: "manual",
      actorUserId: req.user.id,
      notifyEmail: req.user.email,
      ...meta,
    });
    res.status(202).json({ success: true, data: { id, status: "running" } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformGetBackup(req: AuthenticatedRequest, res: Response) {
  try {
    const id = String(req.params.id);
    const rec = await backup.getBackup(id);
    if (!rec) return res.status(404).json({ success: false, error: "Not found" });
    res.json({
      success: true,
      data: {
        ...rec,
        sizeBytes: rec.sizeBytes?.toString?.() ?? "0",
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformVerifyBackup(req: AuthenticatedRequest, res: Response) {
  try {
    const id = String(req.params.id);
    const result = await backup.verifyBackup(id);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformDownloadBackup(req: AuthenticatedRequest, res: Response) {
  try {
    const id = String(req.params.id);
    const file = await backup.getBackupFilePath(id);
    if (!file) return res.status(404).json({ success: false, error: "File not found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    fs.createReadStream(file.abs).pipe(res);
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformDeleteBackup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await backup.deleteBackup(String(req.params.id), req.user.id);
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformRequestRestore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const scope = req.body?.scope === "business" ? "business" : "full";
    const result = await backup.requestRestore({
      backupId: String(req.params.id),
      actorUserId: req.user.id,
      scope,
      businessId: typeof req.body?.businessId === "string" ? req.body.businessId : null,
      confirmPhrase: typeof req.body?.confirmPhrase === "string" ? req.body.confirmPhrase : undefined,
    });
    res.json({
      success: true,
      data: {
        restoreId: result.restoreId,
        confirmationToken: result.confirmationToken,
        expiresAt: result.expiresAt,
        message:
          "Confirm restore within 15 minutes using POST /platform/restores/:restoreId/confirm with the confirmationToken.",
      },
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformConfirmRestore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const token = String(req.body?.confirmationToken || "");
    if (!token) return res.status(400).json({ success: false, error: "confirmationToken required" });
    await backup.confirmRestore({
      restoreId: String(req.params.restoreId),
      confirmationToken: token,
      actorUserId: req.user.id,
    });
    res.status(202).json({ success: true, data: { status: "running" } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformListRestores(_req: AuthenticatedRequest, res: Response) {
  try {
    const rows = await backup.listRestores(100);
    res.json({ success: true, data: { restores: rows } });
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformListSchedules(_req: AuthenticatedRequest, res: Response) {
  try {
    await backup.ensureDefaultSchedules();
    const schedules = await backup.listSchedules();
    res.json({ success: true, data: { schedules } });
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function platformUpsertSchedule(req: AuthenticatedRequest, res: Response) {
  try {
    const cadence = req.body?.cadence;
    if (!["daily", "weekly", "monthly"].includes(cadence)) {
      return res.status(400).json({ success: false, error: "cadence must be daily|weekly|monthly" });
    }
    const sch = await backup.upsertSchedule({
      cadence,
      enabled: req.body?.enabled,
      hourUtc: req.body?.hourUtc,
      dayOfWeek: req.body?.dayOfWeek,
      dayOfMonth: req.body?.dayOfMonth,
      backupType: req.body?.backupType,
      retentionDays: req.body?.retentionDays,
    });
    res.json({ success: true, data: { schedule: sch } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

// —— Business Admin (own tenant only) ——

function isBusinessAdminRole(role: string | undefined | null): boolean {
  const r = String(role || "").toLowerCase();
  return ["business_admin", "admin", "owner", "super_admin"].includes(r);
}

export async function tenantListBackups(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const tenant = await resolveTenantContext(req.user.id);
    const actorRole = await resolveActorRole(req.user.id).catch(() => req.user?.role);
    if (!isBusinessAdminRole(actorRole) && !isBusinessAdminRole(tenant.businessRole) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Business admin required" });
    }
    const rows = await backup.listBackups({ businessId: tenant.businessId, limit: 50 });
    res.json({
      success: true,
      data: {
        backups: rows.map((r) => ({
          ...r,
          sizeBytes: r.sizeBytes?.toString?.() ?? "0",
        })),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function tenantCreateBackup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const tenant = await resolveTenantContext(req.user.id);
    if (!isBusinessAdminRole(tenant.businessRole) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Business admin required" });
    }
    const meta = clientMeta(req);
    const { id } = await backup.createBackup({
      type: "business",
      businessId: tenant.businessId,
      trigger: "manual",
      actorUserId: req.user.id,
      notifyEmail: req.user.email,
      ...meta,
    });
    res.status(202).json({ success: true, data: { id, status: "running" } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function tenantRequestRestore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const tenant = await resolveTenantContext(req.user.id);
    if (!isBusinessAdminRole(tenant.businessRole) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, error: "Business admin required" });
    }
    const rec = await backup.getBackup(String(req.params.id));
    if (!rec || rec.businessId !== tenant.businessId) {
      return res.status(404).json({ success: false, error: "Backup not found for your business" });
    }
    const result = await backup.requestRestore({
      backupId: rec.id,
      actorUserId: req.user.id,
      scope: "business",
      businessId: tenant.businessId,
    });
    res.json({
      success: true,
      data: {
        restoreId: result.restoreId,
        confirmationToken: result.confirmationToken,
        expiresAt: result.expiresAt,
      },
    });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function tenantConfirmRestore(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const tenant = await resolveTenantContext(req.user.id);
    const restores = await backup.listRestores(20);
    const restore = restores.find((r) => r.id === String(req.params.restoreId));
    if (!restore || restore.businessId !== tenant.businessId) {
      return res.status(404).json({ success: false, error: "Restore not found for your business" });
    }
    await backup.confirmRestore({
      restoreId: restore.id,
      confirmationToken: String(req.body?.confirmationToken || ""),
      actorUserId: req.user.id,
    });
    res.status(202).json({ success: true, data: { status: "running" } });
  } catch (e) {
    res.status(400).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}

export async function tenantDownloadBackup(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const tenant = await resolveTenantContext(req.user.id);
    const rec = await backup.getBackup(String(req.params.id));
    if (!rec || rec.businessId !== tenant.businessId) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    const file = await backup.getBackupFilePath(rec.id);
    if (!file) return res.status(404).json({ success: false, error: "File not found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    fs.createReadStream(file.abs).pipe(res);
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed" });
  }
}
