import { Router } from "express";
import multer from "multer";
import {
  getDashboardReports,
  exportCsv,
  exportPdf,
  exportXlsx,
  importCsv,
  importFile,
  previewImportCsv,
  previewImportFile,
  backupDb,
  restoreDb,
} from "@/controllers/report.controller";
import { requireAuth, requireRole } from "@/middleware/auth";

const router: Router = Router();

// Memory storage for CSV/Excel import (up to 25MB — Khammam-scale sheets)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const ok =
      name.endsWith(".csv") ||
      name.endsWith(".tsv") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".xlsm") ||
      (file.mimetype &&
        /csv|sheet|excel|spreadsheet|octet-stream|plain/.test(file.mimetype));
    if (ok) cb(null, true);
    else cb(new Error("Only CSV or Excel files are allowed"));
  },
});

router.get("/dashboard", requireAuth, getDashboardReports);
router.get("/export/csv", requireAuth, exportCsv);
router.get("/export/pdf", requireAuth, exportPdf);
router.get("/export/xlsx", requireAuth, exportXlsx);
router.post("/import/preview", requireAuth, upload.single("file"), previewImportFile);
router.post("/import/preview-csv", requireAuth, previewImportCsv);
router.post("/import/csv", requireAuth, importCsv);
router.post("/import/file", requireAuth, upload.single("file"), importFile);
router.get("/backup", requireAuth, requireRole(["admin"]), backupDb);
router.post("/restore", requireAuth, requireRole(["admin"]), restoreDb);

export default router;
