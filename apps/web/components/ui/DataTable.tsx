"use client";

/**
 * Premium data table shell — sticky header, column visibility, CSV export,
 * empty state. Presentational only; parents own data fetching.
 */

import { useMemo, useState, type ReactNode } from "react";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  /** Cell renderer */
  cell: (row: T) => ReactNode;
  /** Value used for CSV export */
  exportValue?: (row: T) => string | number | null | undefined;
  /** Hide from default visible set */
  defaultHidden?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
  /** Min width for resize base */
  minWidth?: number;
};

type Props<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** Optional CTA under empty state */
  emptyAction?: ReactNode;
  exportFileName?: string;
  /** Extra toolbar actions */
  toolbar?: ReactNode;
  className?: string;
  /** Selected row keys */
  selectedKeys?: Set<string>;
  onRowClick?: (row: T) => void;
};

function escapeCsv(val: unknown): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyTitle = "No records",
  emptyHint = "Try adjusting filters or create a new record.",
  emptyAction,
  exportFileName = "export",
  toolbar,
  className = "",
  selectedKeys,
  onRowClick,
}: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id))
  );
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  const visible = useMemo(
    () => columns.filter((c) => !hidden.has(c.id)),
    [columns, hidden]
  );

  const exportCsv = () => {
    const headers = visible.map((c) => c.header);
    const body = rows.map((row) =>
      visible.map((c) => {
        const v = c.exportValue
          ? c.exportValue(row)
          : // fallback: strip from React text not available — empty
            "";
        return escapeCsv(v);
      })
    );
    const csv = [headers.map(escapeCsv), ...body]
      .map((r) => r.join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportFileName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleCol = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        // keep at least one column
        if (columns.length - next.size <= 1) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const startResize = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[id] || 140;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(80, startW + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [id]: w }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className={`space-y-2.5 ${className}`}>
      <div className="mm-toolbar">
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              className="mm-btn mm-btn-secondary px-3 text-xs focus-ring"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label="Toggle column visibility"
            >
              Columns
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default"
                  aria-label="Close columns menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-card p-1.5 shadow-md"
                  role="menu"
                >
                  {columns.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.id)}
                        onChange={() => toggleCol(c.id)}
                        className="rounded border-border"
                      />
                      {c.header}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className="mm-btn mm-btn-secondary px-3 text-xs focus-ring"
            onClick={exportCsv}
            disabled={!rows.length}
            aria-label="Export table as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mm-table-wrap">
        {loading ? (
          <div className="p-6 space-y-3" aria-busy="true" aria-label="Loading table">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mm-skeleton h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="mm-empty" role="status">
            <div className="mm-empty-icon" aria-hidden>
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground max-w-sm">{emptyHint}</p>
            {emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
          </div>
        ) : (
          <table className="mm-table min-w-full" role="table">
            <thead>
              <tr>
                {visible.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    style={{
                      width: colWidths[c.id],
                      minWidth: c.minWidth || 100,
                      textAlign: c.align || "left",
                    }}
                    className={`relative group/th ${c.className || ""}`}
                  >
                    {c.header}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.header}`}
                      onMouseDown={(e) => startResize(c.id, e)}
                      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover/th:opacity-100 bg-primary/40 hover:bg-primary"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = rowKey(row);
                const selected = selectedKeys?.has(key);
                return (
                  <tr
                    key={key}
                    data-selected={selected ? "true" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        style={{ textAlign: c.align || "left" }}
                        className={c.className}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
