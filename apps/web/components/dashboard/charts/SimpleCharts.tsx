"use client";

/**
 * Lightweight SVG charts for the premium dashboard.
 * No heavy chart libraries — fast paint, brand-consistent colors.
 */

export type Point = { name: string; value: number };

const BRAND = ["#8b5cf6", "#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#2dd4bf", "#fb923c", "#a78bfa"];

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(0);
}

export function EmptyChart({ label = "No data yet" }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 text-center"
      role="img"
      aria-label={label}
    >
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800">
        <svg className="h-6 w-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-400">{label}</p>
      <p className="mt-1 text-xs text-zinc-600">Add CRM activity to populate this chart</p>
    </div>
  );
}

export function BarChart({
  series,
  height = 180,
  ariaLabel,
}: {
  series: Point[];
  height?: number;
  ariaLabel?: string;
}) {
  if (!series.length || series.every((s) => !s.value)) {
    return <EmptyChart />;
  }
  const max = Math.max(...series.map((s) => s.value), 1);
  return (
    <div
      className="flex h-full items-end gap-1.5 sm:gap-2 px-1 pt-4"
      style={{ minHeight: height }}
      role="img"
      aria-label={ariaLabel || "Bar chart"}
    >
      {series.map((s, i) => {
        const pct = (s.value / max) * 100;
        const color = BRAND[i % BRAND.length];
        return (
          <div key={s.name} className="flex flex-1 flex-col items-center gap-1.5 min-w-0 group">
            <span className="text-[10px] tabular-nums text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity">
              {fmt(s.value)}
            </span>
            <div className="relative w-full flex items-end justify-center" style={{ height: height - 40 }}>
              <div
                className="w-full max-w-[36px] rounded-t-md transition-all duration-500 ease-out group-hover:brightness-110"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  background: `linear-gradient(180deg, ${color}, ${color}99)`,
                }}
                title={`${s.name}: ${fmt(s.value)}`}
              />
            </div>
            <span className="w-full truncate text-center text-[10px] sm:text-[11px] text-zinc-500">
              {s.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AreaChart({
  series,
  height = 180,
  ariaLabel,
  color = "#8b5cf6",
}: {
  series: Point[];
  height?: number;
  ariaLabel?: string;
  color?: string;
}) {
  if (!series.length || series.every((s) => !s.value)) {
    return <EmptyChart />;
  }
  const max = Math.max(...series.map((s) => s.value), 1);
  const w = 320;
  const h = height;
  const pad = 12;
  const pts = series.map((s, i) => {
    const x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
    const y = pad + (1 - s.value / max) * (h - pad * 2);
    return { x, y, ...s };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${h - pad} L${pts[0].x},${h - pad} Z`;

  return (
    <div className="w-full" style={{ minHeight: height }} role="img" aria-label={ariaLabel || "Area chart"}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mmAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#mmAreaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {pts.map((p) => (
          <circle key={p.name + p.x} cx={p.x} cy={p.y} r="3.5" fill={color} className="opacity-90">
            <title>
              {p.name}: {fmt(p.value)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1">
        {series.map((s) => (
          <span key={s.name} className="text-[10px] text-zinc-600 truncate max-w-[4rem] text-center">
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({
  series,
  size = 160,
  ariaLabel,
  centerLabel,
}: {
  series: Point[];
  size?: number;
  ariaLabel?: string;
  centerLabel?: string;
}) {
  if (!series.length || series.every((s) => !s.value)) {
    return <EmptyChart />;
  }
  const total = series.reduce((a, s) => a + s.value, 0) || 1;
  const r = 56;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const slices = series.map((s, i) => {
    const len = (s.value / total) * c;
    const slice = {
      ...s,
      color: BRAND[i % BRAND.length],
      dash: `${len} ${c - len}`,
      offset,
    };
    offset -= len;
    return slice;
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4" role="img" aria-label={ariaLabel || "Donut chart"}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#27272a" strokeWidth="14" />
          {slices.map((s) => (
            <circle
              key={s.name}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={s.dash}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
            >
              <title>
                {s.name}: {fmt(s.value)}
              </title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums text-white">{fmt(total)}</span>
          {centerLabel && <span className="text-[10px] text-zinc-500">{centerLabel}</span>}
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 min-w-0 w-full">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="truncate flex-1">{s.name}</span>
            <span className="tabular-nums text-zinc-300">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GaugeChart({
  value,
  max = 100,
  label,
  color = "#8b5cf6",
}: {
  value: number;
  max?: number;
  label?: string;
  color?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const r = 54;
  const c = Math.PI * r; // semi-circle
  const filled = (pct / 100) * c;
  return (
    <div className="flex flex-col items-center" role="img" aria-label={label || `Gauge ${value}%`}>
      <svg viewBox="0 0 140 90" className="w-full max-w-[200px]">
        <path
          d="M 16 80 A 54 54 0 0 1 124 80"
          fill="none"
          stroke="#27272a"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 16 80 A 54 54 0 0 1 124 80"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
        />
        <text x="70" y="72" textAnchor="middle" className="fill-white text-2xl font-semibold" fontSize="22">
          {Math.round(value)}%
        </text>
      </svg>
      {label && <p className="text-xs text-zinc-500 -mt-1">{label}</p>}
    </div>
  );
}
