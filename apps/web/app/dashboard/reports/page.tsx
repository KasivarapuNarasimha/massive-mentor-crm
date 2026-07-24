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

  const exportCsv = async (type?: string) => {
    if (!token) return;
    const query = type ? `?type=${type}` : "";
    const url = `${API_BASE_URL}/reports/export/csv${query}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `export-${type || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch {
      toast.error("Export failed");
    }
  };

  const exportPdf = async (type?: string) => {
    if (!token) return;
    const query = type ? `?type=${type}` : "";
    const url = `${API_BASE_URL}/reports/export/pdf${query}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `export-${type || "all"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      toast.success("PDF exported");
    } catch {
      toast.error("Export failed");
    }
  };

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
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-2">Reports & Analytics</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Live charts for your workspace — never raw JSON. Empty series show &quot;No Data Available&quot;.
      </p>

      {/* Interactive charts (same engine as Overview analytics) */}
      <div className="mb-8" key={chartKey}>
        <AnalyticsDashboard />
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-4">Export</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => exportCsv("lead")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Leads CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv("client")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Clients CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv("deal")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Deals CSV
          </button>
          <button
            type="button"
            onClick={() => exportCsv()}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export All CSV
          </button>
          <button
            type="button"
            onClick={() => exportPdf("lead")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Leads PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf("client")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Clients PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf("deal")}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export Deals PDF
          </button>
          <button
            type="button"
            onClick={() => exportPdf()}
            className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation"
          >
            Export All PDF
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-4">Import Leads / Clients (CSV or Excel)</h3>
        <textarea
          value={importCsvText}
          onChange={(e) => setImportCsvText(e.target.value)}
          placeholder="Paste CSV here (header row required: name, phone, email, company…)"
          className="w-full h-32 bg-background border border-border rounded-xl p-3 mb-3 font-mono text-xs"
        />
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-wrap">
          <button
            type="button"
            onClick={importCsv}
            disabled={importing || !importCsvText}
            className="min-h-11 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl disabled:opacity-50 touch-manipulation"
          >
            {importing ? "Importing…" : "Import Text"}
          </button>
          <label
            className={`min-h-11 px-6 py-2.5 bg-white/10 rounded-xl cursor-pointer text-center flex items-center justify-center touch-manipulation ${importing ? "opacity-50 pointer-events-none" : ""}`}
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
        <p className="text-xs mt-2 text-muted-foreground">
          Prefer <span className="text-muted-foreground">Leads → Import</span> for the column-mapping wizard on
          large files. Large imports can take a few minutes.
        </p>

        {importReport && (
          <div className="mt-5 border border-border rounded-xl p-4 bg-background">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">Import Report</h4>
              {importReport.report && (
                <button
                  type="button"
                  onClick={downloadReport}
                  className="text-xs px-3 py-1 bg-white/10 rounded-lg"
                >
                  Download report
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-3">
              <div>
                <div className="text-muted-foreground text-xs">Parsed rows</div>
                <div className="text-xl font-semibold">{importReport.parsedRows}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Imported</div>
                <div className="text-xl font-semibold text-emerald-400">{importReport.imported}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Updated</div>
                <div className="text-xl font-semibold text-sky-400">{importReport.updated ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Duplicates</div>
                <div className="text-xl font-semibold text-amber-400">
                  {importReport.skippedDuplicates}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Failed</div>
                <div className="text-xl font-semibold text-red-400">{importReport.failed}</div>
              </div>
            </div>
            {importReport.errors && importReport.errors.length > 0 && (
              <ul className="mb-3 max-h-48 overflow-auto space-y-1.5 text-sm font-mono bg-card border border-border rounded-lg p-3">
                {importReport.errors.map((e, i) => (
                  <li key={`${e.row}-${i}`} className="text-red-300/90">
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
