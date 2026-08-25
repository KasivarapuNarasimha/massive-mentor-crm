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
  /** Filter by assignee userId (leads/contacts). Use "unassigned" for none. */
  assignedTo?: string;
  onAssignedToChange?: (v: string) => void;
  assigneeOptions?: Array<{ value: string; label: string }>;
  /** Called when filter values change so parent can re-query list */
  onFiltersApply?: (filters: {
    search: string;
    from: string;
    to: string;
    status: string;
    assignedTo?: string;
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
  assignedTo: controlledAssignedTo,
  onAssignedToChange,
  assigneeOptions,
  onFiltersApply,
  className = "",
}: Props) {
  const [localSearch, setLocalSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [localStatus, setLocalStatus] = useState("");
  const [localAssignedTo, setLocalAssignedTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const search = controlledSearch !== undefined ? controlledSearch : localSearch;
  const status = controlledStatus !== undefined ? controlledStatus : localStatus;
  const assignedTo =
    controlledAssignedTo !== undefined ? controlledAssignedTo : localAssignedTo;

  const setSearch = (v: string) => {
    if (onSearchChange) onSearchChange(v);
    else setLocalSearch(v);
  };
  const setStatus = (v: string) => {
    if (onStatusChange) onStatusChange(v);
    else setLocalStatus(v);
  };
  const setAssignedTo = (v: string) => {
    if (onAssignedToChange) onAssignedToChange(v);
    else setLocalAssignedTo(v);
  };

  const apply = () => {
    onFiltersApply?.({ search, from, to, status, assignedTo });
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
      if (assignedTo) q.set("assignedTo", assignedTo);
      const url = `${API_BASE_URL}/reports/export/${format}?${q.toString()}`;
      const res = await fetch(url, {
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
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      // Never save an error JSON body as .xlsx/.csv (causes "format not valid")
      if (!res.ok || contentType.includes("application/json")) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error || `Export ${format} failed (${res.status})`);
        return;
      }
      const buf = await res.arrayBuffer();
      if (!buf.byteLength) {
        toast.error("Export returned an empty file");
        return;
      }
      // Basic magic-byte checks
      const u8 = new Uint8Array(buf);
      if (format === "xlsx" && !(u8[0] === 0x50 && u8[1] === 0x4b)) {
        toast.error("Invalid Excel file received from server");
        return;
      }
      if (format === "pdf" && !(u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46)) {
        toast.error("Invalid PDF file received from server");
        return;
      }
      // CSV should start with UTF-8 BOM (EF BB BF) for Excel, or plain text
      if (format === "csv") {
        const hasBom = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
        const looksText = u8[0] >= 0x20 || u8[0] === 0x0a || u8[0] === 0x0d || hasBom;
        if (!looksText) {
          toast.error("Invalid CSV file received from server");
          return;
        }
      }
      const mime =
        format === "csv"
          ? "text/csv;charset=utf-8"
          : format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf";
      const cd = res.headers.get("content-disposition") || "";
      // Prefer RFC 5987 filename*=UTF-8''...
      const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
      const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
      let filename = `${module}-export.${format}`;
      try {
        if (star?.[1]) filename = decodeURIComponent(star[1].trim());
        else if (plain?.[1]) filename = plain[1].trim().replace(/^["']|["']$/g, "");
      } catch {
        /* keep default */
      }
      // Ensure extension matches format (never save .xlsx that is actually CSV, etc.)
      if (!filename.toLowerCase().endsWith(`.${format}`)) {
        filename = `${filename.replace(/\.[^.]+$/, "")}.${format}`;
      }
      const blob = new Blob([buf], { type: mime });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
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
      className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end mm-filter-bar ${className}`}
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
      {assigneeOptions && assigneeOptions.length > 0 && (
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Assigned To
          </label>
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className={inputClass}
            aria-label="Filter by assigned team member"
          >
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {assigneeOptions.map((o) => (
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
        className="mm-btn mm-btn-secondary h-8 min-h-8 px-3 text-xs"
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
            className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs uppercase disabled:opacity-50"
          >
            {busy === fmt ? "…" : fmt}
          </button>
        ))}
      </div>
    </div>
  );
}
