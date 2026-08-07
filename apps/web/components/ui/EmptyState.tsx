"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * Consistent empty state for lists/modules.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: Props) {
  return (
    <div
      className={`mm-empty bg-card border border-border rounded-2xl ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="mm-empty-icon" aria-hidden>
        {icon ?? (
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        )}
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
