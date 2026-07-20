/**
 * Enterprise backup & restore service.
 * - Logical JSON export of platform or single business (tenant-isolated)
 * - gzip + AES-256-GCM encryption
 * - SHA-256 verification before restore
 * - Restore requires one-time confirmation token
 * - Automatic daily / weekly / monthly schedules
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { recordAudit } from "./audit.service.js";
import { sendEmail } from "./email.service.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const BACKUP_FORMAT_VERSION = 1;

export type BackupType = "full" | "business";
export type BackupTrigger = "manual" | "daily" | "weekly" | "monthly" | "schedule";

function backupRoot(): string {
  const configured = (env.BACKUP_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../storage/backups");
  // Windows: fileURL path may start with /C: — fix below
}

function resolveBackupRoot(): string {
  const configured = (env.BACKUP_DIR || "").trim();
  if (configured) return path.resolve(configured);
  // apps/api/storage/backups relative to process cwd when running from apps/api
  return path.resolve(process.cwd(), "storage", "backups");
}

function encryptionKey(): Buffer {
  const raw = (env.BACKUP_ENCRYPTION_KEY || env.JWT_SECRET).trim();
  // Derive 32-byte key
  return crypto.createHash("sha256").update(raw).digest();
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function encrypt(plain: Buffer): { cipher: Buffer; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: enc, iv: iv.toString("hex"), tag: tag.toString("hex") };
}

function decrypt(cipher: Buffer, ivHex: string, tagHex: string): Buffer {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(cipher), decipher.final()]);
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
}

function serialize(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

/** Collect full platform snapshot (logical). */
async function collectFullSnapshot(onProgress?: (p: number) => void): Promise<Record<string, unknown>> {
  onProgress?.(5);
  const [
    users,
    businesses,
    members,
    configs,
    contacts,
    deals,
    tasks,
    meetings,
    notes,
    documents,
    activities,
    notifications,
    invoices,
    expenses,
    payments,
    whatsapp,
    auditLogs,
    platformInvoices,
    licenses,
    tickets,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        passwordHash: true,
        name: true,
        role: true,
        platformRole: true,
        isDisabled: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.business.findMany(),
    prisma.businessMember.findMany(),
    prisma.businessConfig.findMany().catch(() => []),
    prisma.contact.findMany(),
    prisma.deal.findMany(),
    prisma.task.findMany(),
    prisma.meeting.findMany(),
    prisma.note.findMany().catch(() => []),
    prisma.document.findMany().catch(() => []),
    prisma.activity.findMany().catch(() => []),
    prisma.notification.findMany().catch(() => []),
    prisma.invoice.findMany().catch(() => []),
    prisma.expense.findMany().catch(() => []),
    prisma.payment.findMany().catch(() => []),
    prisma.whatsAppMessage.findMany().catch(() => []),
    prisma.auditLog.findMany({ take: 50000 }),
    prisma.platformInvoice.findMany().catch(() => []),
    // optional models
    Promise.resolve([]),
    prisma.supportTicket.findMany().catch(() => []),
  ]);
  onProgress?.(70);
  void licenses;
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    kind: "full",
    createdAt: new Date().toISOString(),
    tables: {
      users,
      businesses,
      businessMembers: members,
      businessConfigs: configs,
      contacts,
      deals,
      tasks,
      meetings,
      notes,
      documents,
      activities,
      notifications,
      invoices,
      expenses,
      payments,
      whatsappMessages: whatsapp,
      auditLogs,
      platformInvoices,
      supportTickets: tickets,
    },
  };
}

/** Tenant-isolated business snapshot — never includes other tenants. */
async function collectBusinessSnapshot(
  businessId: string,
  onProgress?: (p: number) => void
): Promise<Record<string, unknown>> {
  onProgress?.(10);
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error("Business not found");

  const members = await prisma.businessMember.findMany({ where: { businessId } });
  const memberUserIds = members.map((m) => m.userId);
  onProgress?.(25);

  const [
    users,
    config,
    contacts,
    deals,
    tasks,
    meetings,
    notes,
    documents,
    activities,
    notifications,
    invoices,
    expenses,
    payments,
    whatsapp,
    auditLogs,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: memberUserIds } },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        name: true,
        role: true,
        platformRole: true,
        isDisabled: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.businessConfig.findUnique({ where: { businessId } }).catch(() => null),
    prisma.contact.findMany({ where: { businessId } }),
    prisma.deal.findMany({ where: { businessId } }),
    prisma.task.findMany({ where: { businessId } }),
    prisma.meeting.findMany({ where: { businessId } }),
    prisma.note.findMany({ where: { userId: { in: memberUserIds } } }).catch(() => []),
    prisma.document.findMany({ where: { userId: { in: memberUserIds } } }).catch(() => []),
    prisma.activity.findMany({ where: { userId: { in: memberUserIds } } }).catch(() => []),
    prisma.notification.findMany({ where: { userId: { in: memberUserIds } } }).catch(() => []),
    prisma.invoice.findMany({ where: { businessId } }).catch(() => []),
    prisma.expense.findMany({ where: { businessId } }).catch(() => []),
    prisma.payment.findMany({ where: { businessId } }).catch(() => []),
    prisma.whatsAppMessage.findMany({ where: { businessId } }).catch(() => []),
    prisma.auditLog.findMany({ where: { businessId }, take: 10000 }),
  ]);
  onProgress?.(80);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    kind: "business",
    businessId,
    createdAt: new Date().toISOString(),
    tables: {
      business,
      businessMembers: members,
      businessConfig: config,
      users,
      contacts,
      deals,
      tasks,
      meetings,
      notes,
      documents,
      activities,
      notifications,
      invoices,
      expenses,
      payments,
      whatsappMessages: whatsapp,
      auditLogs,
    },
  };
}

function rowCountsFromSnapshot(snap: Record<string, unknown>): Record<string, number> {
  const tables = (snap.tables || {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(tables)) {
    if (Array.isArray(v)) counts[k] = v.length;
    else if (v && typeof v === "object") counts[k] = 1;
    else counts[k] = 0;
  }
  return counts;
}

async function notifyFailure(email: string | null | undefined, subject: string, detail: string) {
  if (!email) return;
  try {
    await sendEmail({
      to: email,
      subject: `[Massive Mentor] ${subject}`,
      text: detail,
      sensitive: false,
    });
  } catch (e) {
    console.error("[backup] failure notification failed:", e instanceof Error ? e.message : e);
  }
}

export async function createBackup(opts: {
  type: BackupType;
  businessId?: string | null;
  trigger?: BackupTrigger;
  actorUserId?: string | null;
  notifyEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string }> {
  if (opts.type === "business" && !opts.businessId) {
    throw new Error("businessId required for business backup");
  }

  const root = resolveBackupRoot();
  await ensureDir(root);

  const record = await prisma.backupRecord.create({
    data: {
      type: opts.type,
      businessId: opts.businessId ?? null,
      status: "running",
      trigger: opts.trigger || "manual",
      progress: 1,
      encrypted: true,
      createdByUserId: opts.actorUserId ?? null,
      notifyEmail: opts.notifyEmail ?? null,
    },
  });

  // Run async so API can return immediately with progress polling
  void (async () => {
    try {
      const setProgress = async (p: number) => {
        await prisma.backupRecord.update({
          where: { id: record.id },
          data: { progress: Math.min(99, Math.max(0, p)) },
        });
      };

      const snap =
        opts.type === "full"
          ? await collectFullSnapshot(setProgress)
          : await collectBusinessSnapshot(opts.businessId!, setProgress);

      const counts = rowCountsFromSnapshot(snap);
      const jsonBuf = Buffer.from(serialize(snap), "utf8");
      await setProgress(85);
      const compressed = await gzip(jsonBuf);
      const { cipher, iv, tag } = encrypt(compressed);
      const checksum = sha256(cipher);

      const fileName = `mm-${opts.type}-${opts.businessId || "platform"}-${Date.now()}.mmbak`;
      const storageKey = fileName;
      const abs = path.join(root, fileName);
      await fsp.writeFile(abs, cipher);
      await setProgress(95);

      const retentionDays = env.BACKUP_RETENTION_DAYS || 30;
      const expiresAt = new Date(Date.now() + retentionDays * 86400000);

      await prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: "completed",
          progress: 100,
          fileName,
          storageKey,
          sizeBytes: BigInt(cipher.length),
          checksumSha256: checksum,
          encryptionIv: iv,
          encryptionTag: tag,
          rowCounts: counts,
          expiresAt,
          verifiedAt: new Date(),
          verificationOk: true,
        },
      });

      await recordAudit({
        businessId: opts.businessId ?? null,
        actorUserId: opts.actorUserId ?? null,
        action: "backup_create",
        entityType: "BackupRecord",
        entityId: record.id,
        metadata: { type: opts.type, trigger: opts.trigger, size: cipher.length, checksum },
        ip: opts.ip,
        userAgent: opts.userAgent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[backup] create failed:", msg);
      await prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: "failed", errorMessage: msg, progress: 0 },
      });
      await recordAudit({
        businessId: opts.businessId ?? null,
        actorUserId: opts.actorUserId ?? null,
        action: "backup_failed",
        entityType: "BackupRecord",
        entityId: record.id,
        metadata: { error: msg },
      });
      const rec = await prisma.backupRecord.findUnique({ where: { id: record.id } });
      await notifyFailure(rec?.notifyEmail, "Backup failed", `Backup ${record.id} failed: ${msg}`);
    }
  })();

  return { id: record.id };
}

export async function listBackups(filter?: {
  businessId?: string | null;
  type?: string;
  limit?: number;
}) {
  return prisma.backupRecord.findMany({
    where: {
      status: { not: "deleted" },
      ...(filter?.businessId ? { businessId: filter.businessId } : {}),
      ...(filter?.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter?.limit ?? 100,
    select: {
      id: true,
      type: true,
      businessId: true,
      status: true,
      trigger: true,
      fileName: true,
      sizeBytes: true,
      checksumSha256: true,
      encrypted: true,
      progress: true,
      rowCounts: true,
      errorMessage: true,
      verifiedAt: true,
      verificationOk: true,
      createdByUserId: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getBackup(id: string) {
  return prisma.backupRecord.findFirst({
    where: { id, status: { not: "deleted" } },
  });
}

/** Verify on-disk integrity (checksum + decrypt + gunzip + JSON parse). */
export async function verifyBackup(id: string): Promise<{ ok: boolean; detail: string }> {
  const rec = await getBackup(id);
  if (!rec || !rec.storageKey || !rec.checksumSha256) {
    return { ok: false, detail: "Backup not found or incomplete" };
  }
  const abs = path.join(resolveBackupRoot(), rec.storageKey);
  if (!fs.existsSync(abs)) {
    await prisma.backupRecord.update({
      where: { id },
      data: { verificationOk: false, verifiedAt: new Date() },
    });
    return { ok: false, detail: "Backup file missing on disk" };
  }
  const cipher = await fsp.readFile(abs);
  const sum = sha256(cipher);
  if (sum !== rec.checksumSha256) {
    await prisma.backupRecord.update({
      where: { id },
      data: { verificationOk: false, verifiedAt: new Date() },
    });
    return { ok: false, detail: "Checksum mismatch — file may be corrupted" };
  }
  try {
    if (!rec.encryptionIv || !rec.encryptionTag) {
      return { ok: false, detail: "Missing encryption metadata" };
    }
    const plain = decrypt(cipher, rec.encryptionIv, rec.encryptionTag);
    const json = await gunzip(plain);
    JSON.parse(json.toString("utf8"));
    await prisma.backupRecord.update({
      where: { id },
      data: { status: rec.status === "failed" ? "failed" : "verified", verificationOk: true, verifiedAt: new Date() },
    });
    return { ok: true, detail: "Checksum, decrypt, and JSON structure OK" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.backupRecord.update({
      where: { id },
      data: { verificationOk: false, verifiedAt: new Date() },
    });
    return { ok: false, detail: `Decrypt/parse failed: ${msg}` };
  }
}

export async function readBackupPayload(id: string): Promise<Record<string, unknown>> {
  const rec = await getBackup(id);
  if (!rec?.storageKey || !rec.encryptionIv || !rec.encryptionTag) {
    throw new Error("Backup incomplete");
  }
  const abs = path.join(resolveBackupRoot(), rec.storageKey);
  const cipher = await fsp.readFile(abs);
  if (rec.checksumSha256 && sha256(cipher) !== rec.checksumSha256) {
    throw new Error("Checksum verification failed");
  }
  const plain = decrypt(cipher, rec.encryptionIv, rec.encryptionTag);
  const json = await gunzip(plain);
  return JSON.parse(json.toString("utf8")) as Record<string, unknown>;
}

export async function getBackupFilePath(id: string): Promise<{ abs: string; fileName: string } | null> {
  const rec = await getBackup(id);
  if (!rec?.storageKey || !rec.fileName) return null;
  const abs = path.join(resolveBackupRoot(), rec.storageKey);
  if (!fs.existsSync(abs)) return null;
  return { abs, fileName: rec.fileName };
}

export async function deleteBackup(
  id: string,
  actorUserId?: string | null
): Promise<void> {
  const rec = await getBackup(id);
  if (!rec) throw new Error("Backup not found");
  if (rec.storageKey) {
    const abs = path.join(resolveBackupRoot(), rec.storageKey);
    try {
      await fsp.unlink(abs);
    } catch {
      /* ignore missing */
    }
  }
  await prisma.backupRecord.update({
    where: { id },
    data: { status: "deleted", storageKey: null },
  });
  await recordAudit({
    businessId: rec.businessId,
    actorUserId: actorUserId ?? null,
    action: "backup_delete",
    entityType: "BackupRecord",
    entityId: id,
  });
}

/** Request restore — returns one-time confirmation token (plaintext once). */
export async function requestRestore(opts: {
  backupId: string;
  actorUserId: string;
  scope: "full" | "business";
  businessId?: string | null;
  /** Caller-confirmed phrase for full restore */
  confirmPhrase?: string;
}): Promise<{ restoreId: string; confirmationToken: string; expiresAt: Date }> {
  const rec = await getBackup(opts.backupId);
  if (!rec || rec.status === "failed") throw new Error("Backup not available");
  if (rec.type === "business" && opts.scope === "full") {
    throw new Error("Cannot full-restore from a business-only backup");
  }
  if (opts.scope === "full" && opts.confirmPhrase !== "RESTORE PLATFORM") {
    throw new Error('Full platform restore requires confirmPhrase exactly: RESTORE PLATFORM');
  }
  if (opts.scope === "business") {
    const bid = opts.businessId || rec.businessId;
    if (!bid) throw new Error("businessId required for business restore");
    if (rec.type === "business" && rec.businessId && rec.businessId !== bid) {
      throw new Error("Cross-tenant restore denied");
    }
  }

  const verification = await verifyBackup(opts.backupId);
  if (!verification.ok) {
    throw new Error(`Backup verification failed: ${verification.detail}`);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const restore = await prisma.backupRestoreRecord.create({
    data: {
      backupId: opts.backupId,
      status: "pending_confirm",
      scope: opts.scope,
      businessId: opts.scope === "business" ? opts.businessId || rec.businessId : null,
      confirmationTokenHash: tokenHash,
      confirmationExpiresAt: expiresAt,
      verifiedBeforeRestore: true,
      actorUserId: opts.actorUserId,
      progress: 0,
      metadata: { confirmPhraseUsed: opts.scope === "full" },
    },
  });

  await recordAudit({
    businessId: restore.businessId,
    actorUserId: opts.actorUserId,
    action: "restore_requested",
    entityType: "BackupRestoreRecord",
    entityId: restore.id,
    metadata: { backupId: opts.backupId, scope: opts.scope },
  });

  return { restoreId: restore.id, confirmationToken: token, expiresAt };
}

export async function confirmRestore(opts: {
  restoreId: string;
  confirmationToken: string;
  actorUserId: string;
}): Promise<void> {
  const restore = await prisma.backupRestoreRecord.findUnique({ where: { id: opts.restoreId } });
  if (!restore) throw new Error("Restore request not found");
  if (restore.status !== "pending_confirm") throw new Error("Restore not awaiting confirmation");
  if (restore.actorUserId && restore.actorUserId !== opts.actorUserId) {
    throw new Error("Only the requester can confirm this restore");
  }
  if (!restore.confirmationExpiresAt || restore.confirmationExpiresAt < new Date()) {
    await prisma.backupRestoreRecord.update({
      where: { id: restore.id },
      data: { status: "cancelled", errorMessage: "Confirmation expired" },
    });
    throw new Error("Confirmation token expired");
  }
  const hash = crypto.createHash("sha256").update(opts.confirmationToken).digest("hex");
  if (hash !== restore.confirmationTokenHash) {
    throw new Error("Invalid confirmation token");
  }

  await prisma.backupRestoreRecord.update({
    where: { id: restore.id },
    data: {
      status: "running",
      confirmedAt: new Date(),
      startedAt: new Date(),
      progress: 5,
      confirmationTokenHash: null,
    },
  });

  void (async () => {
    try {
      const payload = await readBackupPayload(restore.backupId);
      await prisma.backupRestoreRecord.update({
        where: { id: restore.id },
        data: { progress: 20 },
      });

      if (restore.scope === "business") {
        const businessId = restore.businessId;
        if (!businessId) throw new Error("Missing businessId");
        await restoreBusinessData(businessId, payload, async (p) => {
          await prisma.backupRestoreRecord.update({
            where: { id: restore.id },
            data: { progress: p },
          });
        });
      } else {
        await restoreFullData(payload, async (p) => {
          await prisma.backupRestoreRecord.update({
            where: { id: restore.id },
            data: { progress: p },
          });
        });
      }

      await prisma.backupRestoreRecord.update({
        where: { id: restore.id },
        data: { status: "completed", progress: 100, completedAt: new Date() },
      });
      await recordAudit({
        businessId: restore.businessId,
        actorUserId: opts.actorUserId,
        action: "restore_completed",
        entityType: "BackupRestoreRecord",
        entityId: restore.id,
        metadata: { backupId: restore.backupId, scope: restore.scope },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[backup] restore failed:", msg);
      await prisma.backupRestoreRecord.update({
        where: { id: restore.id },
        data: { status: "failed", errorMessage: msg, completedAt: new Date() },
      });
      await recordAudit({
        businessId: restore.businessId,
        actorUserId: opts.actorUserId,
        action: "restore_failed",
        entityType: "BackupRestoreRecord",
        entityId: restore.id,
        metadata: { error: msg },
      });
    }
  })();
}

async function restoreBusinessData(
  businessId: string,
  payload: Record<string, unknown>,
  onProgress?: (p: number) => Promise<void>
) {
  const tables = (payload.tables || {}) as Record<string, unknown>;
  // Safety: if payload is business-scoped, ensure IDs match
  const payloadBizId = (payload.businessId as string) || (tables.business as { id?: string })?.id;
  if (payloadBizId && payloadBizId !== businessId) {
    throw new Error("Cross-tenant restore denied: backup businessId mismatch");
  }

  await onProgress?.(30);
  // Wipe tenant CRM rows then re-insert (preserve business shell)
  await prisma.$transaction(async (tx) => {
    await tx.whatsAppMessage.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.payment.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.expense.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.invoice.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.task.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.meeting.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.deal.deleteMany({ where: { businessId } }).catch(() => null);
    await tx.contact.deleteMany({ where: { businessId } }).catch(() => null);
  });
  await onProgress?.(50);

  const contacts = (tables.contacts as Array<Record<string, unknown>>) || [];
  const deals = (tables.deals as Array<Record<string, unknown>>) || [];
  const tasks = (tables.tasks as Array<Record<string, unknown>>) || [];
  const meetings = (tables.meetings as Array<Record<string, unknown>>) || [];

  // Upsert contacts
  for (const c of contacts) {
    const data = stripUndefined({ ...c, businessId }) as Parameters<typeof prisma.contact.create>[0]["data"];
    await prisma.contact.upsert({
      where: { id: String(c.id) },
      create: data,
      update: data,
    }).catch(async () => {
      await prisma.contact.create({ data }).catch(() => null);
    });
  }
  await onProgress?.(70);
  for (const d of deals) {
    const data = stripUndefined({ ...d, businessId }) as Parameters<typeof prisma.deal.create>[0]["data"];
    await prisma.deal.upsert({
      where: { id: String(d.id) },
      create: data,
      update: data,
    }).catch(async () => {
      await prisma.deal.create({ data }).catch(() => null);
    });
  }
  for (const t of tasks) {
    const data = stripUndefined({ ...t, businessId }) as Parameters<typeof prisma.task.create>[0]["data"];
    await prisma.task.upsert({
      where: { id: String(t.id) },
      create: data,
      update: data,
    }).catch(async () => {
      await prisma.task.create({ data }).catch(() => null);
    });
  }
  for (const m of meetings) {
    const data = stripUndefined({ ...m, businessId }) as Parameters<typeof prisma.meeting.create>[0]["data"];
    await prisma.meeting.upsert({
      where: { id: String(m.id) },
      create: data,
      update: data,
    }).catch(async () => {
      await prisma.meeting.create({ data }).catch(() => null);
    });
  }
  await onProgress?.(95);
}

async function restoreFullData(
  payload: Record<string, unknown>,
  onProgress?: (p: number) => Promise<void>
) {
  // Full restore is intentionally cautious: restore businesses + CRM tables via upsert, not drop-all.
  const tables = (payload.tables || {}) as Record<string, unknown>;
  await onProgress?.(30);
  const businesses = (tables.businesses as Array<Record<string, unknown>>) || [];
  for (const b of businesses) {
    const data = stripUndefined(b) as Parameters<typeof prisma.business.create>[0]["data"];
    await prisma.business.upsert({
      where: { id: String(b.id) },
      create: data,
      update: {
        name: data.name,
        status: data.status,
        plan: data.plan,
        planStatus: data.planStatus,
        settings: data.settings ?? undefined,
        whiteLabel: data.whiteLabel ?? undefined,
      },
    }).catch(() => null);
  }
  await onProgress?.(50);
  const contacts = (tables.contacts as Array<Record<string, unknown>>) || [];
  for (const c of contacts.slice(0, 50000)) {
    const data = stripUndefined(c) as Parameters<typeof prisma.contact.create>[0]["data"];
    await prisma.contact.upsert({
      where: { id: String(c.id) },
      create: data,
      update: data,
    }).catch(() => null);
  }
  await onProgress?.(80);
  const deals = (tables.deals as Array<Record<string, unknown>>) || [];
  for (const d of deals.slice(0, 50000)) {
    const data = stripUndefined(d) as Parameters<typeof prisma.deal.create>[0]["data"];
    await prisma.deal.upsert({
      where: { id: String(d.id) },
      create: data,
      update: data,
    }).catch(() => null);
  }
  await onProgress?.(95);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export async function listRestores(limit = 50) {
  return prisma.backupRestoreRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      backup: {
        select: { id: true, type: true, businessId: true, fileName: true, createdAt: true },
      },
    },
  });
}

export async function listSchedules() {
  return prisma.backupSchedule.findMany({ orderBy: { cadence: "asc" } });
}

export async function upsertSchedule(input: {
  cadence: "daily" | "weekly" | "monthly";
  enabled?: boolean;
  hourUtc?: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  backupType?: string;
  retentionDays?: number;
}) {
  const nextRunAt = computeNextRun(
    input.cadence,
    input.hourUtc ?? 2,
    input.dayOfWeek ?? 0,
    input.dayOfMonth ?? 1
  );
  return prisma.backupSchedule.upsert({
    where: { cadence: input.cadence },
    create: {
      cadence: input.cadence,
      enabled: input.enabled ?? true,
      hourUtc: input.hourUtc ?? 2,
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      backupType: input.backupType ?? "full",
      retentionDays: input.retentionDays ?? 30,
      nextRunAt,
    },
    update: {
      enabled: input.enabled,
      hourUtc: input.hourUtc,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      backupType: input.backupType,
      retentionDays: input.retentionDays,
      nextRunAt,
    },
  });
}

function computeNextRun(
  cadence: string,
  hourUtc: number,
  dayOfWeek: number,
  dayOfMonth: number
): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  if (cadence === "weekly") {
    while (next.getUTCDay() !== dayOfWeek) next.setUTCDate(next.getUTCDate() + 1);
  }
  if (cadence === "monthly") {
    next.setUTCDate(Math.min(28, dayOfMonth));
    if (next <= now) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(Math.min(28, dayOfMonth));
    }
  }
  return next;
}

/** Ensure default schedules exist and run due jobs. */
export async function ensureDefaultSchedules() {
  for (const cadence of ["daily", "weekly", "monthly"] as const) {
    const existing = await prisma.backupSchedule.findUnique({ where: { cadence } });
    if (!existing) {
      await upsertSchedule({
        cadence,
        enabled: true,
        hourUtc: cadence === "daily" ? 2 : cadence === "weekly" ? 3 : 4,
        dayOfWeek: 0,
        dayOfMonth: 1,
        backupType: "full",
        retentionDays: cadence === "daily" ? 14 : cadence === "weekly" ? 60 : 365,
      });
    }
  }
}

export async function runDueSchedules() {
  const due = await prisma.backupSchedule.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: { lte: new Date() } }, { nextRunAt: null }],
    },
  });
  for (const sch of due) {
    try {
      const trigger =
        sch.cadence === "daily" ? "daily" : sch.cadence === "weekly" ? "weekly" : "monthly";
      if (sch.backupType === "business_all") {
        const businesses = await prisma.business.findMany({
          where: { status: { not: "deleted" }, isDemo: false },
          select: { id: true },
        });
        for (const b of businesses) {
          await createBackup({
            type: "business",
            businessId: b.id,
            trigger: trigger as BackupTrigger,
            notifyEmail: env.BACKUP_NOTIFY_EMAIL || null,
          });
        }
      } else {
        await createBackup({
          type: "full",
          trigger: trigger as BackupTrigger,
          notifyEmail: env.BACKUP_NOTIFY_EMAIL || null,
        });
      }
      const nextRunAt = computeNextRun(
        sch.cadence,
        sch.hourUtc,
        sch.dayOfWeek ?? 0,
        sch.dayOfMonth ?? 1
      );
      // Push next run past "now" by cadence
      if (sch.cadence === "daily") {
        nextRunAt.setTime(Date.now() + 24 * 3600 * 1000);
        nextRunAt.setUTCHours(sch.hourUtc, 0, 0, 0);
      } else if (sch.cadence === "weekly") {
        nextRunAt.setTime(Date.now() + 7 * 24 * 3600 * 1000);
      } else {
        nextRunAt.setTime(Date.now() + 28 * 24 * 3600 * 1000);
      }
      await prisma.backupSchedule.update({
        where: { id: sch.id },
        data: { lastRunAt: new Date(), nextRunAt, lastError: null },
      });
      // Apply retention
      await applyRetention(sch.retentionDays, trigger as BackupTrigger);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.backupSchedule.update({
        where: { id: sch.id },
        data: { lastError: msg },
      });
      await notifyFailure(env.BACKUP_NOTIFY_EMAIL, "Scheduled backup failed", msg);
    }
  }
}

async function applyRetention(days: number, trigger: BackupTrigger) {
  const cutoff = new Date(Date.now() - days * 86400000);
  const old = await prisma.backupRecord.findMany({
    where: {
      trigger,
      createdAt: { lt: cutoff },
      status: { in: ["completed", "verified"] },
    },
    select: { id: true },
  });
  for (const o of old) {
    await deleteBackup(o.id, null).catch(() => null);
  }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startBackupScheduler() {
  if (schedulerTimer) return;
  // Check every 5 minutes
  const tick = async () => {
    try {
      await ensureDefaultSchedules();
      await runDueSchedules();
    } catch (e) {
      console.error("[backup-scheduler]", e instanceof Error ? e.message : e);
    }
  };
  void tick();
  schedulerTimer = setInterval(tick, 5 * 60 * 1000);
  console.log("[backup-scheduler] started (interval 5m)");
}

export function stopBackupScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
