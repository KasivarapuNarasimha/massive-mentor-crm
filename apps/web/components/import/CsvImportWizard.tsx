"use client";

import { useEffect, useMemo, useState } from "react";

export type CrmImportField = {
  key: string;
  label: string;
  required: boolean;
};

export type ColumnSuggestion = {
  sourceHeader: string;
  fieldKey: string | null;
  confidence: "high" | "medium" | "low" | "none";
  sampleValues: string[];
};

export type ImportPreview = {
  headers: string[];
  sampleRows: Record<string, string>[];
  parsedRows: number;
  suggestions: ColumnSuggestion[];
  crmFields: CrmImportField[];
  nameMapped: boolean;
  phoneMapped: boolean;
  emailMapped: boolean;
  needsWizard: boolean;
  allowedStatuses: string[];
  autoMappings: Array<{ sourceHeader: string; fieldKey: string }>;
  message?: string;
};

export type ColumnMapping = { sourceHeader: string; fieldKey: string };

type Props = {
  open: boolean;
  filename: string;
  preview: ImportPreview;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    mappings: ColumnMapping[];
    saveMapping: boolean;
    updateExisting: boolean;
  }) => void;
};

const SKIP = "__skip";

export function CsvImportWizard({
  open,
  filename,
  preview,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const initialMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of preview.suggestions) {
      m[s.sourceHeader] = s.fieldKey || SKIP;
    }
    return m;
  }, [preview]);

  const [fieldByHeader, setFieldByHeader] = useState<Record<string, string>>(initialMap);
  const [saveMapping, setSaveMapping] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);

  // Reset when preview changes
  useEffect(() => {
    setFieldByHeader(initialMap);
  }, [initialMap]);

  if (!open) return null;

  const nameOk = Object.values(fieldByHeader).includes("name");

  const confColor = (c: ColumnSuggestion["confidence"]) => {
    if (c === "high") return "text-emerald-400";
    if (c === "medium") return "text-amber-400";
    if (c === "low") return "text-orange-400";
    return "text-zinc-500";
  };

  const handleConfirm = () => {
    const mappings: ColumnMapping[] = Object.entries(fieldByHeader)
      .filter(([, fieldKey]) => fieldKey && fieldKey !== SKIP)
      .map(([sourceHeader, fieldKey]) => ({ sourceHeader, fieldKey }));
    onConfirm({ mappings, saveMapping, updateExisting });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col bg-zinc-950 border border-zinc-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Map CSV columns</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {filename} · {preview.parsedRows} row(s) detected
              {preview.allowedStatuses?.length ? (
                <>
                  {" "}
                  · Status values:{" "}
                  <span className="font-mono text-zinc-400">
                    {preview.allowedStatuses.join(", ")}
                  </span>
                </>
              ) : null}
            </p>
            {preview.message && (
              <p className="text-sm text-amber-300/90 mt-2">{preview.message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-white text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="text-xs text-zinc-500 mb-3">
            We auto-matched columns from Zoho, HubSpot, Salesforce, Excel, and Google Sheets
            exports. Confirm or change the mapping before importing.
          </p>

          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium">CSV column</th>
                  <th className="text-left px-3 py-2.5 font-medium">CRM field</th>
                  <th className="text-left px-3 py-2.5 font-medium hidden sm:table-cell">
                    Sample
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.suggestions.map((s) => (
                  <tr key={s.sourceHeader} className="border-t border-zinc-800/80">
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-zinc-200">{s.sourceHeader}</div>
                      <div className={`text-[10px] mt-0.5 ${confColor(s.confidence)}`}>
                        {s.confidence === "none" ? "unmapped" : `${s.confidence} confidence`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <select
                        value={fieldByHeader[s.sourceHeader] || SKIP}
                        onChange={(e) =>
                          setFieldByHeader((prev) => ({
                            ...prev,
                            [s.sourceHeader]: e.target.value,
                          }))
                        }
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                      >
                        <option value={SKIP}>— Skip —</option>
                        {preview.crmFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs text-zinc-500 font-mono hidden sm:table-cell">
                      {s.sampleValues.slice(0, 2).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!nameOk && (
            <p className="mt-3 text-sm text-red-400">
              Map at least one column to <strong>Lead Name</strong> to continue.
            </p>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-3 text-sm text-zinc-400">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveMapping}
                onChange={(e) => setSaveMapping(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Save mapping for future imports
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="rounded border-zinc-600"
              />
              Update existing contacts (match phone/email)
            </label>
          </div>

          {preview.sampleRows.length > 0 && (
            <details className="mt-4 text-xs text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">Preview first rows</summary>
              <pre className="mt-2 max-h-32 overflow-auto bg-zinc-900 rounded-lg p-3 font-mono text-zinc-400">
                {JSON.stringify(preview.sampleRows.slice(0, 3), null, 2)}
              </pre>
            </details>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !nameOk}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-white text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
          >
            {busy ? "Importing…" : `Import ${preview.parsedRows} row(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
