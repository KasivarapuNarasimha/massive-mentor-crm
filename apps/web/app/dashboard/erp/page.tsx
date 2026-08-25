"use client";

/**
 * ERP Dashboard — operations & finance overview.
 * Presentation aligned with refined CRM AnalyticsDashboard charts.
 * Reuses existing /erp/dashboard (fallback /finance/dashboard) payload — no new calculations.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import {
  GlassCard,
  InteractiveAreaChart,
  InteractiveBarChart,
  InteractiveDonutChart,
  InteractiveHorizontalBar,
  type AnalyticPoint,
} from "@/components/dashboard/charts/InteractiveCharts";

type Kpis = {
  totalInvoiced: number;
  totalPaid: number;
  totalExpenses: number;
  totalTax: number;
  outstanding: number;
  profit: number;
  monthRevenue: number;
  yearRevenue: number;
  monthExpenses: number;
  overdueCount: number;
  invoiceCount: number;
  paidInvoiceCount: number;
};

type Pnl = {
  revenue: number;
  expenses: number;
  grossProfit: number;
  taxCollected: number;
};

type CashFlowRow = { month: string; inflow: number; outflow: number; net: number };

type ErpDashboardPayload = {
  currency?: string;
  kpis: Kpis;
  cashFlow?: CashFlowRow[];
  profitAndLoss?: Pnl;
  module?: string;
  lowStockCount?: number;
  openPurchaseOrders?: number;
  productCount?: number;
  vendorCount?: number;
};

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3 shadow-none min-h-[76px] flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted-foreground leading-snug">{label}</p>
      <p className="text-lg sm:text-xl font-semibold text-foreground tracking-tight tabular-nums leading-tight">
        {value}
      </p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function ErpDashboardPage() {
  const { token } = useAuth();
  const { money, currency } = useBusinessCurrency();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [ops, setOps] = useState<{
    lowStockCount?: number;
    openPurchaseOrders?: number;
    productCount?: number;
    vendorCount?: number;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refInflow = useRef<HTMLDivElement>(null);
  const refOutflow = useRef<HTMLDivElement>(null);
  const refNet = useRef<HTMLDivElement>(null);
  const refPnl = useRef<HTMLDivElement>(null);
  const refOps = useRef<HTMLDivElement>(null);
  const refInvoices = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Prefer dedicated ERP endpoint; fall back to finance dashboard (same KPI shape)
      let res = await api.get<ErpDashboardPayload>("/erp/dashboard", token);
      if (!res.success) {
        res = await api.get<ErpDashboardPayload>("/finance/dashboard", token);
      }
      if (!res.success || !res.data) {
        setError(res.error || "Unable to load ERP dashboard");
        setKpis(null);
        setPnl(null);
        setCashFlow([]);
        setOps({});
        return;
      }
      setKpis(res.data.kpis);
      setPnl(res.data.profitAndLoss || null);
      setCashFlow(Array.isArray(res.data.cashFlow) ? res.data.cashFlow : []);
      setOps({
        lowStockCount: res.data.lowStockCount,
        openPurchaseOrders: res.data.openPurchaseOrders,
        productCount: res.data.productCount,
        vendorCount: res.data.vendorCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setKpis(null);
      setPnl(null);
      setCashFlow([]);
      setOps({});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const inflowSeries: AnalyticPoint[] = useMemo(
    () =>
      cashFlow.map((c) => ({
        name: c.month,
        value: c.inflow,
        revenue: c.inflow,
        count: c.inflow,
        color: "#22c55e",
      })),
    [cashFlow]
  );

  const outflowSeries: AnalyticPoint[] = useMemo(
    () =>
      cashFlow.map((c) => ({
        name: c.month,
        value: c.outflow,
        revenue: c.outflow,
        count: c.outflow,
        color: "#ef4444",
      })),
    [cashFlow]
  );

  const netSeries: AnalyticPoint[] = useMemo(
    () =>
      cashFlow.map((c, i) => ({
        name: c.month,
        value: c.net,
        revenue: c.net,
        count: c.net,
        previous: i > 0 ? cashFlow[i - 1].net : undefined,
      })),
    [cashFlow]
  );

  const pnlSeries: AnalyticPoint[] = useMemo(() => {
    if (!pnl) return [];
    return [
      { name: "Revenue", value: Math.max(0, pnl.revenue), revenue: pnl.revenue, color: "#22c55e" },
      { name: "Expenses", value: Math.max(0, pnl.expenses), revenue: pnl.expenses, color: "#ef4444" },
      {
        name: "Gross profit",
        value: Math.max(0, Math.abs(pnl.grossProfit)),
        revenue: pnl.grossProfit,
        color: pnl.grossProfit >= 0 ? "#3b82f6" : "#f59e0b",
      },
      {
        name: "Tax",
        value: Math.max(0, pnl.taxCollected),
        revenue: pnl.taxCollected,
        color: "#8b5cf6",
      },
    ].filter((s) => s.value > 0 || s.name === "Revenue" || s.name === "Expenses");
  }, [pnl]);

  const invoiceMix: AnalyticPoint[] = useMemo(() => {
    if (!kpis) return [];
    const paid = kpis.paidInvoiceCount ?? 0;
    const total = kpis.invoiceCount ?? 0;
    const unpaid = Math.max(0, total - paid);
    const overdue = kpis.overdueCount ?? 0;
    return [
      { name: "Paid", value: paid, count: paid, color: "#22c55e" },
      { name: "Open", value: Math.max(0, unpaid - overdue), count: Math.max(0, unpaid - overdue), color: "#3b82f6" },
      { name: "Overdue", value: overdue, count: overdue, color: "#ef4444" },
    ].filter((s) => s.value > 0);
  }, [kpis]);

  const opsSeries: AnalyticPoint[] = useMemo(() => {
    const rows: AnalyticPoint[] = [];
    if (ops.productCount != null) {
      rows.push({ name: "Products", value: ops.productCount, count: ops.productCount, color: "#3b82f6" });
    }
    if (ops.vendorCount != null) {
      rows.push({ name: "Vendors", value: ops.vendorCount, count: ops.vendorCount, color: "#8b5cf6" });
    }
    if (ops.openPurchaseOrders != null) {
      rows.push({
        name: "Open POs",
        value: ops.openPurchaseOrders,
        count: ops.openPurchaseOrders,
        color: "#f59e0b",
      });
    }
    if (ops.lowStockCount != null) {
      rows.push({
        name: "Low stock",
        value: ops.lowStockCount,
        count: ops.lowStockCount,
        color: "#ef4444",
      });
    }
    return rows;
  }, [ops]);

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="ERP Dashboard"
        description="Internal operations & finance — separate from CRM sales. Existing Finance tools are linked below (no duplicate modules)."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="mm-btn mm-btn-secondary min-h-9 px-3 text-xs focus-ring"
            >
              Refresh
            </button>
            <Link
              href="/dashboard/finance"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-ring min-h-9"
            >
              Open Finance
            </Link>
            <Link
              href="/dashboard/approvals"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted focus-ring min-h-9"
            >
              Approvals
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading ERP overview">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-md bg-muted border border-border" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="h-[200px] animate-pulse rounded-md bg-muted border border-border" />
            <div className="h-[200px] animate-pulse rounded-md bg-muted border border-border" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      ) : kpis ? (
        <div className="space-y-4 sm:space-y-5">
          {/* KPI strip — matches CRM analytics density */}
          <div className="grid gap-2.5 sm:gap-3 grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Revenue (paid)" value={money(kpis.totalPaid)} />
            <KpiCard label="Invoiced" value={money(kpis.totalInvoiced)} />
            <KpiCard label="Expenses" value={money(kpis.totalExpenses)} />
            <KpiCard label="Profit" value={money(kpis.profit)} hint="Paid revenue − expenses" />
            <KpiCard label="Outstanding" value={money(kpis.outstanding)} />
            <KpiCard label="Tax collected" value={money(kpis.totalTax)} />
            <KpiCard label="This month revenue" value={money(kpis.monthRevenue)} />
            <KpiCard label="Overdue invoices" value={String(kpis.overdueCount ?? 0)} />
            {ops.lowStockCount != null ? (
              <KpiCard label="Low stock items" value={String(ops.lowStockCount)} />
            ) : null}
            {ops.openPurchaseOrders != null ? (
              <KpiCard label="Open purchase orders" value={String(ops.openPurchaseOrders)} />
            ) : null}
            {ops.productCount != null ? (
              <KpiCard label="Products" value={String(ops.productCount)} />
            ) : null}
            {ops.vendorCount != null ? (
              <KpiCard label="Vendors" value={String(ops.vendorCount)} />
            ) : null}
          </div>

          {/* Chart grid — same GlassCard / Interactive* language as CRM */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <GlassCard
              title="Cash inflow"
              subtitle="Paid receipts by month"
              chartRef={refInflow}
            >
              <InteractiveBarChart
                series={inflowSeries}
                currency={currency}
                valueIsMoney
                height={128}
              />
            </GlassCard>

            <GlassCard
              title="Cash outflow"
              subtitle="Expenses by month"
              chartRef={refOutflow}
            >
              <InteractiveBarChart
                series={outflowSeries}
                currency={currency}
                valueIsMoney
                height={128}
              />
            </GlassCard>

            <GlassCard
              title="Net cash flow"
              subtitle="Inflow − outflow trend"
              chartRef={refNet}
            >
              <InteractiveAreaChart
                series={netSeries}
                currency={currency}
                valueIsMoney
                height={128}
              />
            </GlassCard>

            <GlassCard
              title="Profit & Loss"
              subtitle="Revenue vs expenses snapshot"
              chartRef={refPnl}
            >
              <InteractiveDonutChart
                series={pnlSeries}
                currency={currency}
                centerLabel="P&L"
              />
            </GlassCard>

            <GlassCard
              title="Invoice status"
              subtitle="Paid · open · overdue counts"
              chartRef={refInvoices}
            >
              <InteractiveDonutChart
                series={invoiceMix}
                currency={currency}
                centerLabel="invoices"
              />
            </GlassCard>

            <GlassCard
              title="Operations snapshot"
              subtitle="Catalog · vendors · purchasing · stock"
              chartRef={refOps}
            >
              <InteractiveHorizontalBar
                series={opsSeries}
                currency={currency}
                valueIsMoney={false}
              />
            </GlassCard>
          </div>

          {/* Compact P&L numbers (same data as chart — retained for scanability) */}
          {pnl ? (
            <div className="rounded-md border border-border bg-card p-3.5 sm:p-4 shadow-none">
              <h2 className="text-sm font-semibold text-foreground tracking-tight">
                Profit &amp; Loss snapshot
              </h2>
              <dl className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Revenue</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(pnl.revenue)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Expenses</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(pnl.expenses)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Gross profit</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(pnl.grossProfit)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Tax</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{money(pnl.taxCollected)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-card p-3.5 sm:p-4 shadow-none">
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Operations</h2>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { href: "/dashboard/erp/products", label: "Products" },
                { href: "/dashboard/erp/inventory", label: "Inventory" },
                { href: "/dashboard/erp/warehouses", label: "Warehouses" },
                { href: "/dashboard/erp/vendors", label: "Vendors" },
                { href: "/dashboard/erp/sales-orders", label: "Sales Orders" },
                { href: "/dashboard/erp/purchases", label: "Purchases" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted focus-ring"
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Products, inventory, vendors, sales orders and purchases are ERP operations.
              Invoices, expenses and payments stay in Finance.
            </p>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
