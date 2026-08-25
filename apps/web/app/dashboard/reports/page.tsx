"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";
import { useDataVersion } from "@/lib/data-events";
import { AnalyticsDashboard } from "@/components/dashboard/AnalyticsDashboard";

type ImportReportData = {
  parsedRows: number;
  imported: number;
  updated?: number;
  skippedDuplicates: number;
  failed: number;
  skippedEmpty?: number;
  errors?: { row: number; column?: string; reason: string; suggestedFix?: string }[];
  report?: string;
  allowedStatuses?: string[];
  needsMapping?: boolean;
};

function formatImportError(e: {
  row: number;
  column?: string;
  reason: string;
  suggestedFix?: string;
}): string {
  if (e.reason.toLowerCase().startsWith("row ")) return e.reason;
  const base = `Row ${e.row}: ${e.reason}`;
  return e.suggestedFix ? `${base} → ${e.suggestedFix}` : base;
}

export default function ReportsPage() {
  const { token } = useAuth();
  const dataVersion = useDataVersion();
  const [importCsvText, setImportCsvText] = useState("");
  const [importReport, setImportReport] = useState<ImportReportData | null>(null);
  const [importing, setImporting] = useState(false);
  // Force remount of analytics when CRM data changes
  const [chartKey, setChartKey] = useState(0);

  useEffect(() => {
    setChartKey((k) => k + 1);
  }, [dataVersion]);

  const showImportResult = (
    data: ImportReportData | undefined | null,
    success: boolean,
    errorMsg?: string
  ) => {
    if (data) setImportReport(data);
    const preview = (data?.errors || []).slice(0, 3).map(formatImportError).join(" · ");
    const written = (data?.imported ?? 0) + (data?.updated ?? 0);
    if (data?.needsMapping) {
      toast.message("Map your CSV columns", {
        description:
          data.errors?.[0]?.reason ||
          "Open Leads → Import to use the column mapping wizard, or rename headers (Name, Phone, Email…).",
        duration: 12000,
      });
      return;
    }
    if (success && data && written > 0) {
      toast.success(
        `${written.toLocaleString()} record${written === 1 ? "" : "s"} imported successfully`,
        {
          description:
            data.failed > 0
              ? `${data.failed} failed. ${preview}`
              : `Duplicates skipped: ${data.skippedDuplicates}`,
          duration: 8000,
        }
      );
      setChartKey((k) => k + 1);
    } else {
      toast.error(errorMsg || "Import did not insert any records", {
        description:
          preview ||
          data?.report?.split("\n").slice(0, 4).join(" · ") ||
          "Check the Import Report below.",
        duration: 12000,
      });
    }
  };

  const downloadExport = async (format: "csv" | "pdf" | "xlsx", type?: string) => {
    if (!token) return;
    const q = new URLSearchParams();
    if (type) q.set("type", type);
    const url = `${API_BASE_URL}/reports/export/${format}${q.toString() ? `?${q}` : ""}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            format === "csv"
              ? "text/csv"
              : format === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/pdf",
        },
      });
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok || contentType.includes("application/json")) {
        const err = await response.json().catch(() => ({}));
        toast.error((err as { error?: string }).error || `Export ${format} failed`);
        return;
      }
      const buf = await response.arrayBuffer();
      if (!buf.byteLength) {
        toast.error("Export returned an empty file");
        return;
      }
      const u8 = new Uint8Array(buf);
      if (format === "xlsx" && !(u8[0] === 0x50 && u8[1] === 0x4b)) {
        toast.error("Invalid Excel file received");
        return;
      }
      if (format === "pdf" && !(u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46)) {
        toast.error("Invalid PDF file received");
        return;
      }
      const mime =
        format === "csv"
          ? "text/csv;charset=utf-8"
          : format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
      const cd = response.headers.get("content-disposition") || "";
      const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
      const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
      let filename = `${type || "export"}-export.${format}`;
      try {
        if (star?.[1]) filename = decodeURIComponent(star[1].trim());
        else if (plain?.[1]) filename = plain[1].trim().replace(/^["']|["']$/g, "");
      } catch {
        /* keep default */
      }
      if (!filename.toLowerCase().endsWith(`.${format}`)) {
        filename = `${filename.replace(/\.[^.]+$/, "")}.${format}`;
      }
      const blob = new Blob([buf], { type: mime });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      toast.success(`${format.toUpperCase()} exported`);
    } catch {
      toast.error("Export failed");
    }
  };

  const exportCsv = async (type?: string) => downloadExport("csv", type);
  const exportPdf = async (type?: string) => downloadExport("pdf", type);

  const importCsv = async () => {
    if (!importCsvText || !token) return;
    setImporting(true);
    const res = await api.post<ImportReportData>(
      "/reports/import/csv",
      { csv: importCsvText },
      token
    );
    const data = (res.data || null) as ImportReportData | null;
    const written = (data?.imported ?? 0) + (data?.updated ?? 0);
    showImportResult(data, !!res.success && written > 0, res.error);
    if (res.success && written > 0) setImportCsvText("");
    setImporting(false);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setImporting(true);
    toast.message(`Importing ${file.name}…`);
    const res = await api.importContactsFile(file, token);
    const data = (res.data || null) as ImportReportData | null;
    const written = (data?.imported ?? 0) + (data?.updated ?? 0);
    showImportResult(data, !!res.success && written > 0, res.error);
    setImporting(false);
    e.target.value = "";
  };

  const downloadReport = () => {
    if (!importReport?.report) return;
    const blob = new Blob([importReport.report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <h1 className="mm-page-title mb-1">Reports & Analytics</h1>
      <p className="mm-secondary mb-4">
        Live charts for your workspace — never raw JSON. Empty series show &quot;No Data Available&quot;.
      </p>

      <div className="mb-4" key={chartKey}>
        <AnalyticsDashboard />
      </div>

      <div className="mm-card p-4 sm:p-5 mb-4">
        <h3 className="text-sm font-semibold mb-3">Export</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportCsv("lead")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Leads CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv("client")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Clients CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv("deal")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Deals CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv()}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export All CSV
          </button>
          <button
            type="button"
            onClick={() => exportPdf("lead")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Leads PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf("client")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Clients PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf("deal")}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export Deals PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf()}
            className="mm-btn mm-btn-secondary h-9 touch-manipulation"
          >
            Export All PDF
          </button>
        </div>
      </div>

      <div className="mm-card p-4 sm:p-5 mb-4">
        <h3 className="text-sm font-semibold mb-3">Import Leads / Clients (CSV or Excel)</h3>
        <textarea
          value={importCsvText}
          onChange={(e) => setImportCsvText(e.target.value)}
          placeholder="Paste CSV here (header row required: name, phone, email, company…)"
          className="mm-input h-32 mb-3 font-mono text-xs"
        />
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center flex-wrap">
          <button
            type="button"
            onClick={importCsv}
            disabled={importing || !importCsvText}
            className={`mm-btn mm-btn-primary h-9 touch-manipulation ${importing ? "mm-btn-loading" : ""}`}
          >
            {importing ? "Importing…" : "Import Text"}
          </button>
          <label
            className={`mm-btn mm-btn-secondary h-9 cursor-pointer touch-manipulation ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            Import File (CSV / Excel)
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileImport}
              className="hidden"
              disabled={importing}
            />
          </label>
        </div>
        <p className="mm-secondary mt-2">
          Prefer <span className="text-foreground">Leads → Import</span> for the column-mapping wizard on
          large files. Large imports can take a few minutes.
        </p>

        {importReport && (
          <div className="mt-4 rounded-lg border border-border p-3.5 bg-muted/40">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Import Report</h4>
              {importReport.report && (
                <button
                  type="button"
                  onClick={downloadReport}
                  className="mm-btn mm-btn-ghost h-8 min-h-8 px-2.5 text-xs"
                >
                  Download report
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-3">
              <div>
                <div className="mm-secondary">Parsed rows</div>
                <div className="text-lg font-semibold tabular-nums">{importReport.parsedRows}</div>
              </div>
              <div>
                <div className="mm-secondary">Imported</div>
                <div className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{importReport.imported}</div>
              </div>
              <div>
                <div className="mm-secondary">Updated</div>
                <div className="text-lg font-semibold tabular-nums text-foreground">{importReport.updated ?? 0}</div>
              </div>
              <div>
                <div className="mm-secondary">Duplicates</div>
                <div className="text-lg font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {importReport.skippedDuplicates}
                </div>
              </div>
              <div>
                <div className="mm-secondary">Failed</div>
                <div className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">{importReport.failed}</div>
              </div>
            </div>
            {importReport.errors && importReport.errors.length > 0 && (
              <ul className="mb-1 max-h-48 overflow-auto space-y-1.5 text-xs font-mono bg-card border border-border rounded-lg p-3">
                {importReport.errors.map((e, i) => (
                  <li key={`${e.row}-${i}`} className="text-red-600 dark:text-red-400">
                    {formatImportError(e)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
