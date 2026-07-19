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
      className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 pt-4 text-sm text-zinc-400"
      aria-label="Pagination"
    >
      <div className="text-xs sm:text-sm">
        Showing <span className="text-zinc-200 tabular-nums font-medium">{from}</span>–
        <span className="text-zinc-200 tabular-nums font-medium">{to}</span> of{" "}
        <span className="text-zinc-200 tabular-nums font-medium">{total.toLocaleString()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-zinc-500">Rows</span>
          <select
            className="mm-input min-h-9 w-auto py-1.5 px-2 text-xs"
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
            className="mm-btn mm-btn-secondary min-h-9 px-3 text-xs disabled:opacity-40"
            aria-label="Previous page"
          >
            Prev
          </button>
          <div className="hidden sm:flex items-center gap-0.5" role="list">
            {start > 1 && (
              <>
                <PageBtn n={1} current={page} onClick={onPageChange} />
                {start > 2 && <span className="px-1 text-zinc-600">…</span>}
              </>
            )}
            {pages.map((n) => (
              <PageBtn key={n} n={n} current={page} onClick={onPageChange} />
            ))}
            {end < safeTotalPages && (
              <>
                {end < safeTotalPages - 1 && <span className="px-1 text-zinc-600">…</span>}
                <PageBtn n={safeTotalPages} current={page} onClick={onPageChange} />
              </>
            )}
          </div>
          <span className="sm:hidden text-xs tabular-nums px-2 text-zinc-300">
            {page} / {safeTotalPages}
          </span>
          <button
            type="button"
            disabled={page >= safeTotalPages}
            onClick={() => onPageChange(page + 1)}
            className="mm-btn mm-btn-secondary min-h-9 px-3 text-xs disabled:opacity-40"
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
      className={`min-h-9 min-w-9 px-2 rounded-lg text-xs tabular-nums border transition-colors ${
        active
          ? "bg-violet-500/20 border-violet-500/40 text-white font-semibold"
          : "border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      }`}
    >
      {n}
    </button>
  );
}
