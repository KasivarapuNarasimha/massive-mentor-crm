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
 * - Mobile: compact padding, full width, safe-area
 * - Tablet: medium padding
 * - Desktop: generous padding + max width
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
        "px-3 sm:px-5 md:px-6 lg:px-8",
        "py-4 sm:py-6 lg:py-8",
        wide ? "max-w-[1400px]" : "max-w-5xl",
        mobileNavPad ? "pb-24 md:pb-8" : "",
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

/** Page title block that stacks cleanly on mobile */
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-8">
      <div className="min-w-0">
        {eyebrow ? <p className="mm-section-label mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-2xl sm:text-[1.75rem] font-semibold tracking-tight text-white leading-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-zinc-400 mt-1.5 text-sm sm:text-[0.9375rem] leading-relaxed max-w-2xl">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 shrink-0 w-full sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none [&>button]:min-h-11 [&>a]:min-h-11 [&>label]:min-h-11">
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
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={[
          "relative z-10 w-full bg-zinc-900/95 border border-zinc-700/80 shadow-2xl",
          "rounded-t-3xl sm:rounded-2xl",
          "max-h-[92dvh] sm:max-h-[90vh] flex flex-col",
          "sm:max-w-lg",
          "safe-bottom mm-fade-up",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-800 shrink-0">
          <h2 id="mm-modal-title" className="text-lg font-semibold text-white tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 text-zinc-500 hover:text-white rounded-lg min-w-11 min-h-11 focus-ring"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-zinc-800 px-4 sm:px-6 py-3 safe-bottom bg-zinc-950/40">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
