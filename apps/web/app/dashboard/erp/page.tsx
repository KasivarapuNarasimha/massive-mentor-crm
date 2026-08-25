"use client";

/**
 * ERP Dashboard — Phase 1 shell.
 * Reuses existing Finance KPIs; does not duplicate Finance CRUD.
 * Public marketing website is out of scope.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";

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

type ErpDashboardPayload = {
  currency?: string;
  kpis: Kpis;
  cashFlow?: Array<{ month: string; inflow: number; outflow: number; net: number }>;
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
    <div className="mm-kpi-card">
      <p className="mm-kpi-label">{label}</p>
      <p className="mm-kpi-value">{value}</p>
      {hint ? <p className="mm-kpi-meta">{hint}</p> : null}
    </div>
  );
}

export default function ErpDashboardPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [ops, setOps] = useState<{
    lowStockCount?: number;
    openPurchaseOrders?: number;
    productCount?: number;
    vendorCount?: number;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setOps({});
        return;
      }
      setKpis(res.data.kpis);
      setPnl(res.data.profitAndLoss || null);
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
      setOps({});
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="ERP Dashboard"
        description="Internal operations & finance — separate from CRM sales. Existing Finance tools are linked below (no duplicate modules)."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/finance"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-ring"
            >
              Open Finance
            </Link>
            <Link
              href="/dashboard/approvals"
              className="inline-flex items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-ring"
            >
              Approvals
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="rounded-lg border border-border bg-muted p-8 text-sm text-muted-foreground">
          Loading ERP overview…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          {error}
        </div>
      ) : kpis ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Revenue (paid)" value={money(kpis.totalPaid)} />
            <KpiCard label="Invoiced" value={money(kpis.totalInvoiced)} />
            <KpiCard label="Expenses" value={money(kpis.totalExpenses)} />
            <KpiCard
              label="Profit"
              value={money(kpis.profit)}
              hint="Paid revenue − expenses"
            />
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

          {pnl ? (
            <div className="mt-6 mm-card p-5">
              <h2 className="text-sm font-semibold text-foreground">
                Profit &amp; Loss snapshot
              </h2>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Revenue</dt>
                  <dd className="font-semibold tabular-nums">{money(pnl.revenue)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expenses</dt>
                  <dd className="font-semibold tabular-nums">{money(pnl.expenses)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Gross profit</dt>
                  <dd className="font-semibold tabular-nums">{money(pnl.grossProfit)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="font-semibold tabular-nums">{money(pnl.taxCollected)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <div className="mt-6 mm-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Operations</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
        </>
      ) : null}
    </PageShell>
  );
}
