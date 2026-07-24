"use client";

import { useState } from "react";
import { ConfigChart, type ChartPoint } from "@/components/dashboard/charts/ConfigChart";
import { useRouter } from "next/navigation";
import { useBusinessCurrency } from "@/lib/use-business-currency";

export type RuntimeWidget = {
  widgetKey: string;
  type: string;
  chartType?: string;
  title: string;
  value?: number | null;
  series?: ChartPoint[];
  items?: Array<Record<string, unknown>>;
  drillDown?: { enabled: boolean; entity?: string; route?: string; filterField?: string };
  meta?: Record<string, unknown>;
  description?: string;
};

type Props = {
  widgets: RuntimeWidget[];
  onDrill?: (widget: RuntimeWidget, point: ChartPoint) => void;
  loading?: boolean;
};

function isMoneyWidget(widget: RuntimeWidget): boolean {
  const t = `${widget.title || ""} ${widget.type || ""} ${widget.widgetKey || ""}`.toLowerCase();
  return (
    widget.type === "metric_sum" ||
    t.includes("revenue") ||
    t.includes("value") ||
    t.includes("pipeline") ||
    t.includes("invoice") ||
    t.includes("expense") ||
    t.includes("profit") ||
    t.includes("payment") ||
    t.includes("outstanding") ||
    t.includes("forecast") ||
    t.includes("amount") ||
    t.includes("gst") ||
    t.includes("tax")
  );
}

function metricExplanation(widget: RuntimeWidget): string {
  if (widget.description) return widget.description;
  const t = (widget.title || "").toLowerCase();
  const type = widget.type;
  if (type === "metric_sum" || t.includes("revenue") || t.includes("value")) {
    return "Total monetary value of matching records in the selected date range. Higher usually means stronger pipeline or closed business.";
  }
  if (type === "nps_average" || t.includes("nps") || t.includes("score")) {
    return "Average score across scored records. Use it to track quality or satisfaction trends.";
  }
  if (t.includes("conversion") || t.includes("win rate")) {
    return "Share of opportunities that progressed or closed. Compare segments by clicking the chart.";
  }
  if (t.includes("task") || type === "tasks_due") {
    return "Open work items assigned in this period. Overdue or high counts may need prioritization.";
  }
  if (widget.chartType === "funnel" || type === "pipeline_funnel") {
    return "Stage distribution of your pipeline. Click a stage to open filtered records.";
  }
  if (widget.chartType === "pie" || widget.chartType === "donut") {
    return "Share of total by category. Hover for value, percentage, and trend; click to filter.";
  }
  if (type === "metric_count" || type === "metric_kpi") {
    return "Count of matching records for your role and date range. Click charts below for breakdowns.";
  }
  return "Role-aware metric from your business configuration. Hover for details; click segments to explore related data.";
}

function buildAiInsight(widget: RuntimeWidget): string {
  const series = widget.series || [];
  const total = series.reduce((s, p) => s + (p.value || 0), 0);
  const title = widget.title || "This metric";

  if (
    widget.type === "metric_kpi" ||
    widget.type === "metric_count" ||
    widget.type === "metric_sum" ||
    widget.type === "nps_average"
  ) {
    const v = widget.value;
    if (v == null) return `AI: Not enough data yet to analyze ${title}.`;
    if (v === 0) return `AI: ${title} is at zero — add CRM activity or widen the date range to surface trends.`;
    if (typeof v === "number" && v > 0) {
      return `AI: ${title} stands at ${v.toLocaleString()}. Focus on consistent pipeline hygiene so this stays predictable week over week.`;
    }
  }

  if (!series.length || total === 0) {
    return `AI: No series data for ${title}. Once records exist, insights will highlight concentration and outliers.`;
  }

  const sorted = [...series].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const topPct = total > 0 ? (top.value / total) * 100 : 0;

  if (topPct >= 50) {
    return `AI: “${top.name}” dominates ${title} (${topPct.toFixed(0)}% of total). Diversify or double-down intentionally — avoid single-segment risk.`;
  }
  if (sorted.length >= 2 && top.value > bottom.value * 3) {
    return `AI: Wide spread in ${title}: “${top.name}” leads while “${bottom.name}” lags. Review process differences between segments.`;
  }
  return `AI: ${title} is relatively balanced across ${sorted.length} segments. Top driver: “${top.name}” (${top.value.toLocaleString()}). Click a segment to inspect records.`;
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="w-4 h-4 rounded-full border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-border flex items-center justify-center"
        aria-label="What this metric means"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className="absolute right-0 top-5 z-30 w-56 sm:w-64 rounded-xl border border-border bg-background p-2.5 text-[11px] leading-relaxed text-muted-foreground shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

function WidgetSkeleton() {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 animate-pulse">
      <div className="h-4 w-1/3 bg-muted rounded mb-4" />
      <div className="h-28 bg-muted/80 rounded-xl" />
      <div className="h-3 w-2/3 bg-muted rounded mt-3" />
    </div>
  );
}

/**
 * Host switches only on widget.type / chartType — never on industry.
 */
export function DashboardWidgetHost({ widgets, onDrill, loading }: Props) {
  const router = useRouter();
  const { money } = useBusinessCurrency();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const handleDrill = (widget: RuntimeWidget, point: ChartPoint) => {
    if (onDrill) {
      onDrill(widget, point);
      return;
    }
    setActiveFilter(`${widget.widgetKey}:${point.name}`);
    if (!widget.drillDown?.enabled && !widget.drillDown?.route) {
      // Best-effort routes by entity naming without changing CRM logic
      const entity = (widget.drillDown?.entity || "").toLowerCase();
      const route =
        widget.drillDown?.route ||
        (entity.includes("deal")
          ? "/dashboard/deals"
          : entity.includes("task")
            ? "/dashboard/tasks"
            : entity.includes("meeting")
              ? "/dashboard/meetings"
              : "/dashboard/leads");
      const field = widget.drillDown?.filterField || "status";
      router.push(`${route}?${encodeURIComponent(field)}=${encodeURIComponent(point.name)}`);
      return;
    }
    const route = widget.drillDown.route || "/dashboard/leads";
    const field = widget.drillDown.filterField || "status";
    router.push(`${route}?${encodeURIComponent(field)}=${encodeURIComponent(point.name)}`);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="xl:col-span-3">
            <WidgetSkeleton />
          </div>
        ))}
        {[5, 6].map((i) => (
          <div key={i} className="xl:col-span-6">
            <WidgetSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (!widgets.length) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center">
        <p className="text-muted-foreground text-sm font-medium">No widgets for this role</p>
        <p className="text-muted-foreground text-xs mt-1">
          Your portal role determines which KPIs and charts appear. Contact a Business Admin if this looks wrong.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeFilter && (
        <div className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
          <span>Chart filter active: {activeFilter.split(":")[1]}</span>
          <button
            type="button"
            className="underline text-emerald-400/80 hover:text-emerald-300"
            onClick={() => setActiveFilter(null)}
          >
            Clear
          </button>
        </div>
      )}
      {/*
        Adaptive grid:
        - Mobile: 2-col KPIs, full-width charts
        - Tablet: 2-col mix
        - Desktop: 12-col professional dashboard
      */}
      <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-12 gap-3 sm:gap-4">
        {widgets.map((w) => {
          const isChart =
            w.type === "chart" || w.type === "pipeline_funnel" || w.chartType === "gauge";
          const isMetric =
            w.type === "metric_kpi" ||
            w.type === "metric_count" ||
            w.type === "metric_sum" ||
            w.type === "nps_average";
          const isList =
            w.type === "list" || w.type === "tasks_due" || w.type === "feedback_recent";
          const span = isMetric
            ? "col-span-1 xl:col-span-3"
            : w.chartType === "gauge"
              ? "col-span-2 md:col-span-1 xl:col-span-3"
              : isChart || isList
                ? "col-span-2 xl:col-span-6"
                : "col-span-2 xl:col-span-6";
          const explain = metricExplanation(w);
          const insight = buildAiInsight(w);

          return (
            <div
              key={w.widgetKey}
              className={`bg-card border border-border rounded-2xl p-3 sm:p-4 flex flex-col min-w-0 ${span}`}
            >
              <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
                <h3 className="text-xs sm:text-sm font-medium text-foreground leading-snug line-clamp-2">
                  {w.title}
                </h3>
                <div className="flex items-center gap-2 shrink-0">
                  {w.drillDown?.enabled && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground hidden md:inline">
                      Clickable
                    </span>
                  )}
                  <InfoTip text={explain} />
                </div>
              </div>

              {isMetric && (
                <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-foreground mb-1">
                  {typeof w.value === "number"
                    ? isMoneyWidget(w)
                      ? money(w.value)
                      : w.value.toLocaleString()
                    : "—"}
                </div>
              )}

              {isChart && (
                <div className="flex-1 chart-frame min-w-0 overflow-hidden">
                  <ConfigChart
                    chartType={w.chartType || "bar"}
                    series={w.series || []}
                    value={w.value}
                    title={w.title}
                    description={explain}
                    onDrill={(p) => handleDrill(w, p)}
                  />
                </div>
              )}

              {(w.type === "list" || w.type === "tasks_due" || w.type === "feedback_recent") && (
                <ul className="divide-y divide-border text-sm flex-1">
                  {(w.items || []).length === 0 && (
                    <li className="py-6 text-center text-muted-foreground text-xs">No items in this period</li>
                  )}
                  {(w.items || []).map((item, idx) => (
                    <li key={String(item.id || idx)} className="py-2 flex justify-between gap-2">
                      <span className="text-foreground truncate">
                        {String(item.title || item.name || "—")}
                      </span>
                      <span className="text-muted-foreground text-xs shrink-0">
                        {String(item.status || item.dueDate || "")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-2 sm:mt-3 text-[10px] sm:text-[11px] leading-relaxed text-muted-foreground border-t border-border/80 pt-2 line-clamp-3 sm:line-clamp-none">
                <span className="text-emerald-500/80 font-medium">AI insight · </span>
                {insight.replace(/^AI:\s*/, "")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
