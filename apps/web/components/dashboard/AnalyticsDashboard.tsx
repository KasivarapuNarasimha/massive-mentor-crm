"use client";

/**
 * Premium interactive analytics grid — full-tenant data from /reports/dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { useDataVersion } from "@/lib/data-events";
import {
  AnimatedCounter,
  GlassCard,
  InteractiveAreaChart,
  InteractiveBarChart,
  InteractiveDonutChart,
  InteractiveFunnelChart,
  InteractiveHorizontalBar,
  type AnalyticPoint,
  fmtMoney,
  fmtNum,
} from "@/components/dashboard/charts/InteractiveCharts";

type AnalyticsPayload = {
  totalLeads: number;
  totalClients: number;
  totalDeals: number;
  totalDealValue: number;
  pipelineValue: number;
  conversionRate: number;
  tasksDue: number;
  meetingsToday: number;
  leadSources?: AnalyticPoint[];
  leadSourcesTotal?: number;
  revenueTrend?: AnalyticPoint[];
  monthlySales?: AnalyticPoint[];
  leadsByStatus?: AnalyticPoint[];
  revenueByExecutive?: AnalyticPoint[];
  dailyLeadTrend?: AnalyticPoint[];
  conversionFunnel?: AnalyticPoint[];
  pipelineByStage?: Array<{ stage: string; count: number; value: number }>;
  wonDeals?: number;
  lostDeals?: number;
};

function ChartSkeleton() {
  return (
    <div className="h-[180px] animate-pulse rounded-md bg-muted border border-border" />
  );
}

export function AnalyticsDashboard() {
  const { token } = useAuth();
  const { currency } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refRevenue = useRef<HTMLDivElement>(null);
  const refSources = useRef<HTMLDivElement>(null);
  const refSales = useRef<HTMLDivElement>(null);
  const refStatus = useRef<HTMLDivElement>(null);
  const refStages = useRef<HTMLDivElement>(null);
  const refExec = useRef<HTMLDivElement>(null);
  const refDaily = useRef<HTMLDivElement>(null);
  const refFunnel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get<AnalyticsPayload>("/reports/dashboard", token);
    if (res.success && res.data) setData(res.data);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const drill = useCallback(
    (point: AnalyticPoint, kind: string) => {
      const f = point.filter || {};
      if (kind === "source") {
        const src = f.source ?? (point.name !== "Other" && point.name !== "Unknown" ? point.name : "");
        if (src) {
          router.push(`/dashboard/leads?search=${encodeURIComponent(src)}`);
        } else {
          router.push("/dashboard/leads");
        }
        return;
      }
      if (kind === "status") {
        const st = f.status || point.name;
        router.push(`/dashboard/leads?status=${encodeURIComponent(st)}`);
        return;
      }
      if (kind === "daily") {
        router.push("/dashboard/leads");
        return;
      }
      if (kind === "stage" || kind === "funnel") {
        const stage = f.stage || point.name.toLowerCase().replace(/\s+/g, "_");
        router.push(`/dashboard/deals?stage=${encodeURIComponent(stage)}`);
        return;
      }
      if (kind === "exec" || kind === "revenue" || kind === "sales") {
        router.push("/dashboard/deals");
      }
    },
    [router]
  );

  /** Attach sequential previous values so tooltips can show growth. */
  const withGrowth = (points: AnalyticPoint[]): AnalyticPoint[] =>
    points.map((p, i) => ({
      ...p,
      previous: p.previous ?? (i > 0 ? points[i - 1].value : undefined),
    }));

  // Normalize series with filters for drill-down
  const leadSources: AnalyticPoint[] = (data?.leadSources || []).map((s) => ({
    ...s,
    count: s.value,
    revenue: s.revenue ?? 0,
    filter: s.filter || {
      type: "lead",
      source: s.name === "Unknown" ? "" : s.name,
    },
  }));

  const revenueTrend: AnalyticPoint[] = withGrowth(
    (data?.revenueTrend || []).map((s) => ({
      ...s,
      revenue: s.value,
      count: s.count,
      filter: { month: s.key || s.name },
    }))
  );

  const monthlySales: AnalyticPoint[] = withGrowth(
    (data?.monthlySales || []).map((s) => ({
      ...s,
      revenue: s.value,
      filter: { month: s.key || s.name, stage: "closed_won" },
    }))
  );

  const leadsByStatus: AnalyticPoint[] = (data?.leadsByStatus || []).map((s) => ({
    ...s,
    count: s.value,
    revenue: s.revenue ?? 0,
    filter: s.filter || { type: "lead", status: s.name },
  }));

  const dealsByStage: AnalyticPoint[] = (data?.pipelineByStage || []).map((s) => ({
    name: s.stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    value: s.count,
    count: s.count,
    revenue: s.value,
    filter: { stage: s.stage },
  }));

  const revenueByExecutive: AnalyticPoint[] = (data?.revenueByExecutive || []).map(
    (s) => ({
      ...s,
      revenue: s.value,
      count: s.count,
    })
  );

  const dailyLeadTrend: AnalyticPoint[] = withGrowth(
    (data?.dailyLeadTrend || []).map((s) => ({
      ...s,
      count: s.value,
      revenue: 0,
      filter: { day: s.key || s.name },
    }))
  );

  const conversionFunnel: AnalyticPoint[] = withGrowth(
    (data?.conversionFunnel || []).map((s) => ({
      ...s,
      count: s.value,
      revenue: s.revenue ?? 0,
      filter: s.filter || { stage: (s as AnalyticPoint & { stage?: string }).stage || s.name },
    }))
  );

  // Donut: top slices + Other so sum = total
  const sourcesForDonut = (() => {
    const TOP = 7;
    if (leadSources.length <= TOP) return leadSources;
    const head = leadSources.slice(0, TOP - 1);
    const rest = leadSources.slice(TOP - 1).reduce((a, x) => a + x.value, 0);
    return [...head, { name: "Other", value: rest, count: rest }];
  })();

  if (loading && !data) {
    return (
      <section className="space-y-4" aria-busy="true" aria-label="Loading analytics">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-muted border border-border" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </section>
    );
  }

  const d = data;

  return (
    <section className="space-y-4 sm:space-y-5" aria-labelledby="analytics-heading">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="mm-section-label">Insights</p>
          <h2
            id="analytics-heading"
            className="text-lg sm:text-xl font-semibold tracking-tight text-foreground mt-1"
          >
            Analytics dashboard
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
            Full-tenant live aggregates · hover for details · click to drill down
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="mm-btn mm-btn-secondary min-h-9 px-3 text-xs self-start sm:self-auto focus-ring"
        >
          Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {[
          {
            label: "Total leads",
            value: d?.totalLeads ?? 0,
            tone: "border-border bg-card",
            href: "/dashboard/leads",
          },
          {
            label: "Pipeline value",
            value: d?.pipelineValue ?? 0,
            money: true,
            tone: "border-border bg-card",
            href: "/dashboard/deals",
          },
          {
            label: "Won deals",
            value: d?.wonDeals ?? 0,
            tone: "border-border bg-card",
            href: "/dashboard/deals?stage=closed_won",
          },
          {
            label: "Win rate",
            value: d?.conversionRate ?? 0,
            suffix: "%",
            tone: "border-border bg-card",
            href: "/dashboard/deals",
          },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => router.push(k.href)}
            className={`group text-left rounded-md border ${k.tone} p-3 focus-ring min-h-[76px] shadow-none`}
          >
            <div className="text-[11px] font-medium text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-semibold text-foreground tracking-tight tabular-nums">
              {k.money ? (
                <span key={k.value}>{fmtMoney(k.value, currency)}</span>
              ) : (
                <AnimatedCounter value={k.value} suffix={k.suffix || ""} />
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Chart grid — dense professional CRM layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        <GlassCard
          title="Revenue trend"
          subtitle="Pipeline value created by month"
          chartRef={refRevenue}
          className="xl:col-span-2 min-h-[240px]"
        >
          <InteractiveAreaChart
            series={revenueTrend}
            currency={currency}
            valueIsMoney
            onDrill={(p) => drill(p, "revenue")}
          />
        </GlassCard>

        <GlassCard
          title="Lead sources"
          subtitle={
            d?.leadSourcesTotal != null
              ? `${fmtNum(d.leadSourcesTotal)} leads total`
              : "Where leads come from"
          }
          chartRef={refSources}
        >
          <InteractiveDonutChart
            series={sourcesForDonut}
            currency={currency}
            centerLabel="leads"
            onDrill={(p) => drill(p, "source")}
          />
        </GlassCard>

        <GlassCard
          title="Monthly sales"
          subtitle="Closed-won deal value"
          chartRef={refSales}
        >
          <InteractiveBarChart
            series={monthlySales}
            currency={currency}
            valueIsMoney
            onDrill={(p) => drill(p, "sales")}
          />
        </GlassCard>

        <GlassCard
          title="Leads by status"
          subtitle="Full pipeline status mix"
          chartRef={refStatus}
        >
          <InteractiveBarChart
            series={leadsByStatus}
            currency={currency}
            onDrill={(p) => drill(p, "status")}
          />
        </GlassCard>

        <GlassCard
          title="Deals by stage"
          subtitle="Count & pipeline value"
          chartRef={refStages}
        >
          <InteractiveBarChart
            series={dealsByStage}
            currency={currency}
            onDrill={(p) => drill(p, "stage")}
          />
        </GlassCard>

        <GlassCard
          title="Revenue by executive"
          subtitle="Deal owner performance"
          chartRef={refExec}
        >
          <InteractiveHorizontalBar
            series={revenueByExecutive}
            currency={currency}
            valueIsMoney
            onDrill={(p) => drill(p, "exec")}
          />
        </GlassCard>

        <GlassCard
          title="Daily lead creation"
          subtitle="Last 14 days"
          chartRef={refDaily}
          className="xl:col-span-2 min-h-[220px]"
        >
          <InteractiveAreaChart
            series={dailyLeadTrend}
            currency={currency}
            valueIsMoney={false}
            onDrill={(p) => drill(p, "daily")}
          />
        </GlassCard>

        <GlassCard
          title="Conversion funnel"
          subtitle="Stage progression"
          chartRef={refFunnel}
        >
          <InteractiveFunnelChart
            series={conversionFunnel}
            currency={currency}
            onDrill={(p) => drill(p, "funnel")}
          />
        </GlassCard>
      </div>
    </section>
  );
}
