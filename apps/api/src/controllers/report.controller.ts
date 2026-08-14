import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import {
  getReportsDashboard,
  importContactsFromCsv,
  importContactsFromFile,
  previewImportFromCsv,
  previewImportFromFile,
  exportModuleCsvStream,
  exportModulePdf,
  exportModuleXlsx,
  type ExportModule,
  type ExportFilters,
  type ImportReport,
  type ColumnMapping,
} from "../services/report.service.js";

export async function getDashboardReports(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const reports = await getReportsDashboard(req.user.id);
    res.json({ success: true, data: reports });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Failed to generate reports" });
  }
}

function parseExportFilters(req: AuthenticatedRequest): ExportFilters {
  return {
    search: req.query.search ? String(req.query.search) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    stage: req.query.stage ? String(req.query.stage) : undefined,
    assignedTo: req.query.assignedTo ? String(req.query.assignedTo) : undefined,
    sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
    sortDir: req.query.sortDir === "asc" ? "asc" : req.query.sortDir === "desc" ? "desc" : undefined,
  };
}

function resolveExportModule(type: unknown): ExportModule {
  const t = String(type || "leads").toLowerCase();
  const map: Record<string, ExportModule> = {
    lead: "leads",
    leads: "leads",
    client: "clients",
    clients: "clients",
    contact: "contacts",
    contacts: "contacts",
    deal: "deals",
    deals: "deals",
    task: "tasks",
    tasks: "tasks",
    meeting: "meetings",
    meetings: "meetings",
    document: "documents",
    documents: "documents",
    invoice: "invoices",
    invoices: "invoices",
    expense: "expenses",
    expenses: "expenses",
    payment: "payments",
    payments: "payments",
    activity: "activity",
    audit: "audit",
  };
  return map[t] || (t as ExportModule);
}

function attachmentDisposition(filename: string): string {
  // ASCII fallback + RFC 5987 UTF-8 filename* for browsers
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function exportCsv(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const type = req.query.type;
    const filters = parseExportFilters(req);
    const module = resolveExportModule(type || "leads");
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${module}-export-${stamp}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", attachmentDisposition(filename));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Stream body so large exports do not double-buffer the whole file
    await exportModuleCsvStream(req.user.id, module, filters, res);
  } catch (error: unknown) {
    console.error("CSV export error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to export",
      });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function exportXlsx(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const module = resolveExportModule(req.query.type || "leads");
    const filters = parseExportFilters(req);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${module}-export-${stamp}.xlsx`;
    const buf = await exportModuleXlsx(req.user.id, module, filters);
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new Error("Invalid XLSX buffer generated (not a real OOXML workbook)");
    }
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", attachmentDisposition(filename));
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).end(buf);
  } catch (error: unknown) {
    console.error("XLSX export error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to export Excel",
      });
    }
  }
}

function parseMappingsBody(raw: unknown): ColumnMapping[] | undefined {
  if (!raw) return undefined;
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (m): m is ColumnMapping =>
        m &&
        typeof m === "object" &&
        typeof (m as ColumnMapping).sourceHeader === "string" &&
        typeof (m as ColumnMapping).fieldKey === "string"
    )
    .map((m) => ({ sourceHeader: m.sourceHeader, fieldKey: m.fieldKey }));
}

function respondImport(res: Response, result: ImportReport) {
  // Mapping wizard required — not an error; client should show mapping UI
  if (result.needsMapping) {
    return res.status(422).json({
      success: false,
      error: result.errors[0]?.reason || "Column mapping required",
      data: result,
      needsMapping: true,
    });
  }
  // Success when anything was written (create or update)
  if (result.imported > 0 || (result.updated ?? 0) > 0) {
    return res.json({ success: true, data: result });
  }
  return res.status(400).json({
    success: false,
    error:
      result.parsedRows === 0
        ? "No rows could be parsed from the file. Use CSV or Excel with a header row."
        : result.skippedDuplicates > 0 && result.failed === 0
          ? "No new records — all rows matched existing contacts (duplicates skipped)."
          : "Import completed with zero inserts. See report for details.",
    data: result,
  });
}

/** Preview file headers + suggested CRM field mappings (mapping wizard) */
export async function previewImportFile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Attach a CSV or Excel (.xlsx) file.",
      });
    }
    const preview = await previewImportFromFile(
      req.user.id,
      file.buffer,
      file.originalname || "upload.csv"
    );
    return res.json({ success: true, data: preview });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to preview import";
    console.error("[previewImportFile] error:", error);
    res.status(500).json({ success: false, error: msg });
  }
}

/** Preview paste-CSV mappings */
export async function previewImportCsv(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { csv } = req.body as { csv?: string };
    if (!csv || typeof csv !== "string" || !csv.trim()) {
      return res.status(400).json({ success: false, error: "CSV text is required" });
    }
    const preview = await previewImportFromCsv(req.user.id, csv);
    return res.json({ success: true, data: preview });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to preview import";
    console.error("[previewImportCsv] error:", error);
    res.status(500).json({ success: false, error: msg });
  }
}

/** JSON body import (paste text or small CSV string) */
export async function importCsv(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const body = req.body as {
      csv?: string;
      mappings?: ColumnMapping[] | string;
      saveMapping?: boolean;
      updateExisting?: boolean;
    };
    const { csv } = body;
    if (!csv || typeof csv !== "string" || !csv.trim()) {
      return res.status(400).json({ success: false, error: "CSV text is required" });
    }
    const result = await importContactsFromCsv(req.user.id, csv, {
      mappings: parseMappingsBody(body.mappings),
      saveMapping: body.saveMapping === true,
      updateExisting: body.updateExisting !== false,
    });
    return respondImport(res, result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to import";
    console.error("[importCsv] error:", error);
    res.status(500).json({ success: false, error: msg });
  }
}

/** Multipart file import (CSV / Excel) — preferred path for real files */
export async function importFile(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Attach a CSV or Excel (.xlsx) file.",
      });
    }
    const filename = file.originalname || "upload.xlsx";
    const mappings = parseMappingsBody(req.body?.mappings);
    const saveMapping =
      req.body?.saveMapping === true ||
      req.body?.saveMapping === "true" ||
      req.body?.saveMapping === "1";
    const updateExisting =
      req.body?.updateExisting !== false &&
      req.body?.updateExisting !== "false" &&
      req.body?.updateExisting !== "0";
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[importFile] user=${req.user.id} file=${filename} size=${file.buffer.length} bytes mappings=${mappings?.length ?? 0}`
      );
    }
    const result = await importContactsFromFile(req.user.id, file.buffer, filename, {
      mappings,
      saveMapping,
      updateExisting,
    });
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[importFile] parsed=${result.parsedRows} imported=${result.imported} updated=${result.updated} dupes=${result.skippedDuplicates} failed=${result.failed} needsMapping=${!!result.needsMapping}`
      );
    }
    return respondImport(res, result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to import file";
    console.error("[importFile] error:", error);
    res.status(500).json({ success: false, error: msg });
  }
}

export async function backupDb(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    // Simple backup stub: return user data summary (real would pg_dump or prisma export)
    const backup = { timestamp: new Date().toISOString(), userId: req.user.id, note: "Demo backup - contacts, deals etc would be dumped here." };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="backup-${req.user.id}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Backup failed" });
  }
}

export async function restoreDb(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    // Demo restore - accept json, in real would validate and insert
    res.json({ success: true, message: "Restore demo success (no real DB change)" });
  } catch (error: unknown) {
    res.status(500).json({ success: false, error: "Restore failed" });
  }
}

export async function exportPdf(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const type = req.query.type;
    const filters = parseExportFilters(req);
    const module = resolveExportModule(type || "leads");
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${module}-export-${stamp}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", attachmentDisposition(filename));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    await exportModulePdf(req.user.id, module, filters, res);
  } catch (error: unknown) {
    console.error("PDF export error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to export PDF",
      });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}
