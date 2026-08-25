"use client";

import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Wider content for CRM tables / maps */
  wide?: boolean;
  className?: string;
  /** Extra bottom padding on mobile for bottom nav */
  mobileNavPad?: boolean;
};

/**
 * Consistent adaptive page container.
 * Enterprise density: ~24–32px desktop padding, compact type.
 */
export function PageShell({
  children,
  wide = false,
  className = "",
  mobileNavPad = true,
}: Props) {
  return (
    <div
      className={[
        "mm-page-enter w-full min-w-0 mx-auto",
        "px-4 sm:px-5 md:px-6 lg:px-8",
        "py-4 sm:py-5 lg:py-6",
        wide ? "max-w-[1400px]" : "max-w-5xl",
        mobileNavPad ? "pb-20 md:pb-6" : "",
        "overflow-x-hidden",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** Page title block — compact enterprise hierarchy */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
      <div className="min-w-0">
        {eyebrow ? <p className="mm-section-label mb-1">{eyebrow}</p> : null}
        <h1 className="mm-page-title">
          {title}
        </h1>
        {description ? (
          <p className="mm-secondary mt-1 max-w-2xl">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 shrink-0 w-full sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none [&>button]:min-h-9 [&>a]:min-h-9 [&>label]:min-h-9">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Full-screen friendly modal shell on mobile */
export function ResponsiveModal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 mm-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mm-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={[
          "relative z-10 w-full bg-card border border-border shadow-lg",
          "rounded-t-xl sm:rounded-lg",
          "max-h-[92dvh] sm:max-h-[90vh] flex flex-col",
          "sm:max-w-lg",
          "safe-bottom mm-fade-up",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <h2 id="mm-modal-title" className="text-base font-semibold text-foreground tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -mr-1 text-muted-foreground hover:text-foreground rounded-md min-w-9 min-h-9 focus-ring"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 safe-bottom bg-background-secondary/60">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
