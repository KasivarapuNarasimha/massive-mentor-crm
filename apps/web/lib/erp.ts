/** Shared helpers for ERP Phase 2 pages (list unwrap + numeric coercion). */

export const ERP_INPUT =
  "w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-border";

export const ERP_BTN =
  "px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium min-h-11";

export const ERP_BTN_GHOST =
  "inline-flex items-center justify-center rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-ring min-h-11";

export function listFrom<T>(data: unknown, ...keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  for (const key of keys) {
    const v = rec[key];
    if (Array.isArray(v)) return v as T[];
  }
  if (Array.isArray(rec.data)) return rec.data as T[];
  return [];
}

export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}


