"use client";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
};

export function PaginationBar({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: Props) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const safeTotalPages = Math.max(1, totalPages || 1);

  // Compact page window
  const pages: number[] = [];
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(safeTotalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav
      className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2 pt-3 text-[13px] text-muted-foreground border-t border-border mt-2"
      aria-label="Pagination"
    >
      <div className="text-xs">
        Showing <span className="text-foreground tabular-nums font-medium">{from}</span>–
        <span className="text-foreground tabular-nums font-medium">{to}</span> of{" "}
        <span className="text-foreground tabular-nums font-medium">{total.toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Rows</span>
          <select
            className="mm-input w-auto py-1 px-2 text-xs h-8 min-h-8"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs disabled:opacity-40"
            aria-label="Previous page"
          >
            Prev
          </button>
          <div className="hidden sm:flex items-center gap-0.5" role="list">
            {start > 1 && (
              <>
                <PageBtn n={1} current={page} onClick={onPageChange} />
                {start > 2 && <span className="px-1 text-muted-foreground">…</span>}
              </>
            )}
            {pages.map((n) => (
              <PageBtn key={n} n={n} current={page} onClick={onPageChange} />
            ))}
            {end < safeTotalPages && (
              <>
                {end < safeTotalPages - 1 && <span className="px-1 text-muted-foreground">…</span>}
                <PageBtn n={safeTotalPages} current={page} onClick={onPageChange} />
              </>
            )}
          </div>
          <span className="sm:hidden text-xs tabular-nums px-2 text-muted-foreground">
            {page} / {safeTotalPages}
          </span>
          <button
            type="button"
            disabled={page >= safeTotalPages}
            onClick={() => onPageChange(page + 1)}
            className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs disabled:opacity-40"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>
    </nav>
  );
}

function PageBtn({
  n,
  current,
  onClick,
}: {
  n: number;
  current: number;
  onClick: (n: number) => void;
}) {
  const active = n === current;
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      aria-label={`Page ${n}`}
      aria-current={active ? "page" : undefined}
      className={`h-8 min-h-8 min-w-8 px-2 rounded-md text-xs tabular-nums border transition-colors ${
        active
          ? "bg-accent border-primary/30 text-accent-foreground font-semibold"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {n}
    </button>
  );
}
