"use client";

type Props = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
};

const TONE: Record<string, string> = {
  default: "border-border",
  success: "border-emerald-800/60 bg-emerald-950/20",
  warning: "border-amber-800/60 bg-amber-950/20",
  danger: "border-red-800/60 bg-red-950/20",
  info: "border-sky-800/60 bg-sky-950/20",
};

export function KpiCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className={`rounded-2xl border bg-card p-4 min-w-0 ${TONE[tone]}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1 text-foreground truncate">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
    </div>
  );
}
