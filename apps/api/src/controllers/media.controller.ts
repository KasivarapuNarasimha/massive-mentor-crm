import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import * as media from "../services/media.service.js";
import * as dam from "../services/media-dam.service.js";

function errStatus(message: string): number {
  if (/permission|Only Business Admin|Not allowed/i.test(message)) return 403;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export async function listFolders(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    await media.ensureDefaultFolders(req.user.id);
    const folders = await media.listFolders(req.user.id);
    res.json({ success: true, data: { folders } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function createFolder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const folder = await media.createFolder(
      req.user.id,
      String(req.body?.name || ""),
      req.body?.parentId ? String(req.body.parentId) : null
    );
    res.status(201).json({ success: true, data: { folder } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function renameFolder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const folder = await media.renameFolder(req.user.id, id, String(req.body?.name || ""));
    res.json({ success: true, data: { folder } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function deleteFolder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await media.deleteFolder(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listAssets(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await media.listAssets(req.user.id, {
      folderId: req.query.folderId != null ? String(req.query.folderId) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      kind: req.query.kind ? String(req.query.kind) : undefined,
      uploadedBy: req.query.uploadedBy ? String(req.query.uploadedBy) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      favoritesOnly:
        req.query.favorites === "1" ||
        req.query.favorites === "true" ||
        req.query.favoritesOnly === "1",
      includeArchived:
        req.query.includeArchived === "1" || req.query.includeArchived === "true",
      approvalStatus: req.query.approvalStatus
        ? String(req.query.approvalStatus)
        : undefined,
      shareableOnly:
        req.query.shareableOnly === "1" || req.query.shareableOnly === "true",
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 48,
    });
    // Backward compat: `assets` alias for items
    res.json({ success: true, data: { ...data, assets: data.items } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function mediaStats(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await media.getMediaStats(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function mediaCount(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const total = await media.getMediaTotalCount(req.user.id);
    res.json({ success: true, data: { total } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function assetDetail(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await media.getAssetDetail(req.user.id, id);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function toggleFavorite(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await media.toggleFavorite(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function updateTags(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const tags = Array.isArray(req.body?.tags) ? (req.body.tags as string[]) : [];
    const asset = await media.updateAssetTags(req.user.id, id, tags);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function recordDownload(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await media.recordDownload(req.user.id, id);
    res.json({ success: true, data: { ok: true } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

function parseDupAction(
  raw: unknown
): media.UploadDupAction | undefined {
  const v = String(raw || "").toLowerCase().replace(/-/g, "_");
  if (v === "replace" || v === "keep_both" || v === "skip") return v;
  return undefined;
}

export async function uploadAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }
    const { MEDIA_SIZE_LIMIT_MESSAGE, maxMediaBytes } = await import(
      "../services/media-storage.service.js"
    );
    if (file.size > maxMediaBytes() || file.buffer.length > maxMediaBytes()) {
      return res.status(400).json({ success: false, error: MEDIA_SIZE_LIMIT_MESSAGE });
    }
    let tags: string[] | undefined;
    if (typeof req.body?.tags === "string" && req.body.tags.trim()) {
      try {
        const parsed = JSON.parse(req.body.tags) as unknown;
        if (Array.isArray(parsed)) tags = parsed.map(String);
      } catch {
        tags = String(req.body.tags)
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean);
      }
    }
    const asset = await media.uploadAsset(req.user.id, {
      buffer: file.buffer,
      originalName: file.originalname || "upload",
      mimeType: file.mimetype || "application/octet-stream",
      folderId: req.body?.folderId ? String(req.body.folderId) : null,
      name: req.body?.name ? String(req.body.name) : undefined,
      captionDefault: req.body?.captionDefault ? String(req.body.captionDefault) : undefined,
      tags,
      approvalStatus:
        req.body?.approvalStatus === "pending" ? "pending" : "approved",
      expiresAt: req.body?.expiresAt ? String(req.body.expiresAt) : null,
      duplicateAction: parseDupAction(req.body?.duplicateAction),
      replaceAssetId: req.body?.replaceAssetId
        ? String(req.body.replaceAssetId)
        : null,
    });
    const skipped = "skipped" in asset && asset.skipped;
    res.status(skipped ? 200 : 201).json({
      success: true,
      data: {
        asset: {
          ...asset,
          sizeBytes: asset.sizeBytes,
          sizeMb: Math.round((asset.sizeBytes / (1024 * 1024)) * 100) / 100,
        },
        skipped: !!skipped,
      },
    });
  } catch (e: unknown) {
    if (e instanceof media.MediaDuplicateError) {
      return res.status(409).json({
        success: false,
        error: e.message,
        code: "DUPLICATE",
        data: {
          duplicates: e.duplicates,
          contentHash: e.contentHash,
        },
      });
    }
    const message = e instanceof Error ? e.message : "Upload failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

/** Bulk upload — multiple files, each with independent result */
export async function bulkUploadAssets(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: "No files uploaded" });
    }
    if (files.length > 50) {
      return res.status(400).json({ success: false, error: "Maximum 50 files per bulk upload" });
    }
    const { MEDIA_SIZE_LIMIT_MESSAGE, maxMediaBytes } = await import(
      "../services/media-storage.service.js"
    );
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    const duplicateAction = parseDupAction(req.body?.duplicateAction) || "keep_both";
    const approvalStatus =
      req.body?.approvalStatus === "pending" ? ("pending" as const) : ("approved" as const);

    const results: Array<{
      fileName: string;
      ok: boolean;
      skipped?: boolean;
      asset?: unknown;
      error?: string;
      code?: string;
      duplicates?: unknown;
    }> = [];

    for (const file of files) {
      try {
        if (!file.buffer?.length) {
          results.push({ fileName: file.originalname, ok: false, error: "Empty file" });
          continue;
        }
        if (file.size > maxMediaBytes() || file.buffer.length > maxMediaBytes()) {
          results.push({
            fileName: file.originalname,
            ok: false,
            error: MEDIA_SIZE_LIMIT_MESSAGE,
          });
          continue;
        }
        const asset = await media.uploadAsset(req.user.id, {
          buffer: file.buffer,
          originalName: file.originalname || "upload",
          mimeType: file.mimetype || "application/octet-stream",
          folderId,
          name: file.originalname,
          duplicateAction,
          approvalStatus,
        });
        results.push({
          fileName: file.originalname,
          ok: true,
          skipped: "skipped" in asset ? !!asset.skipped : false,
          asset,
        });
      } catch (err) {
        if (err instanceof media.MediaDuplicateError) {
          results.push({
            fileName: file.originalname,
            ok: false,
            code: "DUPLICATE",
            error: err.message,
            duplicates: err.duplicates,
          });
        } else {
          results.push({
            fileName: file.originalname,
            ok: false,
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }
    }

    const uploaded = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    res.status(201).json({
      success: true,
      data: { results, uploaded, skipped, failed, total: files.length },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bulk upload failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function renameAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await media.renameAsset(req.user.id, id, String(req.body?.name || ""));
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function moveAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const folderId =
      req.body?.folderId === null || req.body?.folderId === ""
        ? null
        : req.body?.folderId
          ? String(req.body.folderId)
          : null;
    const asset = await media.moveAsset(req.user.id, id, folderId);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function deleteAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await media.deleteAsset(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function streamAssetFile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const download = req.query.download === "1" || req.query.download === "true";
    const { asset, stream } = await media.getAssetForDownload(req.user.id, id);
    if (download) {
      await media.recordDownload(req.user.id, id).catch(() => undefined);
    }
    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(asset.originalName || asset.name)}"`
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.pipe(res);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    if (!res.headersSent) {
      res.status(errStatus(message)).json({ success: false, error: message });
    }
  }
}

export async function sendWhatsAppMedia(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await media.sendMediaViaWhatsApp(req.user.id, {
      contactId: String(req.body?.contactId || ""),
      assetIds: Array.isArray(req.body?.assetIds) ? (req.body.assetIds as string[]) : [],
      caption: typeof req.body?.caption === "string" ? req.body.caption : undefined,
      kitId: req.body?.kitId ? String(req.body.kitId) : undefined,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listKits(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const kits = await media.listKits(req.user.id);
    res.json({ success: true, data: { kits } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function createKit(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const kit = await media.createKit(req.user.id, {
      name: String(req.body?.name || ""),
      description: req.body?.description ? String(req.body.description) : undefined,
      captionTemplate: req.body?.captionTemplate
        ? String(req.body.captionTemplate)
        : undefined,
      assetIds: Array.isArray(req.body?.assetIds) ? (req.body.assetIds as string[]) : [],
    });
    res.status(201).json({ success: true, data: { kit } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function deleteKit(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await media.deleteKit(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function sendKitWhatsApp(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await media.sendKitViaWhatsApp(req.user.id, {
      kitId: id,
      contactId: String(req.body?.contactId || ""),
      caption: typeof req.body?.caption === "string" ? req.body.caption : undefined,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listSendLogs(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await media.listMediaSendLogs(req.user.id, {
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 25,
      contactId: req.query.contactId ? String(req.query.contactId) : undefined,
    });
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

// ─── Phase 3 DAM endpoints ───────────────────────────────────────────────────

export async function smartCollections(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const collections = await dam.listSmartCollections(req.user.id);
    res.json({ success: true, data: { collections } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function collectionAssets(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
    const data = await dam.listCollectionAssets(
      req.user.id,
      key as dam.SmartCollectionKey,
      {
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 48,
      }
    );
    res.json({ success: true, data: { ...data, assets: data.items } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function recommendForContact(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const contactId = Array.isArray(req.params.contactId)
      ? req.params.contactId[0]
      : req.params.contactId;
    const data = await dam.recommendFilesForContact(req.user.id, contactId);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function aiSearch(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const q =
      (req.query.q ? String(req.query.q) : "") ||
      (req.body?.q ? String(req.body.q) : "") ||
      (req.body?.query ? String(req.body.query) : "");
    const data = await dam.aiSearchMedia(req.user.id, q);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function checkDuplicates(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const duplicates = await dam.findDuplicates(req.user.id, {
      contentHash: req.body?.contentHash ? String(req.body.contentHash) : undefined,
      originalName: req.body?.originalName ? String(req.body.originalName) : undefined,
      excludeAssetId: req.body?.excludeAssetId
        ? String(req.body.excludeAssetId)
        : undefined,
    });
    res.json({ success: true, data: { duplicates, hasDuplicates: duplicates.length > 0 } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function assetVersions(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await dam.listVersions(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function restoreAssetVersion(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const versionId = String(req.body?.versionId || req.params.versionId || "");
    const asset = await dam.restoreVersion(req.user.id, id, versionId);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function approveAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const status = String(req.body?.status || "approved") as
      | "approved"
      | "rejected"
      | "pending";
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }
    const asset = await dam.setApprovalStatus(
      req.user.id,
      id,
      status,
      req.body?.reason ? String(req.body.reason) : undefined
    );
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function setAssetExpiry(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const expiresAt =
      req.body?.expiresAt === null || req.body?.expiresAt === ""
        ? null
        : req.body?.expiresAt
          ? String(req.body.expiresAt)
          : null;
    const asset = await dam.setExpiry(req.user.id, id, expiresAt);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function archiveAssetCtrl(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await dam.archiveAsset(
      req.user.id,
      id,
      req.body?.reason ? String(req.body.reason) : undefined
    );
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function unarchiveAssetCtrl(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const asset = await dam.unarchiveAsset(req.user.id, id);
    res.json({ success: true, data: { asset } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function createShareLinkCtrl(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = await dam.createShareLink(req.user.id, id, {
      expiresInDays: req.body?.expiresInDays
        ? Number(req.body.expiresInDays)
        : 7,
      password: req.body?.password ? String(req.body.password) : undefined,
      maxDownloads: req.body?.maxDownloads
        ? Number(req.body.maxDownloads)
        : undefined,
    });
    res.status(201).json({ success: true, data: { link } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function listShareLinksCtrl(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const links = await dam.listShareLinks(req.user.id, id);
    res.json({ success: true, data: { links } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function revokeShareLinkCtrl(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const linkId = Array.isArray(req.params.linkId)
      ? req.params.linkId[0]
      : req.params.linkId;
    const data = await dam.revokeShareLink(req.user.id, linkId);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function assetTimeline(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await dam.getAssetTimeline(req.user.id, id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function storageDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await dam.getStorageDashboard(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function purgeDeleted(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const assetIds = Array.isArray(req.body?.assetIds)
      ? (req.body.assetIds as string[])
      : undefined;
    const data = await dam.purgeDeletedAssets(req.user.id, assetIds);
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function processExpiry(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    if (!(await media.canManageMedia(req.user.id))) {
      return res.status(403).json({ success: false, error: "Only Business Admin" });
    }
    const data = await dam.processExpiredMedia();
    res.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

/** Public share download (no auth) */
export async function publicShareFile(req: AuthenticatedRequest, res: Response) {
  try {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    const password =
      (req.query.password ? String(req.query.password) : "") ||
      (req.headers["x-share-password"]
        ? String(req.headers["x-share-password"])
        : "") ||
      (req.body?.password ? String(req.body.password) : "");
    const { asset, stream } = await dam.resolvePublicShare(token, {
      password: password || undefined,
    });
    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(asset.originalName || asset.name)}"`
    );
    res.setHeader("Cache-Control", "private, no-store");
    stream.pipe(res);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    const code = (e as { code?: string })?.code;
    if (code === "PASSWORD_REQUIRED") {
      return res.status(401).json({
        success: false,
        error: message,
        code: "PASSWORD_REQUIRED",
      });
    }
    if (!res.headersSent) {
      res.status(errStatus(message)).json({ success: false, error: message });
    }
  }
}

export async function publicShareMeta(req: AuthenticatedRequest, res: Response) {
  try {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    const { prisma } = await import("../lib/prisma.js");
    const row = await prisma.mediaShareLink.findFirst({
      where: { token, revokedAt: null },
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            originalName: true,
            mimeType: true,
            kind: true,
            sizeBytes: true,
          },
        },
      },
    });
    if (!row || !row.asset) {
      return res.status(404).json({ success: false, error: "Link not found" });
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ success: false, error: "Link expired" });
    }
    res.json({
      success: true,
      data: {
        name: row.asset.name,
        kind: row.asset.kind,
        sizeBytes: row.asset.sizeBytes,
        mimeType: row.asset.mimeType,
        hasPassword: !!row.passwordHash,
        expiresAt: row.expiresAt?.toISOString() || null,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}
