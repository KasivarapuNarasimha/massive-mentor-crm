"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";

export type ExportModuleType =
  | "leads"
  | "clients"
  | "deals"
  | "tasks"
  | "meetings"
  | "documents"
  | "invoices"
  | "expenses"
  | "payments"
  | "activity"
  | "audit";

type Props = {
  module: ExportModuleType;
  token: string | null | undefined;
  /** Controlled search (optional — bar can own local search for export only) */
  search?: string;
  onSearchChange?: (v: string) => void;
  status?: string;
  onStatusChange?: (v: string) => void;
  statusOptions?: Array<{ value: string; label: string }>;
  /** Called when filter values change so parent can re-query list */
  onFiltersApply?: (filters: {
    search: string;
    from: string;
    to: string;
    status: string;
  }) => void;
  className?: string;
};

const inputClass =
  "mm-input min-h-9 py-1.5 px-2.5 text-xs";

export function ExportFiltersBar({
  module,
  token,
  search: controlledSearch,
  onSearchChange,
  status: controlledStatus,
  onStatusChange,
  statusOptions,
  onFiltersApply,
  className = "",
}: Props) {
  const [localSearch, setLocalSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [localStatus, setLocalStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const search = controlledSearch !== undefined ? controlledSearch : localSearch;
  const status = controlledStatus !== undefined ? controlledStatus : localStatus;

  const setSearch = (v: string) => {
    if (onSearchChange) onSearchChange(v);
    else setLocalSearch(v);
  };
  const setStatus = (v: string) => {
    if (onStatusChange) onStatusChange(v);
    else setLocalStatus(v);
  };

  const apply = () => {
    onFiltersApply?.({ search, from, to, status });
  };

  const download = async (format: "csv" | "pdf" | "xlsx") => {
    if (!token) {
      toast.error("Not signed in");
      return;
    }
    setBusy(format);
    try {
      const q = new URLSearchParams({ type: module });
      if (search.trim()) q.set("search", search.trim());
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      if (status) q.set("status", status);
      const url = `${API_BASE_URL}/reports/export/${format}?${q.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error || `Export ${format} failed`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${module}-export.${format === "xlsx" ? "xlsx" : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success(`Exported ${format.toUpperCase()}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end bg-card/60 border border-border rounded-xl p-3 ${className}`}
    >
      <div className="flex-1 min-w-[140px]">
        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Search</label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
          placeholder="Search…"
          className={`${inputClass} w-full`}
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">To</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
      </div>
      {statusOptions && statusOptions.length > 0 && (
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={inputClass}
          >
            <option value="">All</option>
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="button"
        onClick={apply}
        className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
      >
        Apply filters
      </button>
      <div className="flex gap-1.5 flex-wrap">
        {(["csv", "pdf", "xlsx"] as const).map((fmt) => (
          <button
            key={fmt}
            type="button"
            disabled={!!busy}
            onClick={() => download(fmt)}
            className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 disabled:opacity-50 uppercase"
          >
            {busy === fmt ? "…" : fmt}
          </button>
        ))}
      </div>
    </div>
  );
}
