"use client";

/**
 * Interactive SaaS analytics charts — SVG, tooltips, drill-down, export.
 * Dark-mode first, glass-friendly, no heavy chart library.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

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

const PALETTE = [
  "#8b5cf6",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#2dd4bf",
  "#fb923c",
  "#a78bfa",
  "#22d3ee",
  "#c084fc",
];

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
  x: number;
  y: number;
  point: AnalyticPoint;
  pct: number;
  growth: number | null;
  color: string;
};

function ChartTooltip({
  tip,
  currency,
}: {
  tip: Tip;
  currency?: string;
}) {
  const growth = tip.growth;
  return (
    <div
      className="pointer-events-none absolute z-30 min-w-[180px] max-w-[260px] rounded-2xl border border-white/12 bg-zinc-950/98 px-3.5 py-3 shadow-2xl shadow-black/60 backdrop-blur-xl text-left ring-1 ring-white/5"
      style={{
        left: tip.x,
        top: tip.y,
        transform: "translate(-50%, calc(-100% - 14px))",
      }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-white/15 shadow-[0_0_8px_currentColor]"
          style={{ background: tip.color, color: tip.color }}
        />
        <span className="text-xs font-semibold text-white truncate tracking-tight">
          {tip.point.name}
        </span>
      </div>
      <div className="space-y-1.5 text-[11px]">
        <div className="flex justify-between gap-6">
          <span className="text-zinc-500">Count</span>
          <span className="tabular-nums text-zinc-100 font-semibold">
            {fmtNum(tip.point.count ?? tip.point.value)}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-zinc-500">Share</span>
          <span className="tabular-nums text-sky-300 font-semibold">{tip.pct.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-zinc-500">Revenue</span>
          <span className="tabular-nums text-emerald-300 font-semibold">
            {fmtMoney(tip.point.revenue ?? 0, currency)}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-zinc-500">Growth</span>
          <span
            className={`tabular-nums font-semibold ${
              growth == null
                ? "text-zinc-500"
                : growth >= 0
                  ? "text-emerald-400"
                  : "text-red-400"
            }`}
          >
            {growth == null
              ? "—"
              : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth).toFixed(1)}%`}
          </span>
        </div>
      </div>
      <div className="mt-2.5 text-[10px] text-zinc-600 font-medium tracking-wide">
        Click to drill down
      </div>
    </div>
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
      className={[
        "group/card relative overflow-hidden rounded-3xl border border-white/10",
        "bg-gradient-to-br from-white/[0.07] via-zinc-900/65 to-zinc-950/85",
        "backdrop-blur-xl shadow-xl shadow-black/25",
        "p-4 sm:p-5 transition-all duration-300 hover:border-white/18 hover:shadow-violet-950/25",
        "min-w-0 mm-card-hover",
        className,
      ].join(" ")}
    >
      <div
        className="pointer-events-none absolute -top-16 -right-12 h-36 w-36 rounded-full bg-violet-500/12 blur-3xl group-hover/card:bg-violet-500/18 transition-colors"
        aria-hidden
      />
      <div className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-sky-500/8 blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{subtitle}</p>
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
      ctx.fillStyle = "#09090b";
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
        body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#09090b;color:#fafafa;padding:32px;margin:0}
        .header{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:20px;border-bottom:1px solid #27272a;padding-bottom:12px}
        h1{font-size:18px;margin:0;letter-spacing:-0.02em}
        .meta{font-size:11px;color:#71717a}
        .chart{margin-top:8px} svg{max-width:100%;height:auto}
        .footer{margin-top:24px;font-size:10px;color:#52525b}
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
        className="text-[10px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 focus-ring"
        title="Export PNG"
      >
        PNG
      </button>
      <button
        type="button"
        onClick={exportPdf}
        className="text-[10px] px-2 py-1 rounded-lg border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 focus-ring"
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
      <div className="mb-3 h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-sky-500/5 border border-white/10 flex items-center justify-center text-zinc-500">
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-300">{label}</p>
      <p className="text-[11px] text-zinc-600 mt-1 max-w-[200px]">
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
  const uid = useId().replace(/:/g, "");
  if (!series.length || series.every((s) => !s.value)) return <EmptyChart />;

  const max = Math.max(...series.map((s) => s.value), 1);
  const total = series.reduce((s, p) => s + p.value, 0);
  const w = 400;
  const h = height;
  const pad = 16;
  const pts = series.map((s, i) => {
    const x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
    const y = pad + (1 - s.value / max) * (h - pad * 2 - 20);
    return { x, y, s };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${h - pad} L${pts[0].x},${h - pad} Z`;

  return (
    <div className="relative w-full select-none" style={{ minHeight: height }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`stroke-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <path
          d={area}
          fill={`url(#area-${uid})`}
          className="transition-all duration-700"
          style={{ opacity: 0.95 }}
        />
        <path
          d={line}
          fill="none"
          stroke={`url(#stroke-${uid})`}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]"
          style={{
            strokeDasharray: 1200,
            strokeDashoffset: 0,
            animation: "mm-fade-up 0.6s ease-out both",
          }}
        />
        {/* Invisible hit area for easier hover on sparse points */}
        {pts.map((p, i) => (
          <g key={p.s.name + i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="14"
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={(e) => {
                const parent = (e.target as SVGElement).closest(".relative") as HTMLElement;
                const pr = parent?.getBoundingClientRect();
                if (!pr) return;
                const point = {
                  ...p.s,
                  count: p.s.count ?? p.s.value,
                  revenue: valueIsMoney ? p.s.value : p.s.revenue ?? 0,
                };
                setTip({
                  x: e.clientX - pr.left,
                  y: e.clientY - pr.top,
                  point,
                  pct: total > 0 ? (p.s.value / total) * 100 : 0,
                  growth: growthPct(p.s.value, p.s.previous),
                  color: "#a78bfa",
                });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(p.s)}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r="5"
              fill="#a78bfa"
              stroke="#09090b"
              strokeWidth="2"
              className="pointer-events-none"
            />
          </g>
        ))}
      </svg>
      <div className="flex justify-between gap-0.5 px-1 mt-1 overflow-hidden">
        {series.map((s, i) => (
          <span
            key={s.name + i}
            className="text-[9px] sm:text-[10px] text-zinc-600 truncate max-w-[3.5rem] text-center flex-1"
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

  return (
    <div className="relative" style={{ minHeight: height }}>
      <div className="flex items-end gap-1.5 sm:gap-2 h-full px-1 pt-2" style={{ height: height - 28 }}>
        {series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          const pctH = (s.value / max) * 100;
          return (
            <button
              type="button"
              key={s.name + i}
              className="flex-1 min-w-0 flex flex-col items-center gap-1 group h-full justify-end focus-ring rounded-t-lg"
              onMouseEnter={(e) => {
                const pr = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                if (!pr) return;
                setTip({
                  x: e.clientX - pr.left,
                  y: e.clientY - pr.top,
                  point: s,
                  pct: total > 0 ? (s.value / total) * 100 : 0,
                  growth: growthPct(s.value, s.previous),
                  color,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(s)}
            >
              <div
                className="w-full max-w-[40px] rounded-t-lg transition-all duration-500 ease-out group-hover:brightness-125 group-hover:scale-x-105 origin-bottom motion-safe:animate-[mm-bar-grow_0.55s_ease-out]"
                style={{
                  height: `${Math.max(pctH, 3)}%`,
                  background: `linear-gradient(180deg, ${color}, ${color}55)`,
                  boxShadow: `0 0 20px ${color}33`,
                  transformOrigin: "bottom",
                }}
              />
              <span className="w-full truncate text-center text-[10px] text-zinc-500 group-hover:text-zinc-300">
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
    <div className="relative flex flex-col sm:flex-row items-center gap-5 sm:gap-6 min-h-[200px]">
      <div className="relative shrink-0 w-[200px] h-[200px] sm:w-[220px] sm:h-[220px]">
        <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
          <circle
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke="#27272a"
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
              className="cursor-pointer transition-all duration-300 hover:opacity-90"
              style={{ filter: `drop-shadow(0 0 10px ${s.color}55)` }}
              onMouseEnter={(e) => {
                const parent = (
                  e.currentTarget.closest(".relative.flex") as HTMLElement | null
                )?.getBoundingClientRect();
                if (!parent) return;
                setTip({
                  x: e.clientX - parent.left,
                  y: e.clientY - parent.top,
                  point: s,
                  pct: (s.value / total) * 100,
                  growth: growthPct(s.value, s.previous),
                  color: s.color!,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onClick={() => onDrill?.(s)}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold tabular-nums text-white tracking-tight">
            {fmtNum(total)}
          </span>
          <span className="text-[11px] text-zinc-500 font-medium mt-0.5">
            {centerLabel || "total"}
          </span>
        </div>
      </div>
      <ul className="flex-1 space-y-2 min-w-0 w-full max-h-52 overflow-y-auto pr-1">
        {slices.map((s) => (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onDrill?.(s)}
              className="w-full flex items-center gap-2.5 text-xs text-zinc-400 hover:text-white transition-colors text-left py-1.5 px-1.5 rounded-lg hover:bg-white/[0.04]"
            >
              <span
                className="h-3 w-3 rounded-full shrink-0 ring-2 ring-white/10"
                style={{ background: s.color }}
              />
              <span className="truncate flex-1 font-medium">{s.name}</span>
              <span className="tabular-nums text-zinc-200 font-semibold">
                {fmtNum(s.value)}
              </span>
              <span className="tabular-nums text-zinc-500 w-12 text-right font-medium">
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

  return (
    <div className="relative space-y-2 py-1">
      {series.map((s, i) => {
        const color = PALETTE[i % PALETTE.length];
        const widthPct = Math.max(18, (s.value / max) * 100);
        const conv = i === 0 ? 100 : (s.value / funnelBase) * 100;
        return (
          <button
            type="button"
            key={s.name}
            className="w-full flex flex-col items-center gap-0.5 group focus-ring rounded-lg"
            onMouseEnter={(e) => {
              const pr = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
              if (!pr) return;
              setTip({
                x: e.clientX - pr.left,
                y: e.clientY - pr.top,
                point: { ...s, count: s.value },
                pct: conv,
                growth: growthPct(s.value, s.previous),
                color,
              });
            }}
            onMouseLeave={() => setTip(null)}
            onClick={() => onDrill?.(s)}
          >
            <div
              className="h-9 sm:h-10 rounded-lg flex items-center justify-between px-3 text-xs font-medium text-white transition-all duration-500 group-hover:brightness-110"
              style={{
                width: `${widthPct}%`,
                background: `linear-gradient(90deg, ${color}, ${color}99)`,
                boxShadow: `0 4px 20px ${color}33`,
              }}
            >
              <span className="truncate">{s.name}</span>
              <span className="tabular-nums ml-2">{fmtNum(s.value)}</span>
            </div>
          </button>
        );
      })}
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
    <div className="relative space-y-2.5">
      {series.map((s, i) => {
        const color = PALETTE[i % PALETTE.length];
        const w = (s.value / max) * 100;
        return (
          <button
            type="button"
            key={s.name + i}
            className="w-full text-left group focus-ring rounded-lg"
            onMouseEnter={(e) => {
              const pr = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
              if (!pr) return;
              setTip({
                x: e.clientX - pr.left,
                y: e.clientY - pr.top,
                point: { ...s, count: s.count ?? s.value },
                pct: (s.value / total) * 100,
                growth: growthPct(s.value, s.previous),
                color,
              });
            }}
            onMouseLeave={() => setTip(null)}
            onClick={() => onDrill?.(s)}
          >
            <div className="flex justify-between text-[11px] mb-1 gap-2">
              <span className="text-zinc-300 truncate font-medium">{s.name}</span>
              <span className="tabular-nums text-zinc-400 shrink-0">
                {valueIsMoney ? fmtMoney(s.value, currency) : fmtNum(s.value)}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-zinc-800/80 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out group-hover:brightness-125"
                style={{
                  width: `${Math.max(w, 2)}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}aa)`,
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
