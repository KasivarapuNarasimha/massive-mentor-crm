"use client";

import { useMemo, useState } from "react";

/**
 * Config-driven charts (no industry hardcoding).
 * chartType: bar | line | pie | area | donut | funnel | gauge
 * Rich tooltips, hover animation, empty state, click drill-down.
 */

export type ChartPoint = {
  name: string;
  value: number;
  /** Optional previous-period value for comparison/trend */
  previous?: number;
};

const COLORS = [
  "#34d399",
  "#60a5fa",
  "#a78bfa",
  "#fbbf24",
  "#f472b6",
  "#2dd4bf",
  "#fb923c",
  "#94a3b8",
];

type Props = {
  chartType: string;
  series: ChartPoint[];
  value?: number | null;
  height?: number;
  title?: string;
  description?: string;
  onDrill?: (point: ChartPoint) => void;
};

type TooltipState = {
  x: number;
  y: number;
  point: ChartPoint;
  pct: number;
  trend: number | null;
  color: string;
} | null;

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function trendPct(current: number, previous?: number): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function ChartTooltip({ tip }: { tip: NonNullable<TooltipState> }) {
  const trend = tip.trend;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[160px] max-w-[220px] rounded-xl border border-zinc-700 bg-zinc-950/95 px-3 py-2 shadow-xl backdrop-blur-sm text-left"
      style={{
        left: tip.x,
        top: tip.y,
        transform: "translate(-50%, calc(-100% - 10px))",
      }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tip.color }} />
        <span className="text-xs font-medium text-white truncate">{tip.point.name}</span>
      </div>
      <div className="text-sm font-semibold tabular-nums text-emerald-400">
        {fmt(tip.point.value)}
        <span className="text-zinc-500 font-normal text-xs ml-1.5">
          ({tip.pct.toFixed(1)}%)
        </span>
      </div>
      {trend != null && (
        <div
          className={`text-[11px] mt-0.5 ${
            trend >= 0 ? "text-emerald-400/90" : "text-red-400/90"
          }`}
        >
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}% vs prior
          {tip.point.previous != null && (
            <span className="text-zinc-500"> · was {fmt(tip.point.previous)}</span>
          )}
        </div>
      )}
      <div className="text-[10px] text-zinc-500 mt-1">Click to open related records</div>
    </div>
  );
}

function EmptyChart({ height, label }: { height: number; label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 text-center px-4"
      style={{ minHeight: height }}
    >
      <svg className="w-8 h-8 text-zinc-700 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
      <p className="text-xs text-zinc-500">No data yet</p>
      <p className="text-[10px] text-zinc-600 mt-0.5">
        {label || "Metrics appear when CRM activity is recorded"}
      </p>
    </div>
  );
}

export function ConfigChart({
  chartType,
  series,
  value,
  height = 200,
  title,
  onDrill,
}: Props) {
  const [tip, setTip] = useState<TooltipState>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(
    () => (series || []).filter((d) => d && typeof d.value === "number"),
    [series]
  );
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const max = Math.max(...data.map((d) => d.value), 1);
  const hasData = data.length > 0 && (total > 0 || chartType === "gauge");

  const showTip = (
    e: React.MouseEvent,
    point: ChartPoint,
    color: string,
    container?: HTMLElement | null
  ) => {
    const rect = (container || (e.currentTarget as HTMLElement).closest("[data-chart-root]") ||
      (e.currentTarget as HTMLElement)) as HTMLElement;
    const box = rect.getBoundingClientRect();
    const pct = total > 0 ? (point.value / total) * 100 : 0;
    setTip({
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      point,
      pct,
      trend: trendPct(point.value, point.previous),
      color,
    });
  };

  if (chartType === "gauge") {
    const v = Math.max(0, Math.min(100, value ?? 0));
    if (value == null && !hasData) {
      return <EmptyChart height={height} />;
    }
    const r = 54;
    const c = 2 * Math.PI * r;
    const offset = c - (v / 100) * c * 0.75;
    return (
      <div data-chart-root className="relative flex flex-col items-center justify-center py-2">
        <svg width="140" height="100" viewBox="0 0 140 100" className="overflow-visible">
          <path
            d="M 20 80 A 54 54 0 1 1 120 80"
            fill="none"
            stroke="#27272a"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M 20 80 A 54 54 0 1 1 120 80"
            fill="none"
            stroke="#34d399"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${c * 0.75} ${c}`}
            strokeDashoffset={offset}
            className="transition-all duration-500 ease-out"
            style={{ filter: "drop-shadow(0 0 6px rgba(52,211,153,0.35))" }}
          />
          <text x="70" y="72" textAnchor="middle" className="fill-white" fontSize="22" fontWeight="600">
            {v}%
          </text>
        </svg>
        <p className="text-[10px] text-zinc-500 mt-1">Target attainment</p>
      </div>
    );
  }

  if (!hasData) {
    return <EmptyChart height={height} label={title ? `No data for ${title}` : undefined} />;
  }

  if (chartType === "pie" || chartType === "donut") {
    let angle = -90;
    const cx = 80;
    const cy = 80;
    const outer = 70;
    const inner = chartType === "donut" ? 38 : 0;
    const slices = data.map((d, i) => {
      const sweep = total > 0 ? (d.value / total) * 360 : 0;
      const start = angle;
      angle += sweep;
      return { ...d, start, sweep, color: COLORS[i % COLORS.length], idx: i };
    });
    return (
      <div data-chart-root className="relative flex flex-col sm:flex-row items-center gap-4">
        {tip && <ChartTooltip tip={tip} />}
        <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
          {slices.map((s) => {
            const path = donutSlice(cx, cy, inner, outer, s.start, s.start + s.sweep);
            const active = hoverIdx === s.idx;
            return (
              <path
                key={s.name + s.idx}
                d={path}
                fill={s.color}
                className="cursor-pointer transition-all duration-200 ease-out"
                style={{
                  opacity: hoverIdx == null || active ? 1 : 0.45,
                  transform: active ? "scale(1.04)" : "scale(1)",
                  transformOrigin: "80px 80px",
                  filter: active ? "drop-shadow(0 0 8px rgba(255,255,255,0.15))" : undefined,
                }}
                onMouseEnter={(e) => {
                  setHoverIdx(s.idx);
                  showTip(e, s, s.color);
                }}
                onMouseMove={(e) => showTip(e, s, s.color)}
                onMouseLeave={() => {
                  setHoverIdx(null);
                  setTip(null);
                }}
                onClick={() => onDrill?.(s)}
              />
            );
          })}
          {chartType === "donut" && (
            <text x="80" y="84" textAnchor="middle" className="fill-zinc-400" fontSize="11">
              {fmt(total)}
            </text>
          )}
        </svg>
        <ul className="text-xs space-y-1.5 max-h-40 overflow-auto flex-1 w-full">
          {slices.map((s) => {
            const pct = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={s.name + s.idx}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 text-left rounded-lg px-1.5 py-1 hover:bg-zinc-800/60 transition-colors"
                  onMouseEnter={() => setHoverIdx(s.idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  onClick={() => onDrill?.(s)}
                >
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="text-zinc-300 truncate flex-1">{s.name}</span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {fmt(s.value)} · {pct.toFixed(0)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (chartType === "funnel") {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    return (
      <div data-chart-root className="relative space-y-1.5 py-1" style={{ minHeight: height }}>
        {tip && <ChartTooltip tip={tip} />}
        {sorted.map((d, i) => {
          const w = 40 + (d.value / max) * 60;
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const color = COLORS[i % COLORS.length];
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => onDrill?.(d)}
              onMouseEnter={(e) => {
                setHoverIdx(i);
                showTip(e, d, color);
              }}
              onMouseMove={(e) => showTip(e, d, color)}
              onMouseLeave={() => {
                setHoverIdx(null);
                setTip(null);
              }}
              className="w-full flex justify-center"
            >
              <div
                className="h-9 rounded-md flex items-center justify-center text-xs text-zinc-950 font-medium transition-all duration-200 ease-out"
                style={{
                  width: `${w}%`,
                  background: color,
                  minWidth: "30%",
                  transform: hoverIdx === i ? "scaleY(1.08)" : "scaleY(1)",
                  boxShadow: hoverIdx === i ? "0 0 12px rgba(255,255,255,0.12)" : undefined,
                }}
              >
                {d.name}: {fmt(d.value)} ({pct.toFixed(0)}%)
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // bar | line | area
  const w = 320;
  const h = height;
  const pad = 28;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const n = data.length || 1;
  const barW = Math.max(8, (plotW / n) * 0.55);

  if (chartType === "line" || chartType === "area") {
    const points = data.map((d, i) => {
      const x = pad + (i / Math.max(n - 1, 1)) * plotW;
      const y = pad + plotH - (d.value / max) * plotH;
      return { x, y, d, i };
    });
    const poly = points.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath =
      `M ${pad},${pad + plotH} ` +
      points.map((p, i) => (i === 0 ? `L ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(" ") +
      ` L ${pad + plotW},${pad + plotH} Z`;
    return (
      <div data-chart-root className="relative w-full">
        {tip && <ChartTooltip tip={tip} />}
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
          {chartType === "area" && (
            <path d={areaPath} fill="url(#areaGrad)" stroke="none" className="transition-opacity" />
          )}
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polyline
            fill="none"
            stroke="#34d399"
            strokeWidth="2.5"
            points={poly}
            className="transition-all duration-300"
            style={{ filter: "drop-shadow(0 0 4px rgba(52,211,153,0.4))" }}
          />
          {points.map(({ x, y, d, i }) => (
            <circle
              key={d.name + i}
              cx={x}
              cy={y}
              r={hoverIdx === i ? 6 : 3.5}
              fill="#34d399"
              stroke="#0a0a0a"
              strokeWidth={hoverIdx === i ? 2 : 0}
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={(e) => {
                setHoverIdx(i);
                showTip(e, d, "#34d399");
              }}
              onMouseMove={(e) => showTip(e, d, "#34d399")}
              onMouseLeave={() => {
                setHoverIdx(null);
                setTip(null);
              }}
              onClick={() => onDrill?.(d)}
            />
          ))}
        </svg>
      </div>
    );
  }

  // default bar
  return (
    <div data-chart-root className="relative w-full">
      {tip && <ChartTooltip tip={tip} />}
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        {data.map((d, i) => {
          const x = pad + (i + 0.2) * (plotW / n);
          const bh = (d.value / max) * plotH;
          const y = pad + plotH - bh;
          const color = COLORS[i % COLORS.length];
          const active = hoverIdx === i;
          return (
            <g
              key={d.name + i}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                setHoverIdx(i);
                showTip(e, d, color);
              }}
              onMouseMove={(e) => showTip(e, d, color)}
              onMouseLeave={() => {
                setHoverIdx(null);
                setTip(null);
              }}
              onClick={() => onDrill?.(d)}
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, 2)}
                rx={4}
                fill={color}
                className="transition-all duration-200 ease-out"
                style={{
                  opacity: hoverIdx == null || active ? 1 : 0.4,
                  filter: active ? "brightness(1.15)" : undefined,
                  transform: active ? "translateY(-2px)" : undefined,
                }}
              />
              {active && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  className="fill-zinc-300"
                  fontSize="9"
                >
                  {fmt(d.value)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlice(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  startDeg: number,
  endDeg: number
) {
  if (endDeg - startDeg < 0.01) {
    return "";
  }
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const s1 = polar(cx, cy, outer, startDeg);
  const e1 = polar(cx, cy, outer, endDeg);
  if (inner <= 0) {
    return `M ${cx} ${cy} L ${s1.x} ${s1.y} A ${outer} ${outer} 0 ${large} 1 ${e1.x} ${e1.y} Z`;
  }
  const s2 = polar(cx, cy, inner, endDeg);
  const e2 = polar(cx, cy, inner, startDeg);
  return `M ${s1.x} ${s1.y} A ${outer} ${outer} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${inner} ${inner} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
}
