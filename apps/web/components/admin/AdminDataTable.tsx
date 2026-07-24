"use client";

import { useMemo, useState, ReactNode } from "react";
import { exportCsv, exportExcelHtml, exportPdfPrint } from "@/lib/admin-export";

export type AdminColumn<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
  render?: (row: T) => ReactNode;
  exportValue?: (row: T) => string | number | null | undefined;
  className?: string;
};

type Props<T extends { id: string }> = {
  rows: T[];
  columns: AdminColumn<T>[];
  searchKeys?: (keyof T | string)[];
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  exportName?: string;
  emptyMessage?: string;
  toolbar?: ReactNode;
};

export function AdminDataTable<T extends { id: string }>({
  rows,
  columns,
  searchKeys = [],
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 25,
  selectable,
  selectedIds,
  onSelectionChange,
  exportName = "export",
  emptyMessage = "No records found",
  toolbar,
}: Props<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  );
  const [showCols, setShowCols] = useState(false);

  const visibleCols = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    let list = [...rows];
    const q = search.trim().toLowerCase();
    if (q && searchKeys.length) {
      list = list.filter((row) =>
        searchKeys.some((k) => {
          const v = (row as Record<string, unknown>)[k as string];
          return v != null && String(v).toLowerCase().includes(q);
        })
      );
    }
    for (const [key, fv] of Object.entries(colFilters)) {
      if (!fv.trim()) continue;
      const needle = fv.toLowerCase();
      list = list.filter((row) => {
        const v = (row as Record<string, unknown>)[key];
        return v != null && String(v).toLowerCase().includes(needle);
      });
    }
    if (sortKey) {
      list.sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        const as = av == null ? "" : String(av);
        const bs = bv == null ? "" : String(bv);
        const cmp = as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [rows, search, searchKeys, colFilters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  const allPageSelected =
    selectable && pageRows.length > 0 && pageRows.every((r) => selectedIds?.has(r.id));
  const allFilteredSelected =
    selectable && filtered.length > 0 && filtered.every((r) => selectedIds?.has(r.id));

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectAllFiltered = () => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set(filtered.map((r) => r.id)));
  };

  const clearSelection = () => onSelectionChange?.(new Set());

  const exportRows = () =>
    filtered.map((row) => {
      const o: Record<string, unknown> = {};
      for (const c of visibleCols) {
        o[c.label] = c.exportValue
          ? c.exportValue(row)
          : (row as Record<string, unknown>)[c.key];
      }
      return o;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2 flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search…"
            className="flex-1 min-w-[160px] bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground min-h-10"
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCols((v) => !v)}
              className="min-h-10 px-3 rounded-xl bg-white/10 text-xs"
            >
              Columns
            </button>
            {showCols && (
              <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-card border border-border rounded-xl p-2 shadow-xl">
                {columns
                  .filter((c) => c.hideable !== false)
                  .map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-xs py-1.5 px-1 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.key)}
                        onChange={() => {
                          setHidden((prev) => {
                            const n = new Set(prev);
                            if (n.has(c.key)) n.delete(c.key);
                            else n.add(c.key);
                            return n;
                          });
                        }}
                      />
                      {c.label}
                    </label>
                  ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => exportCsv(exportName, exportRows())}
            className="min-h-10 px-3 rounded-xl bg-white/10 text-xs"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => exportExcelHtml(exportName, exportRows())}
            className="min-h-10 px-3 rounded-xl bg-white/10 text-xs"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={() => exportPdfPrint(exportName, exportRows())}
            className="min-h-10 px-3 rounded-xl bg-white/10 text-xs"
          >
            PDF
          </button>
        </div>
        {toolbar}
      </div>

      {selectable && (
        <div className="flex flex-wrap gap-2 text-xs items-center">
          <button type="button" onClick={selectAllFiltered} className="px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-200">
            Select all ({filtered.length})
          </button>
          <button
            type="button"
            onClick={() => {
              if (!onSelectionChange) return;
              if (allPageSelected) {
                const next = new Set(selectedIds);
                pageRows.forEach((r) => next.delete(r.id));
                onSelectionChange(next);
              } else {
                const next = new Set(selectedIds);
                pageRows.forEach((r) => next.add(r.id));
                onSelectionChange(next);
              }
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white/10"
          >
            {allPageSelected ? "Clear page" : "Select page"}
          </button>
          {(selectedIds?.size || 0) > 0 && (
            <>
              <span className="text-muted-foreground">{selectedIds?.size} selected</span>
              <button type="button" onClick={clearSelection} className="text-muted-foreground underline">
                Clear
              </button>
            </>
          )}
          {allFilteredSelected && <span className="text-emerald-400">All filtered rows selected</span>}
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr className="text-muted-foreground">
                {selectable && (
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={!!allPageSelected}
                      onChange={() => {
                        if (!onSelectionChange) return;
                        if (allPageSelected) {
                          const next = new Set(selectedIds);
                          pageRows.forEach((r) => next.delete(r.id));
                          onSelectionChange(next);
                        } else {
                          const next = new Set(selectedIds);
                          pageRows.forEach((r) => next.add(r.id));
                          onSelectionChange(next);
                        }
                      }}
                      aria-label="Select page"
                    />
                  </th>
                )}
                {visibleCols.map((c) => (
                  <th key={c.key} className={`text-left p-3 font-medium ${c.className || ""}`}>
                    <button
                      type="button"
                      disabled={c.sortable === false}
                      onClick={() => c.sortable !== false && toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-muted-foreground disabled:cursor-default"
                    >
                      {c.label}
                      {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                    {c.filterable !== false && (
                      <input
                        value={colFilters[c.key] || ""}
                        onChange={(e) => {
                          setColFilters((prev) => ({ ...prev, [c.key]: e.target.value }));
                          setPage(1);
                        }}
                        placeholder="Filter"
                        className="mt-1 block w-full max-w-[140px] bg-background border border-border rounded-lg px-2 py-1 text-[11px] text-muted-foreground"
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleCols.length + (selectable ? 1 : 0)}
                    className="p-10 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/40">
                    {selectable && (
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={!!selectedIds?.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`Select ${row.id}`}
                        />
                      </td>
                    )}
                    {visibleCols.map((c) => (
                      <td key={c.key} className={`p-3 text-foreground ${c.className || ""}`}>
                        {c.render
                          ? c.render(row)
                          : String((row as Record<string, unknown>)[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          Showing {(pageSafe - 1) * pageSize + (filtered.length ? 1 : 0)}–
          {Math.min(pageSafe * pageSize, filtered.length)} of {filtered.length}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="bg-background border border-border rounded-lg px-2 py-1.5"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pageSafe <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg bg-white/10 disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {pageSafe} / {totalPages}
          </span>
          <button
            type="button"
            disabled={pageSafe >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg bg-white/10 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
