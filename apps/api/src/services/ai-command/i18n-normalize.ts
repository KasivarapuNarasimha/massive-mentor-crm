/** Light normalizers for money/dates — not a hardcoded command router. */

const LAKH = 100_000;
const CRORE = 10_000_000;

export function parseMoneyToNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/₹/g, "").replace(/,/g, "").replace(/\srs\.?\s*/g, "").trim();

  const crore = s.match(/^([\d.]+)\s*crore/);
  if (crore) return Math.round(parseFloat(crore[1]) * CRORE);

  const lakh = s.match(/^([\d.]+)\s*lakhs?/);
  if (lakh) return Math.round(parseFloat(lakh[1]) * LAKH);

  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Default timezone Asia/Kolkata for relative dates */
export function resolveDueDate(
  due: unknown,
  now = new Date(),
  timeZone = "Asia/Kolkata"
): string | null {
  if (due == null || due === "") return null;
  if (typeof due === "string" && /^\d{4}-\d{2}-\d{2}T/.test(due)) return due;

  if (typeof due === "object" && due !== null) {
    const d = due as { relative?: string; time?: string; days?: number; iso?: string };
    if (d.iso) return d.iso;
    const base = new Date(now);
    const rel = (d.relative || "").toLowerCase();
    if (rel === "tomorrow" || rel === "repu" || rel.includes("repu")) {
      base.setDate(base.getDate() + 1);
    } else if (rel === "today" || rel === "ippu" || rel.includes("today")) {
      /* keep */
    } else if (typeof d.days === "number") {
      base.setDate(base.getDate() + d.days);
    } else if (/^\d+\s*days?/.test(rel)) {
      const n = parseInt(rel, 10);
      if (Number.isFinite(n)) base.setDate(base.getDate() + n);
    }
    const time = d.time || "10:00";
    const [hh, mm] = time.split(":").map((x) => parseInt(x, 10));
    // Interpret wall clock in IST roughly via UTC+5:30 offset construction
    const y = base.getFullYear();
    const m = base.getMonth();
    const day = base.getDate();
    const istAsUtc = Date.UTC(y, m, day, (hh || 10) - 5, (mm || 0) - 30, 0);
    return new Date(istAsUtc).toISOString();
  }

  const s = String(due).toLowerCase().trim();
  if (s.includes("repu") || s.includes("tomorrow")) {
    return resolveDueDate({ relative: "tomorrow", time: "10:00" }, now, timeZone);
  }
  const inDays = s.match(/(\d+)\s*days?/);
  if (inDays) {
    return resolveDueDate({ days: parseInt(inDays[1], 10), time: "18:00" }, now, timeZone);
  }
  const parsed = Date.parse(String(due));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return null;
}

export function normalizeStatus(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  const map: Record<string, string> = {
    new: "new",
    qualified: "qualified",
    contacted: "contacted",
    negotiation: "negotiation",
    proposal: "proposal",
    won: "won",
    lost: "lost",
    active: "active",
  };
  return map[s] || s.replace(/\s+/g, "_");
}

/** Extract money / relative due hints from free text for planner context only */
export function extractHints(message: string): { amounts: number[]; dueHints: string[] } {
  const amounts: number[] = [];
  const dueHints: string[] = [];
  const moneyRe =
    /₹\s*([\d,]+(?:\.\d+)?)\s*(lakhs?|crore)?|([\d,]+(?:\.\d+)?)\s*(lakhs?|crore)|([\d,]+)\s*(?:\/-)?/gi;
  let m: RegExpExecArray | null;
  while ((m = moneyRe.exec(message)) !== null) {
    const n = parseMoneyToNumber(
      m[2] || m[4] ? `${m[1] || m[3]} ${m[2] || m[4]}` : m[1] || m[3] || m[5]
    );
    if (n != null && n > 0) amounts.push(n);
  }
  if (/\brepu\b|tomorrow/i.test(message)) dueHints.push("tomorrow");
  const days = message.match(/(\d+)\s*days?/i);
  if (days) dueHints.push(`in_${days[1]}_days`);
  return { amounts, dueHints };
}
