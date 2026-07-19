"use client";

type Point = { label: string; value: number };

export function BarChart({
  title,
  points,
  color = "bg-violet-500",
}: {
  title: string;
  points: Point[];
  color?: string;
}) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
      <div className="flex items-end gap-1.5 h-36">
        {points.map((p) => (
          <div key={p.label} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end">
            <div
              className={`w-full max-w-[28px] rounded-t-md ${color} transition-all`}
              style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }}
              title={`${p.label}: ${p.value}`}
            />
            <div className="text-[9px] text-zinc-500 truncate w-full text-center">
              {p.label.slice(-5)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({
  label,
  value,
  max = 100,
  tone = "violet",
}: {
  label: string;
  value: number;
  max?: number;
  tone?: "violet" | "emerald" | "amber" | "sky";
}) {
  const pct = Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  const bar =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : tone === "sky"
          ? "bg-sky-500"
          : "bg-violet-500";
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
