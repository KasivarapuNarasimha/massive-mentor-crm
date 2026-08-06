import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import * as media from "../services/media.service.js";

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
    const assets = await media.listAssets(req.user.id, {
      folderId: req.query.folderId != null ? String(req.query.folderId) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      kind: req.query.kind ? String(req.query.kind) : undefined,
    });
    res.json({ success: true, data: { assets } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed";
    res.status(errStatus(message)).json({ success: false, error: message });
  }
}

export async function uploadAsset(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    // Multer may set LIMIT_FILE_SIZE on the request via error middleware; also guard here
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
    const asset = await media.uploadAsset(req.user.id, {
      buffer: file.buffer,
      originalName: file.originalname || "upload",
      mimeType: file.mimetype || "application/octet-stream",
      folderId: req.body?.folderId ? String(req.body.folderId) : null,
      name: req.body?.name ? String(req.body.name) : undefined,
      captionDefault: req.body?.captionDefault ? String(req.body.captionDefault) : undefined,
    });
    res.status(201).json({
      success: true,
      data: {
        asset: {
          ...asset,
          // Explicit size metadata for reporting UIs
          sizeBytes: asset.sizeBytes,
          sizeMb: Math.round((asset.sizeBytes / (1024 * 1024)) * 100) / 100,
        },
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload failed";
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
    const { asset, stream } = await media.getAssetForDownload(req.user.id, id);
    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(asset.originalName || asset.name)}"`
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
