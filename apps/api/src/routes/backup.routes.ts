import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import * as ctrl from "@/controllers/backup.controller";

const router = Router();

/** Business Admin — own tenant backups only (no cross-tenant access) */
router.get("/", requireAuth, ctrl.tenantListBackups);
router.post("/", requireAuth, ctrl.tenantCreateBackup);
router.get("/:id/download", requireAuth, ctrl.tenantDownloadBackup);
router.post("/:id/restore", requireAuth, ctrl.tenantRequestRestore);
router.post("/restores/:restoreId/confirm", requireAuth, ctrl.tenantConfirmRestore);

export default router;
