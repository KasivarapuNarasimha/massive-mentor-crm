"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { useDataVersion } from "@/lib/data-events";

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

function formatImportError(e: { row: number; column?: string; reason: string; suggestedFix?: string }): string {
  if (e.reason.toLowerCase().startsWith("row ")) return e.reason;
  const base = `Row ${e.row}: ${e.reason}`;
  return e.suggestedFix ? `${base} → ${e.suggestedFix}` : base;
}

const MONEY_KEYS =
  /revenue|value|amount|invoic|expense|profit|paid|outstanding|tax|gst|pipeline|payment|cost|forecast/i;

export default function ReportsPage() {
  const { token, role } = useAuth();
  const { money } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const [reports, setReports] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importCsvText, setImportCsvText] = useState("");
  const [importReport, setImportReport] = useState<ImportReportData | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    if (!token) return;
    setIsLoading(true);
    const res = await api.get("/reports/dashboard", token);
    if (res.success) setReports(res.data);
    setIsLoading(false);
  };

  // Refresh when Lead/Deal/CRM data changes (pipeline sync, etc.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token, dataVersion]);

  const showImportResult = (data: ImportReportData | undefined | null, success: boolean, errorMsg?: string) => {
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
        `Imported ${data.imported}${data.updated ? ` · Updated ${data.updated}` : ""} of ${data.parsedRows}`,
        {
          description:
            data.failed > 0
              ? `${data.failed} failed. ${preview}`
              : `Duplicates skipped: ${data.skippedDuplicates}`,
          duration: 8000,
        }
      );
      load();
    } else {
      toast.error(errorMsg || "Import did not insert any records", {
        description: preview || data?.report?.split("\n").slice(0, 4).join(" · ") || "Check the Import Report below.",
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
    if (!importCsvText) return;
    if (!token) return;
    setImporting(true);
    const res = await api.post<ImportReportData>("/reports/import/csv", { csv: importCsvText }, token);
    const data = (res.data || null) as ImportReportData | null;
    showImportResult(data, !!res.success && (data?.imported ?? 0) > 0, res.error);
    if (res.success && (data?.imported ?? 0) > 0) setImportCsvText("");
    setImporting(false);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setImporting(true);
    toast.message(`Parsing ${file.name}…`);
    const res = await api.importContactsFile(file, token);
    const data = (res.data || null) as ImportReportData | null;
    showImportResult(data, !!res.success && (data?.imported ?? 0) > 0, res.error);
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

  const doBackup = async () => {
    if (!token) return;
    const res = await api.get("/reports/backup", token);
    if (res.success) {
      const blob = new Blob([JSON.stringify(res.data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "db-backup.json";
      a.click();
      toast.success("Backup downloaded");
    } else toast.error("Backup failed");
  };

  const doRestore = async () => {
    if (!token) return;
    const res = await api.post("/reports/restore", {}, token);
    if (res.success) toast.success("Restore completed");
    else toast.error("Restore failed");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold mb-5 sm:mb-6">Reports & Analytics</h1>

      {isLoading ? (
        <div className="h-96 bg-zinc-900 rounded-2xl animate-pulse" />
      ) : !!reports ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6 sm:mb-8">
          {Object.entries(reports as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 sm:p-4 min-w-0">
              <div className="text-[10px] sm:text-xs text-zinc-500 leading-snug">
                {k.replace(/([A-Z])/g, " $1")}
              </div>
              <div className="text-lg sm:text-2xl font-semibold tabular-nums truncate">
                {typeof v === "number"
                  ? MONEY_KEYS.test(k)
                    ? money(v)
                    : v.toLocaleString()
                  : JSON.stringify(v)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-2">Workspace analytics</h3>
        <p className="text-xs text-zinc-500">
          KPI cards above use live data from your business workspace only. Open Overview for full
          role-based charts and drill-down analytics.
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-4">Export</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 sm:gap-3">
          <button type="button" onClick={() => exportCsv("lead")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Leads CSV</button>
          <button type="button" onClick={() => exportCsv("client")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Clients CSV</button>
          <button type="button" onClick={() => exportCsv("deal")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Deals CSV</button>
          <button type="button" onClick={() => exportCsv()} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export All CSV</button>
          <button type="button" onClick={() => exportPdf("lead")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Leads PDF</button>
          <button type="button" onClick={() => exportPdf("client")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Clients PDF</button>
          <button type="button" onClick={() => exportPdf("deal")} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export Deals PDF</button>
          <button type="button" onClick={() => exportPdf()} className="min-h-11 px-5 py-2.5 bg-white/10 rounded-xl text-sm touch-manipulation">Export All PDF</button>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-4">Import Leads / Clients (CSV or Excel)</h3>
        <textarea
          value={importCsvText}
          onChange={(e) => setImportCsvText(e.target.value)}
          placeholder="Paste CSV here (header row required: name, phone, email, company…)"
          className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-3 mb-3 font-mono text-xs"
        />
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-wrap">
          <button
            type="button"
            onClick={importCsv}
            disabled={importing || !importCsvText}
            className="min-h-11 px-6 py-2.5 bg-white text-zinc-950 rounded-xl disabled:opacity-50 touch-manipulation"
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
        <p className="text-xs mt-2 text-zinc-500">
          Supports CSV and Excel (.xlsx). Required: <span className="text-zinc-300">name</span>. Optional: phone, email,
          company, status, value, source, type, description, district, group. Status accepts labels or keys (e.g.{" "}
          <span className="font-mono text-zinc-400">New</span> → <span className="font-mono text-zinc-400">new</span>
          ). Success only when rows are actually inserted.
        </p>

        {importReport && (
          <div className="mt-5 border border-zinc-700 rounded-xl p-4 bg-zinc-950">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">Import Report</h4>
              {importReport.report && (
                <button onClick={downloadReport} className="text-xs px-3 py-1 bg-white/10 rounded-lg">
                  Download report
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-3">
              <div>
                <div className="text-zinc-500 text-xs">Parsed rows</div>
                <div className="text-xl font-semibold">{importReport.parsedRows}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Imported</div>
                <div className="text-xl font-semibold text-emerald-400">{importReport.imported}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Updated existing</div>
                <div className="text-xl font-semibold text-sky-400">{importReport.updated ?? 0}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Duplicates skipped</div>
                <div className="text-xl font-semibold text-amber-400">{importReport.skippedDuplicates}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-xs">Failed rows</div>
                <div className="text-xl font-semibold text-red-400">{importReport.failed}</div>
              </div>
            </div>
            {importReport.allowedStatuses && importReport.allowedStatuses.length > 0 && (
              <p className="text-xs text-zinc-500 mb-2">
                Allowed status values:{" "}
                <span className="font-mono text-zinc-400">{importReport.allowedStatuses.join(", ")}</span>
              </p>
            )}
            {importReport.errors && importReport.errors.length > 0 && (
              <ul className="mb-3 max-h-48 overflow-auto space-y-1.5 text-sm font-mono bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                {importReport.errors.map((e, i) => (
                  <li key={`${e.row}-${i}`} className="text-red-300/90">
                    {formatImportError(e)}
                    {e.column ? (
                      <span className="ml-2 text-[10px] uppercase text-zinc-500">[{e.column}]</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {importReport.report && (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer hover:text-zinc-300">Full report text</summary>
                <pre className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap font-mono bg-zinc-900 rounded-lg p-3 max-h-40 overflow-auto">
                  {importReport.report}
                </pre>
              </details>
            )}
            {importReport.imported > 0 && (
              <p className="mt-3 text-sm text-emerald-400">
                Leads were inserted into the database. Open the Leads page to see them.
              </p>
            )}
          </div>
        )}
      </div>

      {(role === "admin") && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-semibold mb-4">Database (Admin)</h3>
          <div className="flex gap-3">
            <button onClick={doBackup} className="px-5 py-2 bg-white/10 rounded-xl">Backup DB</button>
            <button onClick={doRestore} className="px-5 py-2 bg-white/10 rounded-xl">Restore DB</button>
          </div>
          <p className="text-xs text-zinc-500 mt-2">Admin only. Real backup would use pg_dump.</p>
        </div>
      )}
    </div>
  );
}
