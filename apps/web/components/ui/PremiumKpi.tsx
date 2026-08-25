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
  /** Kept for API compat; ignored — cards use flat enterprise chrome */
  tone?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  suffix?: string;
  className?: string;
};

function useAnimatedNumber(value: number, duration = 600) {
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
  const w = 64;
  const h = 24;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const line = pts.join(" ");
  const stroke = positive === false ? "#dc2626" : "#059669";
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
          <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${fillId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
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
  tone: _tone,
  icon,
  loading,
  suffix = "",
  className = "",
}: PremiumKpiProps) {
  void _tone;
  const animated = useAnimatedNumber(loading ? 0 : value);
  const positive = growth == null ? undefined : growth >= 0;

  const display = formatMoney
    ? formatMoney(Math.round(animated))
    : `${Math.round(animated).toLocaleString("en-IN")}${suffix}`;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground leading-tight">
          {label}
        </span>
        {icon ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted border border-border text-muted-foreground">
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-2 space-y-2">
          <div className="mm-skeleton h-7 w-20" />
          <div className="mm-skeleton h-3 w-14" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="text-xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
              {display}
            </div>
            {sparkline && sparkline.length > 1 ? (
              <Sparkline data={sparkline} positive={positive !== false} />
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-[1.125rem]">
            {growth != null ? (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${
                  growth >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
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
                vs {formatMoney ? formatMoney(previous) : previous.toLocaleString("en-IN")} prior
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
    "mm-kpi-card mm-card-hover group relative focus-ring",
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
      className={`rounded-lg border border-border bg-card p-3.5 shadow-sm ${className}`}
      aria-hidden
    >
      <div className="mm-skeleton h-3 w-16 mb-3" />
      <div className="mm-skeleton h-7 w-20 mb-2" />
      <div className="mm-skeleton h-3 w-16" />
    </div>
  );
}
