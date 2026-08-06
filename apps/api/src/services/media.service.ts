/**
 * Media Library — folders, assets, kits, WhatsApp (and future channel) sends.
 * Phase 3 DAM hooks: content hash, approval, archive, events, lastUsed.
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
  MEDIA_SIZE_LIMIT_MESSAGE,
  openMediaReadStream,
  readMediaBuffer,
  saveMediaFile,
} from "./media-storage.service.js";
import { sendWhatsAppMediaFile } from "./whatsapp.service.js";
import { createHash, randomBytes } from "node:crypto";

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
  });
  // Count only active (non-deleted) assets per folder
  const counts = await prisma.mediaAsset.groupBy({
    by: ["folderId"],
    where: { businessId, deletedAt: null },
    _count: { _all: true },
  });
  const countMap = new Map(
    counts.map((c) => [c.folderId ?? "__null__", c._count._all])
  );
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    sortOrder: f.sortOrder,
    assetCount: countMap.get(f.id) ?? 0,
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

export type ListAssetsOpts = {
  folderId?: string | null;
  search?: string;
  kind?: string;
  /** Filter by uploader user id */
  uploadedBy?: string;
  /** Tag partial match */
  tag?: string;
  /** Only favorites for this user */
  favoritesOnly?: boolean;
  /** Include archived files (admin) */
  includeArchived?: boolean;
  /** Filter by approval status */
  approvalStatus?: string;
  /** Only shareable (approved, not archived/expired) — for Send Media */
  shareableOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export async function getActorLabel(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return u?.name?.trim() || u?.email || "User";
}

export async function recordAssetEvent(opts: {
  businessId: string;
  assetId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  action: string;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await prisma.mediaAssetEvent.create({
      data: {
        businessId: opts.businessId,
        assetId: opts.assetId,
        actorUserId: opts.actorUserId || null,
        actorName: opts.actorName || null,
        action: opts.action,
        detail: opts.detail || null,
        metadata: (opts.metadata || undefined) as object | undefined,
      },
    });
  } catch {
    // Non-fatal — timeline is best-effort
  }
}

export async function touchLastUsed(assetId: string) {
  try {
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    /* ignore */
  }
}

function contentHashOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function listAssets(userId: string, opts?: ListAssetsOpts) {
  const businessId = await requireBusiness(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize || 48));
  const where: Record<string, unknown> = { businessId, deletedAt: null };

  if (!opts?.includeArchived) {
    where.archivedAt = null;
  }

  const andClauses: Array<Record<string, unknown>> = [];

  if (opts?.shareableOnly) {
    const now = new Date();
    where.approvalStatus = "approved";
    where.archivedAt = null;
    andClauses.push({
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
  } else if (opts?.approvalStatus) {
    where.approvalStatus = opts.approvalStatus;
  }

  if (opts?.folderId === "null" || opts?.folderId === "") {
    where.folderId = null;
  } else if (opts?.folderId) {
    where.folderId = opts.folderId;
  }
  if (opts?.kind) where.kind = opts.kind;
  if (opts?.uploadedBy) where.createdByUserId = opts.uploadedBy;
  if (opts?.tag?.trim()) {
    where.tags = { has: opts.tag.trim() };
  }

  const q = opts?.search?.trim();
  if (q) {
    // Advanced partial search: name, originalName, tags, folder name, uploader
    const folderHits = await prisma.mediaFolder.findMany({
      where: {
        businessId,
        name: { contains: q, mode: "insensitive" },
      },
      select: { id: true },
      take: 50,
    });
    const uploaderHits = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 30,
    });
    andClauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { originalName: { contains: q, mode: "insensitive" } },
        { tags: { has: q } },
        ...(folderHits.length
          ? [{ folderId: { in: folderHits.map((f) => f.id) } }]
          : []),
        ...(uploaderHits.length
          ? [{ createdByUserId: { in: uploaderHits.map((u) => u.id) } }]
          : []),
      ],
    });
  }

  if (andClauses.length) {
    where.AND = andClauses;
  }

  if (opts?.favoritesOnly) {
    const favIds = await prisma.mediaFavorite.findMany({
      where: { businessId, userId },
      select: { assetId: true },
    });
    where.id = { in: favIds.map((f) => f.assetId) };
    if (!favIds.length) {
      return { items: [], total: 0, page, pageSize, totalPages: 1 };
    }
  }

  const [total, assets, favRows] = await Promise.all([
    prisma.mediaAsset.count({ where: where as never }),
    prisma.mediaAsset.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        folder: { select: { id: true, name: true } },
      },
    }),
    prisma.mediaFavorite.findMany({
      where: { userId, businessId },
      select: { assetId: true },
    }),
  ]);

  const favSet = new Set(favRows.map((f) => f.assetId));
  const uploaderIds = [...new Set(assets.map((a) => a.createdByUserId))];
  const uploaders = uploaderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uploaderMap = new Map(uploaders.map((u) => [u.id, u]));

  return {
    items: assets.map((a) =>
      serializeAsset(a, {
        isFavorite: favSet.has(a.id),
        folderName: a.folder?.name || null,
        uploadedByName:
          uploaderMap.get(a.createdByUserId)?.name ||
          uploaderMap.get(a.createdByUserId)?.email ||
          null,
      })
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type SerializedMediaAsset = ReturnType<typeof serializeAsset>;

function serializeAsset(
  a: {
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
    tags?: string[];
    downloadCount?: number;
    whatsappSendCount?: number;
    emailSendCount?: number;
    contentHash?: string | null;
    versionNumber?: number;
    versionGroupId?: string | null;
    approvalStatus?: string;
    expiresAt?: Date | null;
    archivedAt?: Date | null;
    archiveReason?: string | null;
    lastUsedAt?: Date | null;
    approvedAt?: Date | null;
    rejectionReason?: string | null;
  },
  extra?: {
    isFavorite?: boolean;
    folderName?: string | null;
    uploadedByName?: string | null;
  }
) {
  return {
    id: a.id,
    name: a.name,
    originalName: a.originalName,
    mimeType: a.mimeType,
    kind: a.kind,
    sizeBytes: a.sizeBytes,
    folderId: a.folderId,
    folderName: extra?.folderName ?? null,
    captionDefault: a.captionDefault,
    tags: a.tags || [],
    downloadCount: a.downloadCount ?? 0,
    whatsappSendCount: a.whatsappSendCount ?? 0,
    emailSendCount: a.emailSendCount ?? 0,
    storageProvider: a.storageProvider,
    createdByUserId: a.createdByUserId,
    uploadedByName: extra?.uploadedByName ?? null,
    isFavorite: !!extra?.isFavorite,
    contentHash: a.contentHash ?? null,
    versionNumber: a.versionNumber ?? 1,
    versionGroupId: a.versionGroupId ?? a.id,
    approvalStatus: a.approvalStatus ?? "approved",
    expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
    archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
    archiveReason: a.archiveReason ?? null,
    lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
    approvedAt: a.approvedAt ? a.approvedAt.toISOString() : null,
    rejectionReason: a.rejectionReason ?? null,
    isShareable:
      (a.approvalStatus ?? "approved") === "approved" &&
      !a.archivedAt &&
      (!a.expiresAt || a.expiresAt.getTime() > Date.now()),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    previewUrl: `/api/media/assets/${a.id}/file`,
  };
}

/** Public alias for DAM helpers */
export function serializeAssetPublic(
  a: Parameters<typeof serializeAsset>[0],
  extra?: Parameters<typeof serializeAsset>[1]
) {
  return serializeAsset(a, extra);
}

/** Lightweight count for sidebar badge */
export async function getMediaTotalCount(userId: string): Promise<number> {
  try {
    const businessId = await getUserBusinessId(userId);
    if (!businessId) return 0;
    return prisma.mediaAsset.count({ where: { businessId, deletedAt: null } });
  } catch {
    return 0;
  }
}

/** Dashboard widget + analytics */
export async function getMediaStats(userId: string) {
  const businessId = await requireBusiness(userId);
  const base = { businessId, deletedAt: null as null };

  const [
    totalFiles,
    storageAgg,
    byKind,
    recent,
    topDownloaded,
    topShared,
    whatsappSends,
    emailSends,
  ] = await Promise.all([
    prisma.mediaAsset.count({ where: base }),
    prisma.mediaAsset.aggregate({
      where: base,
      _sum: { sizeBytes: true },
    }),
    prisma.mediaAsset.groupBy({
      by: ["kind"],
      where: base,
      _count: { _all: true },
    }),
    prisma.mediaAsset.findMany({
      where: base,
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        kind: true,
        sizeBytes: true,
        createdAt: true,
        mimeType: true,
      },
    }),
    prisma.mediaAsset.findFirst({
      where: base,
      orderBy: { downloadCount: "desc" },
      select: { id: true, name: true, downloadCount: true },
    }),
    prisma.mediaAsset.findFirst({
      where: base,
      orderBy: { whatsappSendCount: "desc" },
      select: { id: true, name: true, whatsappSendCount: true, emailSendCount: true },
    }),
    prisma.mediaSendLog.count({
      where: { businessId, channel: "whatsapp", status: { not: "failed" } },
    }),
    prisma.mediaSendLog.count({
      where: { businessId, channel: "email", status: { not: "failed" } },
    }),
  ]);

  const kindMap: Record<string, number> = {};
  for (const row of byKind) kindMap[row.kind] = row._count._all;

  const storageBytes = storageAgg._sum.sizeBytes || 0;
  return {
    totalFiles,
    storageBytes,
    storageUsedLabel: formatStorage(storageBytes),
    byKind: {
      brochures: kindMap.pdf || 0, // PDFs often brochures; also expose pdf
      images: kindMap.image || 0,
      videos: kindMap.video || 0,
      pdfs: kindMap.pdf || 0,
      documents: kindMap.document || 0,
    },
    kindBreakdown: kindMap,
    recent: recent.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      mimeType: r.mimeType,
    })),
    mostDownloaded: topDownloaded
      ? {
          id: topDownloaded.id,
          name: topDownloaded.name,
          count: topDownloaded.downloadCount,
        }
      : null,
    mostShared: topShared
      ? {
          id: topShared.id,
          name: topShared.name,
          whatsapp: topShared.whatsappSendCount,
          email: topShared.emailSendCount,
        }
      : null,
    totalWhatsAppShares: whatsappSends,
    totalEmailShares: emailSends,
  };
}

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function getAssetDetail(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
    include: { folder: { select: { id: true, name: true } } },
  });
  if (!asset) throw new Error("File not found");
  const [uploader, fav] = await Promise.all([
    prisma.user.findUnique({
      where: { id: asset.createdByUserId },
      select: { name: true, email: true },
    }),
    prisma.mediaFavorite.findUnique({
      where: { userId_assetId: { userId, assetId } },
    }),
  ]);
  return serializeAsset(asset, {
    isFavorite: !!fav,
    folderName: asset.folder?.name || null,
    uploadedByName: uploader?.name || uploader?.email || null,
  });
}

export async function toggleFavorite(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!asset) throw new Error("File not found");
  const existing = await prisma.mediaFavorite.findUnique({
    where: { userId_assetId: { userId, assetId } },
  });
  const actorName = await getActorLabel(userId);
  if (existing) {
    await prisma.mediaFavorite.delete({ where: { id: existing.id } });
    await recordAssetEvent({
      businessId,
      assetId,
      actorUserId: userId,
      actorName,
      action: "unfavorited",
      detail: "Removed from favorites",
    });
    return { favorited: false };
  }
  await prisma.mediaFavorite.create({
    data: { businessId, userId, assetId },
  });
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "favorited",
    detail: "Added to favorites",
  });
  return { favorited: true };
}

export async function updateAssetTags(
  userId: string,
  assetId: string,
  tags: string[]
) {
  if (!(await canManageMedia(userId))) throw new Error("Only Business Admin can edit tags");
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  const asset = await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { tags: clean },
  });
  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "tagged",
    detail: clean.length ? `Tags: ${clean.join(", ")}` : "Tags cleared",
  });
  return serializeAsset(asset);
}

export async function recordDownload(userId: string, assetId: string) {
  const businessId = await requireBusiness(userId);
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: assetId, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("File not found");
  await prisma.mediaAsset.update({
    where: { id: assetId },
    data: { downloadCount: { increment: 1 }, lastUsedAt: new Date() },
  });
  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "downloaded",
    detail: "File downloaded",
  });
  return { ok: true };
}

export type UploadDupAction = "replace" | "keep_both" | "skip";

export class MediaDuplicateError extends Error {
  code = "DUPLICATE" as const;
  duplicates: ReturnType<typeof serializeAsset>[];
  contentHash: string;
  constructor(
    duplicates: ReturnType<typeof serializeAsset>[],
    contentHash: string
  ) {
    super("File already exists");
    this.duplicates = duplicates;
    this.contentHash = contentHash;
  }
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
    tags?: string[];
    /** pending | approved (default approved for admin UX; set pending for workflow) */
    approvalStatus?: "pending" | "approved";
    expiresAt?: string | null;
    /** When duplicate found: replace | keep_both | skip. Omit → throw DUPLICATE */
    duplicateAction?: UploadDupAction;
    /** Explicit asset id to replace (version bump) */
    replaceAssetId?: string | null;
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
    throw new Error(MEDIA_SIZE_LIMIT_MESSAGE);
  }
  if (opts.folderId) {
    const f = await prisma.mediaFolder.findFirst({
      where: { id: opts.folderId, businessId },
    });
    if (!f) throw new Error("Folder not found");
  }

  const hash = contentHashOf(opts.buffer);
  const originalName = opts.originalName.slice(0, 255);
  const displayName = (opts.name || opts.originalName).trim().slice(0, 200);
  const kind = kindFromMime(opts.mimeType)!;
  const mime = opts.mimeType.split(";")[0]!.trim();
  const approvalStatus = opts.approvalStatus === "pending" ? "pending" : "approved";
  const expiresAt = opts.expiresAt ? new Date(opts.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid expiry date");
  }
  const tags = [...new Set((opts.tags || []).map((t) => t.trim()).filter(Boolean))].slice(0, 30);
  const actorName = await getActorLabel(userId);

  // Explicit replace path
  if (opts.replaceAssetId || opts.duplicateAction === "replace") {
    const targetId = opts.replaceAssetId;
    let existing = targetId
      ? await prisma.mediaAsset.findFirst({
          where: { id: targetId, businessId, deletedAt: null },
        })
      : null;
    if (!existing) {
      existing = await prisma.mediaAsset.findFirst({
        where: {
          businessId,
          deletedAt: null,
          OR: [
            { contentHash: hash },
            { originalName: { equals: originalName, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
    }
    if (existing) {
      // Snapshot current version
      await prisma.mediaAssetVersion.create({
        data: {
          businessId,
          assetId: existing.id,
          versionNumber: existing.versionNumber,
          name: existing.name,
          originalName: existing.originalName,
          mimeType: existing.mimeType,
          kind: existing.kind,
          sizeBytes: existing.sizeBytes,
          storageKey: existing.storageKey,
          storageProvider: existing.storageProvider,
          contentHash: existing.contentHash,
          createdByUserId: userId,
          note: "Replaced by new upload",
        },
      });
      const { storageKey, storageProvider } = await saveMediaFile({
        businessId,
        assetId: existing.id,
        originalName,
        buffer: opts.buffer,
      });
      const nextVer = (existing.versionNumber || 1) + 1;
      const asset = await prisma.mediaAsset.update({
        where: { id: existing.id },
        data: {
          name: displayName,
          originalName,
          mimeType: mime,
          kind,
          sizeBytes: opts.buffer.length,
          storageProvider,
          storageKey,
          contentHash: hash,
          versionNumber: nextVer,
          isLatestVersion: true,
          captionDefault: opts.captionDefault?.trim() || existing.captionDefault,
          tags: tags.length ? tags : existing.tags,
          approvalStatus,
          approvedByUserId: approvalStatus === "approved" ? userId : null,
          approvedAt: approvalStatus === "approved" ? new Date() : null,
          expiresAt,
          folderId: opts.folderId !== undefined ? opts.folderId || null : existing.folderId,
        },
      });
      await recordAssetEvent({
        businessId,
        assetId: asset.id,
        actorUserId: userId,
        actorName,
        action: "replaced",
        detail: `Replaced with version ${nextVer}`,
        metadata: { versionNumber: nextVer, contentHash: hash },
      });
      await recordAudit({
        businessId,
        actorUserId: userId,
        action: "media_replace",
        entityType: "media_asset",
        entityId: asset.id,
        metadata: { name: asset.name, version: nextVer },
      });
      return serializeAsset(asset);
    }
    // fall through to create if no existing for replace
  }

  if (opts.duplicateAction === "skip") {
    const dup = await prisma.mediaAsset.findFirst({
      where: {
        businessId,
        deletedAt: null,
        OR: [
          { contentHash: hash },
          { originalName: { equals: originalName, mode: "insensitive" } },
        ],
      },
    });
    if (dup) {
      return { ...serializeAsset(dup), skipped: true as const };
    }
  }

  // Detect duplicates unless keep_both
  if (opts.duplicateAction !== "keep_both" && opts.duplicateAction !== "replace") {
    const dups = await prisma.mediaAsset.findMany({
      where: {
        businessId,
        deletedAt: null,
        OR: [
          { contentHash: hash },
          { originalName: { equals: originalName, mode: "insensitive" } },
        ],
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    if (dups.length) {
      throw new MediaDuplicateError(
        dups.map((d) => serializeAsset(d)),
        hash
      );
    }
  }

  const assetId = `m${randomBytes(12).toString("hex")}`;
  const { storageKey, storageProvider } = await saveMediaFile({
    businessId,
    assetId,
    originalName,
    buffer: opts.buffer,
  });

  const asset = await prisma.mediaAsset.create({
    data: {
      id: assetId,
      businessId,
      folderId: opts.folderId || null,
      name: displayName,
      originalName,
      mimeType: mime,
      kind,
      sizeBytes: opts.buffer.length,
      storageProvider,
      storageKey,
      captionDefault: opts.captionDefault?.trim() || null,
      tags,
      createdByUserId: userId,
      contentHash: hash,
      versionGroupId: assetId,
      versionNumber: 1,
      isLatestVersion: true,
      approvalStatus,
      approvedByUserId: approvalStatus === "approved" ? userId : null,
      approvedAt: approvalStatus === "approved" ? new Date() : null,
      expiresAt,
      lastUsedAt: null,
    },
  });

  await recordAssetEvent({
    businessId,
    assetId: asset.id,
    actorUserId: userId,
    actorName,
    action: "uploaded",
    detail: `Uploaded ${displayName} (${kind}, ${opts.buffer.length} bytes)`,
    metadata: {
      contentHash: hash,
      approvalStatus,
      sizeBytes: opts.buffer.length,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "media_upload",
    entityType: "media_asset",
    entityId: asset.id,
    metadata: { name: asset.name, kind, sizeBytes: asset.sizeBytes, contentHash: hash },
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
  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "renamed",
    detail: `Renamed from "${existing.name}" to "${n}"`,
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
  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "moved",
    detail: folderId ? `Moved to folder ${folderId}` : "Moved to root",
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
  const actorName = await getActorLabel(userId);
  await recordAssetEvent({
    businessId,
    assetId,
    actorUserId: userId,
    actorName,
    action: "deleted",
    detail: `Soft-deleted "${existing.name}"`,
  });
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

  const now = new Date();
  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: ids },
      businessId,
      deletedAt: null,
      archivedAt: null,
      approvalStatus: "approved",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (!assets.length) {
    throw new Error(
      "No valid files found. Only approved, non-expired, non-archived files can be sent."
    );
  }

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
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          whatsappSendCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });
      await recordAssetEvent({
        businessId,
        assetId: asset.id,
        actorUserId: userId,
        actorName: salesName,
        action: "sent",
        detail: `Sent via WhatsApp to ${contactRow.name}`,
        metadata: { contactId: contactRow.id, channel: "whatsapp" },
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
