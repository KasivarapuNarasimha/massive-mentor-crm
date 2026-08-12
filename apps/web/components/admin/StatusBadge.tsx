"use client";

/** Light: darker readable text · Dark: soft luminous chips (existing look) */
const MAP: Record<string, string> = {
  active:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  healthy:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  ok: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  online:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  paid: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  resolved:
    "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  suspended:
    "bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/30",
  warning:
    "bg-amber-500/15 text-amber-900 dark:text-amber-300 border-amber-500/30",
  trial: "bg-sky-500/15 text-sky-900 dark:text-sky-300 border-sky-500/30",
  open: "bg-sky-500/15 text-sky-900 dark:text-sky-300 border-sky-500/30",
  in_progress:
    "bg-violet-500/15 text-violet-900 dark:text-violet-300 border-violet-500/30",
  critical: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
  deleted: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
  expired: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
  overdue: "bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30",
  info: "bg-muted text-foreground dark:text-muted-foreground border-border",
};

export function StatusBadge({ value }: { value?: string | null }) {
  const v = (value || "—").toString();
  const key = v.toLowerCase().replace(/\s+/g, "_");
  const cls = MAP[key] || "bg-muted text-foreground border-border";
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${cls}`}
    >
      {v.replace(/_/g, " ")}
    </span>
  );
}

export function HealthDot({ status }: { status: "healthy" | "warning" | "critical" | string }) {
  const color =
    status === "healthy" || status === "ok"
      ? "bg-emerald-500 dark:bg-emerald-400"
      : status === "warning"
        ? "bg-amber-500 dark:bg-amber-400"
        : "bg-red-500";
  const label =
    status === "healthy" || status === "ok"
      ? "Healthy"
      : status === "warning"
        ? "Warning"
        : "Critical";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
