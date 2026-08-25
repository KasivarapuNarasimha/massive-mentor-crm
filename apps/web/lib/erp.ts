/** Shared helpers for ERP Phase 2 pages (list unwrap + numeric coercion). */

/** Prefer shared mm-* contract; keep ERP_* aliases for existing page imports. */
export const ERP_INPUT = "mm-input";

export const ERP_BTN = "mm-btn mm-btn-primary";

export const ERP_BTN_GHOST = "mm-btn mm-btn-secondary";

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


