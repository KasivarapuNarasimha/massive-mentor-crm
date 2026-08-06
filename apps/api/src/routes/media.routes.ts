import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  listAssets,
  uploadAsset,
  bulkUploadAssets,
  renameAsset,
  moveAsset,
  deleteAsset,
  streamAssetFile,
  sendWhatsAppMedia,
  listKits,
  createKit,
  deleteKit,
  sendKitWhatsApp,
  listSendLogs,
  mediaStats,
  mediaCount,
  assetDetail,
  toggleFavorite,
  updateTags,
  recordDownload,
  smartCollections,
  collectionAssets,
  recommendForContact,
  aiSearch,
  checkDuplicates,
  assetVersions,
  restoreAssetVersion,
  approveAsset,
  setAssetExpiry,
  archiveAssetCtrl,
  unarchiveAssetCtrl,
  createShareLinkCtrl,
  listShareLinksCtrl,
  revokeShareLinkCtrl,
  assetTimeline,
  storageDashboard,
  purgeDeleted,
  processExpiry,
  publicShareFile,
  publicShareMeta,
} from "../controllers/media.controller.js";
import {
  MEDIA_MAX_BYTES,
  MEDIA_SIZE_LIMIT_MESSAGE,
} from "../services/media-storage.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_MAX_BYTES }, // 25 MB
});

/** Map multer LIMIT_FILE_SIZE to a clear 400 for the client */
function mediaUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: MEDIA_SIZE_LIMIT_MESSAGE,
      });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    return res.status(400).json({ success: false, error: message });
  });
}

function mediaBulkUpload(req: Request, res: Response, next: NextFunction) {
  upload.array("files", 50)(req, res, (err: unknown) => {
    if (!err) return next();
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: MEDIA_SIZE_LIMIT_MESSAGE,
      });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    return res.status(400).json({ success: false, error: message });
  });
}

const router: Router = Router();

// Public share links (no auth) — registered before requireAuth
router.get("/public/:token/meta", publicShareMeta);
router.get("/public/:token", publicShareFile);
router.post("/public/:token", publicShareFile);

router.use(requireAuth);

router.get("/folders", listFolders);
router.post("/folders", createFolder);
router.patch("/folders/:id", renameFolder);
router.delete("/folders/:id", deleteFolder);

router.get("/stats", mediaStats);
router.get("/count", mediaCount);
router.get("/storage", storageDashboard);
router.post("/storage/purge", purgeDeleted);
router.post("/storage/process-expiry", processExpiry);

router.get("/collections", smartCollections);
router.get("/collections/:key", collectionAssets);

router.get("/recommend/:contactId", recommendForContact);
router.get("/ai-search", aiSearch);
router.post("/ai-search", aiSearch);
router.post("/duplicates/check", checkDuplicates);

router.get("/assets", listAssets);
router.post("/assets", mediaUpload, uploadAsset);
router.post("/assets/bulk", mediaBulkUpload, bulkUploadAssets);
router.get("/assets/:id", assetDetail);
router.patch("/assets/:id", renameAsset);
router.post("/assets/:id/move", moveAsset);
router.post("/assets/:id/favorite", toggleFavorite);
router.post("/assets/:id/tags", updateTags);
router.post("/assets/:id/download", recordDownload);
router.post("/assets/:id/approve", approveAsset);
router.post("/assets/:id/expiry", setAssetExpiry);
router.post("/assets/:id/archive", archiveAssetCtrl);
router.post("/assets/:id/unarchive", unarchiveAssetCtrl);
router.get("/assets/:id/versions", assetVersions);
router.post("/assets/:id/versions/restore", restoreAssetVersion);
router.get("/assets/:id/timeline", assetTimeline);
router.get("/assets/:id/share-links", listShareLinksCtrl);
router.post("/assets/:id/share-links", createShareLinkCtrl);
router.delete("/assets/:id", deleteAsset);
router.get("/assets/:id/file", streamAssetFile);

router.delete("/share-links/:linkId", revokeShareLinkCtrl);

router.post("/send/whatsapp", sendWhatsAppMedia);

router.get("/kits", listKits);
router.post("/kits", createKit);
router.delete("/kits/:id", deleteKit);
router.post("/kits/:id/send/whatsapp", sendKitWhatsApp);

router.get("/activity", listSendLogs);

export default router;
