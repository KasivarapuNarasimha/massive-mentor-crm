/**
 * Media Library — folders, assets, kits, WhatsApp (and future channel) sends.
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { recordAudit } from "./audit.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import {
  deleteMediaFile,
  isAllowedMime,
  kindFromMime,
  maxMediaBytes,
  openMediaReadStream,
  readMediaBuffer,
  saveMediaFile,
} from "./media-storage.service.js";
import { sendWhatsAppMediaFile } from "./whatsapp.service.js";
import { randomBytes } from "node:crypto";

const MANAGE_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "super_admin",
]);

const DEFAULT_FOLDERS = [
  "Marketing Brochures",
  "Product Images",
  "Company Profile",
  "Price Lists",
  "Real Estate Projects",
  "CRM Demo",
  "Videos",
  "Offers",
];

export async function canManageMedia(userId: string): Promise<boolean> {
  const role = await resolveActorRole(userId);
  return MANAGE_ROLES.has(role) || role.includes("admin");
}

export async function canSendMedia(userId: string): Promise<boolean> {
  // Any authenticated workspace user who can access CRM may send allowed media
  const businessId = await getUserBusinessId(userId);
  return !!businessId || true;
}

async function requireBusiness(userId: string): Promise<string> {
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Workspace required for Media Library");
  return businessId;
}

export async function ensureDefaultFolders(userId: string) {
  const businessId = await requireBusiness(userId);
  const count = await prisma.mediaFolder.count({ where: { businessId } });
  if (count > 0) return listFolders(userId);
  await prisma.mediaFolder.createMany({
    data: DEFAULT_FOLDERS.map((name, i) => ({
      businessId,
      name,
      sortOrder: i,
      createdByUserId: userId,
    })),
  });
  return listFolders(userId);
}

export async function listFolders(userId: string) {
  const businessId = await requireBusiness(userId);
  const folders = await prisma.mediaFolder.findMany({
    where: { businessId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { assets: true } } },
  });
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    sortOrder: f.sortOrder,
    assetCount: f._count.assets,
    createdAt: f.createdAt.toISOString(),
  }));
}

export async function createFolder(userId: string, name: string, parentId?: string | null) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can create folders");
  const businessId = await requireBusiness(userId);
  const n = name.trim();
  if (!n) throw new Error("Folder name is required");
  if (parentId) {
    const parent = await prisma.mediaFolder.findFirst({ where: { id: parentId, businessId } });
    if (!parent) throw new Error("Parent folder not found");
  }
  const folder = await prisma.mediaFolder.create({
    data: {
      businessId,
      name: n,
      parentId: parentId || null,
      createdByUserId: userId,
    },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_folder_create",
    entityType: "media_folder",
    entityId: folder.id,
    metadata: { name: n },
  });
  return folder;
}

export async function renameFolder(userId: string, folderId: string, name: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can rename folders");
  const businessId = await requireBusiness(userId);
  const n = name.trim();
  if (!n) throw new Error("Folder name is required");
  const existing = await prisma.mediaFolder.findFirst({ where: { id: folderId, businessId } });
  if (!existing) throw new Error("Folder not found");
  return prisma.mediaFolder.update({ where: { id: folderId }, data: { name: n } });
}

export async function deleteFolder(userId: string, folderId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can delete folders");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaFolder.findFirst({ where: { id: folderId, businessId } });
  if (!existing) throw new Error("Folder not found");
  // Soft-clear folder on assets, then delete folder
  await prisma.mediaAsset.updateMany({
    where: { folderId, businessId },
    data: { folderId: null },
  });
  await prisma.mediaFolder.delete({ where: { id: folderId } });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_folder_delete",
    entityType: "media_folder",
    entityId: folderId,
    metadata: { name: existing.name },
  });
  return { deleted: true };
}

export async function listAssets(
  userId: string,
  opts?: { folderId?: string | null; search?: string; kind?: string }
) {
  const businessId = await requireBusiness(userId);
  const where: Record<string, unknown> = { businessId, deletedAt: null };
  if (opts?.folderId === "null" || opts?.folderId === "") {
    where.folderId = null;
  } else if (opts?.folderId) {
    where.folderId = opts.folderId;
  }
  if (opts?.kind) where.kind = opts.kind;
  if (opts?.search?.trim()) {
    where.name = { contains: opts.search.trim(), mode: "insensitive" };
  }
  const assets = await prisma.mediaAsset.findMany({
    where: where as never,
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return assets.map(serializeAsset);
}

function serializeAsset(a: {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  folderId: string | null;
  captionDefault: string | null;
  storageProvider: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    name: a.name,
    originalName: a.originalName,
    mimeType: a.mimeType,
    kind: a.kind,
    sizeBytes: a.sizeBytes,
    folderId: a.folderId,
    captionDefault: a.captionDefault,
    storageProvider: a.storageProvider,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    previewUrl: `/api/media/assets/${a.id}/file`,
  };
}

export async function uploadAsset(
  userId: string,
  opts: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    folderId?: string | null;
    name?: string;
    captionDefault?: string;
  }
) {
  if (!(await canManageMedia(userId))) {
    throw new Error("Only Business Admin can upload media");
  }
  const businessId = await requireBusiness(userId);
  if (!isAllowedMime(opts.mimeType)) {
    throw new Error("File type not allowed. Use images, PDF, video (MP4), or Office docs.");
  }
  if (opts.buffer.length > maxMediaBytes()) {
    throw new Error(`File too large (max ${Math.round(maxMediaBytes() / (1024 * 1024))}MB)`);
  }
  if (opts.folderId) {
    const f = await prisma.mediaFolder.findFirst({
      where: { id: opts.folderId, businessId },
    });
    if (!f) throw new Error("Folder not found");
  }

  const assetId = `m${randomBytes(12).toString("hex")}`;
  const kind = kindFromMime(opts.mimeType)!;
  const { storageKey, storageProvider } = await saveMediaFile({
    businessId,
    assetId,
    originalName: opts.originalName,
    buffer: opts.buffer,
  });

  const asset = await prisma.mediaAsset.create({
    data: {
      id: assetId,
      businessId,
      folderId: opts.folderId || null,
      name: (opts.name || opts.originalName).trim().slice(0, 200),
      originalName: opts.originalName.slice(0, 255),
      mimeType: opts.mimeType.split(";")[0]!.trim(),
      kind,
      sizeBytes: opts.buffer.length,
      storageProvider,
      storageKey,
      captionDefault: opts.captionDefault?.trim() || null,
      createdByUserId: userId,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_upload",
    entityType: "media_asset",
    entityId: asset.id,
    metadata: { name: asset.name, kind, sizeBytes: asset.sizeBytes },
  });

  return serializeAsset(asset);
}

export async function renameAsset(userId: string, assetId: string, name: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can rename files");
  const businessId = await requireBusiness(userId);
  const n = name.trim();
  if (!n) throw new Error("Name is required");
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");
  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { name: n },
  });
  return serializeAsset(asset);
}

export async function moveAsset(userId: string, assetId: string, folderId: string | null) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can move files");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");
  if (folderId) {
    const f = await prisma.mediaFolder.findFirst({ where: { id: folderId, businessId } });
    if (!f) throw new Error("Folder not found");
  }
  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { folderId },
  });
  return serializeAsset(asset);
}

export async function deleteAsset(userId: string, assetId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can delete files");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");
  await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { deletedAt: new Date() },
  });
  // Keep file on disk for audit recovery for now; optional hard delete:
  // await deleteMediaFile(existing.storageKey);
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_delete",
    entityType: "media_asset",
    entityId: assetId,
    metadata: { name: existing.name },
  });
  void deleteMediaFile;
  return { deleted: true };
}

export async function getAssetForDownload(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!asset) throw new Error("File not found");
  return {
    asset,
    stream: openMediaReadStream(asset.storageKey),
  };
}

/** Caption template vars: {{CustomerName}} {{SalesExecutive}} {{Company}} {{Phone}} */
export function renderCaption(
  template: string,
  vars: {
    customerName?: string;
    salesExecutive?: string;
    company?: string;
    phone?: string;
  }
): string {
  return (template || "")
    .replace(/\{\{\s*CustomerName\s*\}\}/gi, vars.customerName || "")
    .replace(/\{\{\s*SalesExecutive\s*\}\}/gi, vars.salesExecutive || "")
    .replace(/\{\{\s*Company\s*\}\}/gi, vars.company || "")
    .replace(/\{\{\s*Phone\s*\}\}/gi, vars.phone || "")
    .trim();
}

function waMediaType(kind: string, mime: string): "image" | "video" | "document" {
  if (kind === "image" || mime.startsWith("image/")) return "image";
  if (kind === "video" || mime.startsWith("video/")) return "video";
  return "document";
}

export async function sendMediaViaWhatsApp(
  userId: string,
  opts: {
    contactId: string;
    assetIds: string[];
    caption?: string;
    kitId?: string;
  }
) {
  if (!(await canSendMedia(userId))) throw new Error("Not allowed to send media");
  const businessId = await requireBusiness(userId);
  const ids = [...new Set((opts.assetIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one file");
  if (ids.length > 10) throw new Error("Maximum 10 files per send (WhatsApp limits)");

  const contact = await prisma.contact.findFirst({
    where: { id: opts.contactId, businessId, deletedAt: null },
  });
  // Also allow by user scope if contact is user-owned
  const contactRow =
    contact ||
    (await prisma.contact.findFirst({
      where: { id: opts.contactId, userId, deletedAt: null },
    }));
  if (!contactRow) throw new Error("Lead/Client not found");

  const phone = (contactRow.phone || contactRow.whatsapp || "").replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 10) {
    throw new Error("Contact has no valid phone number for WhatsApp");
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const salesName = actor?.name?.trim() || actor?.email || "Sales";

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids }, businessId, deletedAt: null },
  });
  if (!assets.length) throw new Error("No valid files found");

  // Preserve selection order
  const ordered = ids
    .map((id) => assets.find((a) => a.id === id))
    .filter(Boolean) as typeof assets;

  const baseCaption = renderCaption(opts.caption || "", {
    customerName: contactRow.name,
    salesExecutive: salesName,
    company: contactRow.company || "",
    phone: contactRow.phone || "",
  });

  const results: Array<{
    assetId: string;
    assetName: string;
    ok: boolean;
    status: string;
    error?: string;
    logId?: string;
  }> = [];

  for (let i = 0; i < ordered.length; i++) {
    const asset = ordered[i]!;
    // Caption only on first file if multi-send (WhatsApp UX)
    const caption =
      i === 0
        ? baseCaption || asset.captionDefault || undefined
        : asset.captionDefault || undefined;

    const log = await prisma.mediaSendLog.create({
      data: {
        businessId,
        assetId: asset.id,
        assetName: asset.name,
        kitId: opts.kitId || null,
        sentByUserId: userId,
        sentByName: salesName,
        contactId: contactRow.id,
        contactName: contactRow.name,
        contactType: contactRow.type,
        toPhone: phone,
        channel: "whatsapp",
        caption: caption || null,
        status: "pending",
      },
    });

    try {
      const buffer = await readMediaBuffer(asset.storageKey);
      const record = await sendWhatsAppMediaFile({
        userId,
        to: phone,
        buffer,
        mimeType: asset.mimeType,
        fileName: asset.originalName || asset.name,
        caption,
        contactId: contactRow.id,
        mediaType: waMediaType(asset.kind, asset.mimeType),
      });
      await prisma.mediaSendLog.update({
        where: { id: log.id },
        data: {
          status: "sent",
          waMessageId: record.waMessageId,
        },
      });
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        ok: true,
        status: "sent",
        logId: log.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      await prisma.mediaSendLog.update({
        where: { id: log.id },
        data: { status: "failed", error: msg },
      });
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        ok: false,
        status: "failed",
        error: msg,
        logId: log.id,
      });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_whatsapp_send",
    entityType: "contact",
    entityId: contactRow.id,
    metadata: {
      contactName: contactRow.name,
      to: phone,
      sent,
      failed: results.length - sent,
      assets: results,
      kitId: opts.kitId || null,
    },
  });

  return {
    sent,
    failed: results.length - sent,
    results,
    contact: { id: contactRow.id, name: contactRow.name, phone },
  };
}

// —— Kits ——
export async function listKits(userId: string) {
  const businessId = await requireBusiness(userId);
  const kits = await prisma.mediaKit.findMany({
    where: { businessId },
    orderBy: { name: "asc" },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: { asset: true },
      },
    },
  });
  return kits.map((k) => ({
    id: k.id,
    name: k.name,
    description: k.description,
    captionTemplate: k.captionTemplate,
    createdAt: k.createdAt.toISOString(),
    items: k.items
      .filter((i) => i.asset && !i.asset.deletedAt)
      .map((i) => ({
        assetId: i.assetId,
        sortOrder: i.sortOrder,
        asset: serializeAsset(i.asset),
      })),
  }));
}

export async function createKit(
  userId: string,
  input: {
    name: string;
    description?: string;
    captionTemplate?: string;
    assetIds: string[];
  }
) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can create kits");
  const businessId = await requireBusiness(userId);
  const name = input.name.trim();
  if (!name) throw new Error("Kit name is required");
  const assetIds = [...new Set((input.assetIds || []).filter(Boolean))];
  if (!assetIds.length) throw new Error("Select at least one file for the kit");

  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds }, businessId, deletedAt: null },
  });
  if (assets.length !== assetIds.length) throw new Error("Some files were not found");

  const kit = await prisma.mediaKit.create({
    data: {
      businessId,
      name,
      description: input.description?.trim() || null,
      captionTemplate: input.captionTemplate?.trim() || null,
      createdByUserId: userId,
      items: {
        create: assetIds.map((assetId, i) => ({ assetId, sortOrder: i })),
      },
    },
    include: { items: true },
  });
  return kit;
}

export async function deleteKit(userId: string, kitId: string) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can delete kits");
  const businessId = await requireBusiness(userId);
  const kit = await prisma.mediaKit.findFirst({ where: { id: kitId, businessId } });
  if (!kit) throw new Error("Kit not found");
  await prisma.mediaKit.delete({ where: { id: kitId } });
  return { deleted: true };
}

export async function sendKitViaWhatsApp(
  userId: string,
  opts: { contactId: string; kitId: string; caption?: string }
) {
  const businessId = await requireBusiness(userId);
  const kit = await prisma.mediaKit.findFirst({
    where: { id: opts.kitId, businessId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!kit) throw new Error("Kit not found");
  return sendMediaViaWhatsApp(userId, {
    contactId: opts.contactId,
    assetIds: kit.items.map((i) => i.assetId),
    caption: opts.caption || kit.captionTemplate || undefined,
    kitId: kit.id,
  });
}

// —— Activity / history ——
export async function listMediaSendLogs(
  userId: string,
  opts?: { page?: number; pageSize?: number; contactId?: string }
) {
  const businessId = await requireBusiness(userId);
  const isAdmin = await canManageMedia(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 25));
  const where: Record<string, unknown> = { businessId };
  if (!isAdmin) where.sentByUserId = userId;
  if (opts?.contactId) where.contactId = opts.contactId;

  const [total, items] = await Promise.all([
    prisma.mediaSendLog.count({ where: where as never }),
    prisma.mediaSendLog.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: items.map((l) => ({
      id: l.id,
      assetId: l.assetId,
      assetName: l.assetName,
      sentByUserId: l.sentByUserId,
      sentByName: l.sentByName,
      contactId: l.contactId,
      contactName: l.contactName,
      contactType: l.contactType,
      toPhone: l.toPhone,
      channel: l.channel,
      caption: l.caption,
      status: l.status,
      error: l.error,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}
