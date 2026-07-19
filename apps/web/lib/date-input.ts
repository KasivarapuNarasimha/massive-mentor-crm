/**
 * Normalize UI date values to ISO-8601 for the API.
 * Accepts:
 * - yyyy-mm-dd (HTML date)
 * - yyyy-mm-ddThh:mm (datetime-local)
 * - full ISO
 * - dd-mm-yyyy / dd/mm/yyyy
 */

export function toIsoDateTime(
  value: string | null | undefined,
  opts?: { endOfDay?: boolean }
): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // ISO with time
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw.length === 16 ? `${raw}:00` : raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // HTML date yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = opts?.endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const d = new Date(`${raw}${suffix}`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // dd-mm-yyyy | dd/mm/yyyy | dd.mm.yyyy
  const dmy = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const suffix = opts?.endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
      const d = new Date(`${ymd}${suffix}`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  return null;
}

/** Value for <input type="date"> from API ISO string */
export function toDateInputValue(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // already yyyy-mm-dd?
    if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
    return "";
  }
  return d.toISOString().slice(0, 10);
}
