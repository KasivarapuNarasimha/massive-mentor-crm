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

const router: Router = Router();

router.use(requireAuth);

router.get("/folders", listFolders);
router.post("/folders", createFolder);
router.patch("/folders/:id", renameFolder);
router.delete("/folders/:id", deleteFolder);

router.get("/stats", mediaStats);
router.get("/count", mediaCount);

router.get("/assets", listAssets);
router.post("/assets", mediaUpload, uploadAsset);
router.get("/assets/:id", assetDetail);
router.patch("/assets/:id", renameAsset);
router.post("/assets/:id/move", moveAsset);
router.post("/assets/:id/favorite", toggleFavorite);
router.post("/assets/:id/tags", updateTags);
router.post("/assets/:id/download", recordDownload);
router.delete("/assets/:id", deleteAsset);
router.get("/assets/:id/file", streamAssetFile);

router.post("/send/whatsapp", sendWhatsAppMedia);

router.get("/kits", listKits);
router.post("/kits", createKit);
router.delete("/kits/:id", deleteKit);
router.post("/kits/:id/send/whatsapp", sendKitWhatsApp);

router.get("/activity", listSendLogs);

export default router;
