"use client";

import type { ReactNode } from "react";

/**
 * Shared landscape CRM form layout primitives.
 * Desktop/tablet: 2-column field grid; mobile: 1 column.
 * Long text fields span full width.
 *
 * Mobile modals must sit ABOVE the fixed bottom nav (z-50) so Cancel/Save stay tappable.
 */

/** Overlay for entity create/edit dialogs — above mobile bottom nav (z-50) */
export const FORM_MODAL_OVERLAY =
  "fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 dark:bg-black/60";

/**
 * Wide landscape panel (~48rem on desktop).
 * Use with flex-col + header / scroll body / sticky footer.
 * On mobile: bottom sheet capped to viewport; footer stays outside the scroll region.
 */
export const FORM_MODAL_PANEL =
  "relative w-full bg-card border border-border shadow-lg rounded-t-xl sm:rounded-lg " +
  "max-h-[min(92dvh,100dvh)] sm:max-h-[85vh] flex flex-col overflow-hidden " +
  "sm:max-w-3xl";

export const FORM_MODAL_HEADER =
  "shrink-0 px-4 sm:px-5 py-3 border-b border-border";

export const FORM_MODAL_BODY =
  "flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4";

/** Sticky footer — always visible; safe-area padding for home indicator */
export const FORM_MODAL_FOOTER =
  "shrink-0 border-t border-border px-4 sm:px-5 pt-3 modal-footer-safe " +
  "bg-background-secondary/60 flex gap-2 relative z-10";

/** Field grid: 1 col mobile, 2 col from md up */
export const FORM_GRID_CLASS = "grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4";

const FULL_WIDTH_KEYS = new Set([
  "notes",
  "description",
  "address",
  "comment",
  "comments",
  "feedback",
  "attachments",
  "summary",
  "site_address",
  "outcome",
]);

/** Whether a field should span both columns */
export function isFormFieldFullWidth(opts: {
  key?: string;
  type?: string;
  force?: boolean;
}): boolean {
  if (opts.force) return true;
  const type = (opts.type || "").toLowerCase();
  if (type === "textarea") return true;
  const key = (opts.key || "").toLowerCase();
  if (!key) return false;
  if (FULL_WIDTH_KEYS.has(key)) return true;
  if (key.includes("address") || key.includes("note") || key.includes("comment")) {
    return true;
  }
  if (key.includes("description") || key.includes("summary")) return true;
  return false;
}

export function FormGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${FORM_GRID_CLASS} ${className}`.trim()}>{children}</div>;
}

export function FormGridItem({
  children,
  fullWidth,
  className = "",
}: {
  children: ReactNode;
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <div className={`${fullWidth ? "md:col-span-2" : ""} ${className}`.trim()}>{children}</div>
  );
}
