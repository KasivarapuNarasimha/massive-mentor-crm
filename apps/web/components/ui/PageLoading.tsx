"use client";

import { Skeleton } from "./Skeleton";

type Props = {
  /** rows for list/table skeleton */
  rows?: number;
  variant?: "table" | "cards" | "page" | "kanban";
  className?: string;
  label?: string;
};

/**
 * Consistent loading placeholders — never leave a blank page.
 */
export function PageLoading({
  rows = 6,
  variant = "table",
  className = "",
  label = "Loading…",
}: Props) {
  if (variant === "kanban") {
    return (
      <div
        className={`grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 ${className}`}
        aria-busy="true"
        aria-label={label}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-3 space-y-3 min-h-[10rem]">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className={`space-y-3 ${className}`} aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-lg p-3.5 flex flex-col sm:flex-row gap-3"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 max-w-xs" />
              <Skeleton className="h-3 w-1/2 max-w-[12rem]" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div className={`space-y-4 ${className}`} aria-busy="true" aria-label={label}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  // table
  return (
    <div
      className={`bg-card border border-border rounded-lg p-4 space-y-2.5 ${className}`}
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
