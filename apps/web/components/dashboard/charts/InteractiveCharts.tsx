"use client";

/**
 * Interactive SaaS analytics charts — SVG, tooltips, drill-down, export.
 * Flat professional CRM style (Zoho-like): solid colors, no glow/glass/gradients.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChartTooltipPortal,
  readChartSurfaceBoundary,
  type ChartTooltipBoundary,
} from "@/components/dashboard/charts/ChartTooltipPortal";

export type AnalyticPoint = {
  name: string;
  value: number;
  /** Optional secondary metric (e.g. revenue) */
  revenue?: number;
  count?: number;
  previous?: number;
  percent?: number;
  key?: string;
  filter?: Record<string, string>;
  color?: string;
};

/** Solid CRM analytics palette — coral, pink, purple, blue, cyan, green, orange */
const PALETTE = [
  "#ef4444", // red/coral
  "#ec4899", // pink
  "#8b5cf6", // purple
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#22c55e", // green
  "#f59e0b", // amber/orange
  "#14b8a6", // teal
  "#a855f7", // violet
  "#f97316", // orange
];

const LINE_COLOR = "#3b82f6";
const GRID_STROKE = "currentColor";

export function fmtNum(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(0);
}

export function fmtMoney(n: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n || 0);
  } catch {
    return `₹${fmtNum(n)}`;
  }
}

function growthPct(current: number, previous?: number): number | null {
  if (previous == null) return null;
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

type Tip = {
  clientX: number;
  clientY: number;
  boundary?: ChartTooltipBoundary | null;
  point: AnalyticPoint;
  pct: number;
  growth: number | null;
  color: string;
};

function tipFromEvent(
  e: React.MouseEvent,
  rest: Omit<Tip, "clientX" | "clientY" | "boundary">
): Tip {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    boundary: readChartSurfaceBoundary(e.currentTarget),
    ...rest,
  };
}

function MetricRow({
  label,
  value,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 w-full">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 shrink-0 text-right tabular-nums font-semibold ${valueClass}`}
      >
        {value}
      </span>
    </div>
  );
}

function ChartTooltip({
  tip,
  currency,
}: {
  tip: Tip;
  currency?: string;
}) {
  const growth = tip.growth;
  const growthText =
    growth == null
      ? "—"
      : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth).toFixed(1)}%`;
  const growthClass =
    growth == null
      ? "text-muted-foreground"
      : growth >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <ChartTooltipPortal
      open
      width={248}
      anchor={{
        clientX: tip.clientX,
        clientY: tip.clientY,
        boundary: tip.boundary,
      }}
    >
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0 border border-border"
          style={{ background: tip.color }}
        />
        <span className="text-xs font-semibold text-foreground truncate tracking-tight">
          {tip.point.name}
        </span>
      </div>
      <div className="space-y-1.5 text-[11px] w-full">
        <MetricRow
          label="Count"
          value={fmtNum(tip.point.count ?? tip.point.value)}
        />
        <MetricRow
          label="Share"
          value={`${tip.pct.toFixed(1)}%`}
          valueClass="text-foreground"
        />
        <MetricRow
          label="Revenue"
          value={fmtMoney(tip.point.revenue ?? 0, currency)}
          valueClass="text-foreground"
        />
        <MetricRow label="Growth" value={growthText} valueClass={growthClass} />
      </div>
      <div className="mt-2.5 text-[10px] text-muted-foreground font-medium tracking-wide">
        Click to drill down
      </div>
    </ChartTooltipPortal>
  );
}

export function AnimatedCounter({
  value,
  className = "",
  prefix = "",
  suffix = "",
  duration = 900,
}: {
  value: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  const preferReduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (preferReduced || !Number.isFinite(value)) {
      setShown(value || 0);
      fromRef.current = value || 0;
      return;
    }
    const from = fromRef.current;
    const to = value || 0;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, preferReduced]);

  const display = `${prefix}${fmtNum(Math.round(shown))}${suffix}`;
  return (
    <span className={`tabular-nums inline-block ${className}`}>{display}</span>
  );
}

export function GlassCard({
  title,
  subtitle,
  children,
  actions,
  chartRef,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  chartRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <article
      data-chart-surface="card"
      className={[
        "group/card relative overflow-hidden rounded-md border border-border",
        "bg-card shadow-none",
        "p-3.5 sm:p-4",
        "min-w-0",
        className,
      ].join(" ")}
    >
      <div className="relative flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {actions}
          {chartRef && <ExportButtons targetRef={chartRef} title={title} />}
        </div>
      </div>
      <div ref={chartRef} className="relative">
        {children}
      </div>
    </article>
  );
}

function ExportButtons({
  targetRef,
  title,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  title: string;
}) {
  const exportPng = useCallback(async () => {
    const el = targetRef.current;
    if (!el) return;
    const svg = el.querySelector("svg");
    if (!svg) {
      window.print();
      return;
    }
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(Math.ceil(rect.width), 320);
    const h = Math.max(Math.ceil(rect.height), 180);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    // Inline computed colors so export is self-contained
    clone.querySelectorAll("[stroke],[fill]").forEach((node) => {
      const n = node as SVGElement;
      const cs = window.getComputedStyle(n);
      if (!n.getAttribute("stroke") && cs.stroke && cs.stroke !== "none") {
        n.setAttribute("stroke", cs.stroke);
      }
      if (!n.getAttribute("fill") && cs.fill && cs.fill !== "none") {
        n.setAttribute("fill", cs.fill);
      }
    });
    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>${xml}`],
      { type: "image/svg+xml;charset=utf-8" }
    );
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Flat light export surface (professional CRM reports)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [targetRef, title]);

  const exportPdf = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!w) return;
    const svg = el.querySelector("svg");
    w.document.write(`<!DOCTYPE html><html><head><title>${title} · Massive Mentor</title>
      <style>
        @page{margin:16mm}
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#ffffff;color:#111827;padding:32px;margin:0}
        .header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;border-bottom:1px solid #e5e7eb;padding-bottom:12px}
        h1{font-size:18px;margin:0;letter-spacing:-0.02em}
        .meta{font-size:11px;color:#6b7280}
        .chart{margin-top:8px} svg{max-width:100%;height:auto}
        .footer{margin-top:24px;font-size:10px;color:#9ca3af}
      </style></head><body>
      <div class="header"><div><h1>${title}</h1><div class="meta">Massive Mentor CRM · Analytics export</div></div>
      <div class="meta">${new Date().toLocaleString()}</div></div>
      <div class="chart">${svg ? svg.outerHTML : el.innerHTML}</div>
      <div class="footer">Confidential · Generated for authorized users only</div>
      <script>setTimeout(function(){window.print()},400)<\\/script>
      </body></html>`);
    w.document.close();
  }, [targetRef, title]);

  return (
    <>
      <button
        type="button"
        onClick={() => void exportPng()}
        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
        title="Export PNG"
      >
        PNG
      </button>
      <button
        type="button"
        onClick={exportPdf}
        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
        title="Export PDF"
      >
        PDF
      </button>
    </>
  );
}

export function EmptyChart({ label = "No Data Available" }: { label?: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center text-center px-4 py-6">
      <div className="mb-3 h-10 w-10 rounded-md bg-muted border border-border flex items-center justify-center text-muted-foreground">
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px]">
        Add CRM activity to populate this chart
      </p>
    </div>
  );
}

type CommonProps = {
  series: AnalyticPoint[];
  height?: number;
  currency?: string;
  onDrill?: (point: AnalyticPoint) => void;
  valueIsMoney?: boolean;
};

export function InteractiveAreaChart({
  series,
  height = 200,
  currency = "INR",
  onDrill,
  valueIsMoney = true,
}: CommonProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!series.length || series.every((s) => !s.value)) return <EmptyChart />;

  const max = Math.max(...series.map((s) => s.value), 1);
  const total = series.reduce((s, p) => s + p.value, 0);
  const w = 400;
  const h = height;
  const padX = 12;
  const padTop = 14;
  const padBot = 8;
  const chartH = h - padTop - padBot - 4;
  const pts = series.map((s, i) => {
    const x = padX + (i / Math.max(series.length - 1, 1)) * (w - padX * 2);
    const y = padTop + (1 - s.value / max) * chartH;
    return { x, y, s };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const gridYs = [0.25, 0.5, 0.75, 1].map((t) => padTop + (1 - t) * chartH);

  return (
    <div
      className="relative w-full select-none"
      style={{ minHeight: height }}
      data-chart-surface
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full text-border" preserveAspectRatio="none">
        {gridYs.map((y) => (
          <line
            key={y}
            x1={padX}
            x2={w - padX}
            y1={y}
            y2={y}
            stroke={GRID_STROKE}
            strokeWidth="1"
            opacity="0.55"
          />
        ))}
        <path
          d={line}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map((p, i) => (
          <g key={p.s.name + i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="12"
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const point = {
                  ...p.s,
                  count: p.s.count ?? p.s.value,
                  revenue: valueIsMoney ? p.s.value : p.s.revenue ?? 0,
                };
                setTip(
                  tipFromEvent(e, {
                    point,
                    pct: total > 0 ? (p.s.value / total) * 100 : 0,
                    growth: growthPct(p.s.value, p.s.previous),
                    color: LINE_COLOR,
                  })
                );
              }}
              onMouseMove={(e) => {
                setTip((prev) =>
                  prev
                    ? {
                        ...prev,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        boundary:
                          readChartSurfaceBoundary(e.currentTarget) ??
                          prev.boundary,
                      }
                    : prev
                );
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(p.s)}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r="3.5"
              fill={LINE_COLOR}
              stroke="var(--card)"
              strokeWidth="1.5"
              className="pointer-events-none"
            />
          </g>
        ))}
      </svg>
      <div className="flex justify-between gap-0.5 px-1 mt-0.5 overflow-hidden">
        {series.map((s, i) => (
          <span
            key={s.name + i}
            className="text-[9px] sm:text-[10px] text-muted-foreground truncate max-w-[3.5rem] text-center flex-1"
            title={s.name}
          >
            {s.name}
          </span>
        ))}
      </div>
      {tip && <ChartTooltip tip={tip} currency={currency} />}
    </div>
  );
}

export function InteractiveBarChart({
  series,
  height = 200,
  currency = "INR",
  onDrill,
  valueIsMoney: _valueIsMoney = false,
}: CommonProps) {
  void _valueIsMoney;
  const [tip, setTip] = useState<Tip | null>(null);
  if (!series.length || series.every((s) => !s.value)) return <EmptyChart />;
  const max = Math.max(...series.map((s) => s.value), 1);
  const total = series.reduce((s, p) => s + p.value, 0);
  const plotH = height - 36;

  return (
    <div className="relative" style={{ minHeight: height }} data-chart-surface>
      {/* Light horizontal grid */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{ top: 18, height: plotH }}
        aria-hidden
      >
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <div
            key={t}
            className="absolute left-0 right-0 border-t border-border/70"
            style={{ bottom: `${t * 100}%` }}
          />
        ))}
      </div>
      <div
        className="relative flex items-end gap-1.5 sm:gap-2 h-full px-0.5"
        style={{ height: plotH + 18, paddingTop: 18 }}
      >
        {series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          const pctH = (s.value / max) * 100;
          return (
            <button
              type="button"
              key={s.name + i}
              className="flex-1 min-w-0 flex flex-col items-center gap-1 group h-full justify-end focus-ring rounded-sm"
              onMouseEnter={(e) => {
                setTip(
                  tipFromEvent(e, {
                    point: s,
                    pct: total > 0 ? (s.value / total) * 100 : 0,
                    growth: growthPct(s.value, s.previous),
                    color,
                  })
                );
              }}
              onMouseMove={(e) => {
                setTip((prev) =>
                  prev
                    ? {
                        ...prev,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        boundary:
                          readChartSurfaceBoundary(e.currentTarget) ??
                          prev.boundary,
                      }
                    : prev
                );
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(s)}
            >
              <span className="text-[10px] tabular-nums font-semibold text-foreground leading-none mb-0.5">
                {fmtNum(s.value)}
              </span>
              <div
                className="w-full max-w-[36px] rounded-sm transition-[height] duration-300 ease-out group-hover:opacity-90 origin-bottom"
                style={{
                  height: `${Math.max(pctH, 2)}%`,
                  background: color,
                }}
              />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {s.name}
              </span>
            </button>
          );
        })}
      </div>
      {tip && <ChartTooltip tip={tip} currency={currency} />}
    </div>
  );
}

export function InteractiveDonutChart({
  series,
  currency = "INR",
  onDrill,
  centerLabel,
}: CommonProps & { centerLabel?: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!series.length || series.every((s) => !s.value)) {
    return <EmptyChart label="No Data Available" />;
  }
  const total = series.reduce((s, p) => s + p.value, 0) || 1;
  const r = 68;
  const stroke = 18;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const slices = series.map((s, i) => {
    const len = (s.value / total) * c;
    const slice = {
      ...s,
      color: s.color || PALETTE[i % PALETTE.length],
      dash: `${len} ${c - len}`,
      offset,
    };
    offset -= len;
    return slice;
  });

  return (
    <div
      className="relative flex flex-col sm:flex-row items-center gap-4 sm:gap-5 min-h-[180px]"
      data-chart-surface
    >
      <div className="relative shrink-0 w-[168px] h-[168px] sm:w-[180px] sm:h-[180px]">
        <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
          <circle
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          {slices.map((s) => (
            <circle
              key={s.name}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={s.dash}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
              className="cursor-pointer hover:opacity-90"
              onMouseEnter={(e) => {
                setTip(
                  tipFromEvent(e, {
                    point: s,
                    pct: (s.value / total) * 100,
                    growth: growthPct(s.value, s.previous),
                    color: s.color!,
                  })
                );
              }}
              onMouseMove={(e) => {
                setTip((prev) =>
                  prev
                    ? {
                        ...prev,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        boundary:
                          readChartSurfaceBoundary(e.currentTarget) ??
                          prev.boundary,
                      }
                    : prev
                );
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(s)}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-semibold tabular-nums text-foreground tracking-tight">
            {fmtNum(total)}
          </span>
          <span className="text-[10px] text-muted-foreground font-medium mt-0.5">
            {centerLabel || "total"}
          </span>
        </div>
      </div>
      <ul className="flex-1 space-y-1 min-w-0 w-full max-h-48 overflow-y-auto pr-1">
        {slices.map((s) => (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onDrill?.(s)}
              className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors text-left py-1 px-1 rounded-md hover:bg-muted"
            >
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0 border border-border"
                style={{ background: s.color }}
              />
              <span className="truncate flex-1 font-medium">{s.name}</span>
              <span className="tabular-nums text-foreground font-semibold">
                {fmtNum(s.value)}
              </span>
              <span className="tabular-nums text-muted-foreground w-10 text-right text-[11px]">
                {((s.value / total) * 100).toFixed(0)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
      {tip && <ChartTooltip tip={tip} currency={currency} />}
    </div>
  );
}

export function InteractiveFunnelChart({
  series,
  currency = "INR",
  onDrill,
}: CommonProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!series.length || series.every((s) => !s.value)) return <EmptyChart label="No funnel data" />;
  const max = Math.max(...series.map((s) => s.value), 1);
  const funnelBase = series[0]?.value || 1;
  const W = 320;
  const stageH = 34;
  const gap = 3;
  const minW = W * 0.28;
  const n = series.length;
  const H = n * stageH + Math.max(0, n - 1) * gap;

  const widthFor = (value: number, index: number) => {
    // Value-weighted width with progressive taper so the funnel always reads top→bottom
    const valueW = (value / max) * W;
    const taperW = W * (1 - (index / Math.max(n, 1)) * 0.55);
    return Math.max(minW, Math.min(W, (valueW * 0.65 + taperW * 0.35)));
  };

  return (
    <div className="relative w-full py-1" data-chart-surface>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto max-h-[280px]"
        role="img"
        aria-label="Conversion funnel"
      >
        {series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          const topW = widthFor(s.value, i);
          const next = series[i + 1];
          const botW = next ? widthFor(next.value, i + 1) : Math.max(minW, topW * 0.82);
          const y = i * (stageH + gap);
          const topX = (W - topW) / 2;
          const botX = (W - botW) / 2;
          const points = `${topX},${y} ${topX + topW},${y} ${botX + botW},${y + stageH} ${botX},${y + stageH}`;
          const conv = i === 0 ? 100 : (s.value / funnelBase) * 100;
          const labelY = y + stageH / 2 + 4;
          return (
            <g
              key={s.name}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                setTip(
                  tipFromEvent(e, {
                    point: { ...s, count: s.value },
                    pct: conv,
                    growth: growthPct(s.value, s.previous),
                    color,
                  })
                );
              }}
              onMouseMove={(e) => {
                setTip((prev) =>
                  prev
                    ? {
                        ...prev,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        boundary:
                          readChartSurfaceBoundary(e.currentTarget) ??
                          prev.boundary,
                      }
                    : prev
                );
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(s)}
            >
              <polygon points={points} fill={color} className="hover:opacity-90" />
              <text
                x={W / 2}
                y={labelY}
                textAnchor="middle"
                className="pointer-events-none"
                style={{ fontSize: 11, fontWeight: 600, fill: "#ffffff" }}
              >
                {s.name.length > 28 ? `${s.name.slice(0, 26)}…` : s.name}
                {`  ·  ${fmtNum(s.value)}`}
              </text>
            </g>
          );
        })}
      </svg>
      {tip && <ChartTooltip tip={tip} currency={currency} />}
    </div>
  );
}

export function InteractiveHorizontalBar({
  series,
  currency = "INR",
  onDrill,
  valueIsMoney = true,
}: CommonProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (!series.length || series.every((s) => !s.value && !s.count)) {
    return <EmptyChart label="No executive revenue yet" />;
  }
  const max = Math.max(...series.map((s) => s.value), 1);
  const total = series.reduce((s, p) => s + p.value, 0) || 1;

  return (
    <div className="relative space-y-2.5" data-chart-surface>
      {series.map((s, i) => {
        const color = PALETTE[i % PALETTE.length];
        const w = (s.value / max) * 100;
        return (
          <button
            type="button"
            key={s.name + i}
            className="w-full text-left group focus-ring rounded-lg"
            onMouseEnter={(e) => {
              setTip(
                tipFromEvent(e, {
                  point: { ...s, count: s.count ?? s.value },
                  pct: (s.value / total) * 100,
                  growth: growthPct(s.value, s.previous),
                  color,
                })
              );
            }}
            onMouseMove={(e) => {
              setTip((prev) =>
                prev
                  ? {
                      ...prev,
                      clientX: e.clientX,
                      clientY: e.clientY,
                      boundary:
                        readChartSurfaceBoundary(e.currentTarget) ??
                        prev.boundary,
                    }
                  : prev
              );
            }}
            onMouseLeave={() => setTip(null)}
            onClick={() => onDrill?.(s)}
          >
            <div className="flex justify-between text-[11px] mb-1 gap-2">
              <span className="text-muted-foreground truncate font-medium">{s.name}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">
                {valueIsMoney ? fmtMoney(s.value, currency) : fmtNum(s.value)}
              </span>
            </div>
            <div className="h-2 rounded-sm bg-muted overflow-hidden border border-border/60">
              <div
                className="h-full rounded-sm transition-[width] duration-300 ease-out group-hover:opacity-90"
                style={{
                  width: `${Math.max(w, 2)}%`,
                  background: color,
                }}
              />
            </div>
          </button>
        );
      })}
      {tip && <ChartTooltip tip={tip} currency={currency} />}
    </div>
  );
}
