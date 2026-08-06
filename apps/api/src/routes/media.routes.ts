import { Router } from "express";
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
} from "../controllers/media.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router: Router = Router();

router.use(requireAuth);

router.get("/folders", listFolders);
router.post("/folders", createFolder);
router.patch("/folders/:id", renameFolder);
router.delete("/folders/:id", deleteFolder);

router.get("/assets", listAssets);
router.post("/assets", upload.single("file"), uploadAsset);
router.patch("/assets/:id", renameAsset);
router.post("/assets/:id/move", moveAsset);
router.delete("/assets/:id", deleteAsset);
router.get("/assets/:id/file", streamAssetFile);

router.post("/send/whatsapp", sendWhatsAppMedia);

router.get("/kits", listKits);
router.post("/kits", createKit);
router.delete("/kits/:id", deleteKit);
router.post("/kits/:id/send/whatsapp", sendKitWhatsApp);

router.get("/activity", listSendLogs);

export default router;
