"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type PremiumKpiProps = {
  label: string;
  value: number;
  href?: string;
  /** Money formatting callback; if set, value is treated as currency amount */
  formatMoney?: (n: number) => string;
  /** Percentage growth vs prior period */
  growth?: number | null;
  /** Prior period value for comparison text */
  previous?: number | null;
  /** Sparkline series (relative heights) */
  sparkline?: number[];
  /** Tailwind gradient tone classes for card border/bg */
  tone?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  suffix?: string;
  className?: string;
};

function useAnimatedNumber(value: number, duration = 900) {
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
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, preferReduced]);

  return shown;
}

function Sparkline({
  data,
  positive,
}: {
  data: number[];
  positive?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const w = 72;
  const h = 28;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const stroke = positive === false ? "#f87171" : "#34d399";
  const fillId = `spark-${uid}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible opacity-90"
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${fillId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PremiumKpi({
  label,
  value,
  href,
  formatMoney,
  growth,
  previous,
  sparkline,
  tone = "from-zinc-500/15 to-zinc-500/5 border-border/20",
  icon,
  loading,
  suffix = "",
  className = "",
}: PremiumKpiProps) {
  const animated = useAnimatedNumber(loading ? 0 : value);
  const positive = growth == null ? undefined : growth >= 0;

  const display = formatMoney
    ? formatMoney(Math.round(animated))
    : `${Math.round(animated).toLocaleString()}${suffix}`;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/25 border border-white/5 text-current">
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <div className="mm-skeleton h-8 w-24" />
          <div className="mm-skeleton h-3 w-16" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-end justify-between gap-2">
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
              {display}
            </div>
            {sparkline && sparkline.length > 1 ? (
              <Sparkline data={sparkline} positive={positive !== false} />
            ) : null}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[1.25rem]">
            {growth != null ? (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums ${
                  growth >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                <span aria-hidden>{growth >= 0 ? "▲" : "▼"}</span>
                {Math.abs(growth)}%
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">—</span>
            )}
            {previous != null && (
              <span className="text-[11px] text-muted-foreground">
                vs {formatMoney ? formatMoney(previous) : previous.toLocaleString()} prior
              </span>
            )}
            {previous == null && growth != null && (
              <span className="text-[11px] text-muted-foreground">vs prior</span>
            )}
          </div>
        </>
      )}
    </>
  );

  const cls = [
    "mm-card-hover group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 focus-ring",
    "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity",
    "before:bg-[radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.12),transparent_55%)]",
    "hover:before:opacity-100",
    tone,
    className,
  ].join(" ");

  if (href) {
    return (
      <Link href={href} className={cls} aria-label={`${label}: ${display}`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} role="group" aria-label={label}>
      {body}
    </div>
  );
}

export function PremiumKpiSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card/50 p-4 ${className}`}
      aria-hidden
    >
      <div className="mm-skeleton h-3 w-16 mb-4" />
      <div className="mm-skeleton h-8 w-24 mb-3" />
      <div className="mm-skeleton h-3 w-20" />
    </div>
  );
}
