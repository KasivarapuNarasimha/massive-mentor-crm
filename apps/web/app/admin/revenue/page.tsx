"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

type RevenueData = {
  todayRevenue: number;
  monthlyRevenue: number;
  annualRevenue: number;
  mrr: number;
  arr: number;
  activeCustomers: number;
  trialCustomers: number;
  expiredCustomers: number;
  pendingRenewals: number;
  recentPayments: Array<{
    id: string;
    amount: number;
    invoiceNumber?: string | null;
    paidAt?: string | null;
    business?: { name: string };
    plan?: { name: string } | null;
  }>;
  revenueChart: Array<{ date: string; amount: number }>;
};

export default function AdminRevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.get<RevenueData>("/platform/revenue", token());
    if (res.success && res.data) setData(res.data);
    else toast.error(res.error || "Failed to load revenue");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <div className="h-40 animate-pulse bg-card rounded-2xl" />;
  }

  const kpis = [
    { label: "Today", value: data?.todayRevenue },
    { label: "This month", value: data?.monthlyRevenue },
    { label: "This year", value: data?.annualRevenue },
    { label: "MRR", value: data?.mrr },
    { label: "ARR", value: data?.arr },
  ];

  const counts = [
    { label: "Active customers", value: data?.activeCustomers },
    { label: "Trial customers", value: data?.trialCustomers },
    { label: "Expired / locked", value: data?.expiredCustomers },
    { label: "Pending renewals (7d)", value: data?.pendingRenewals },
  ];

  const maxChart = Math.max(1, ...(data?.revenueChart || []).map((c) => c.amount));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SaaS Revenue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform billing analytics (Razorpay SaaS payments, multi-tenant).
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</div>
            <div className="text-xl font-semibold tabular-nums mt-1 text-emerald-400">
              {formatCurrency(k.value || 0, "INR")}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {counts.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k.label}</div>
            <div className="text-2xl font-semibold tabular-nums mt-1">{k.value ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-4">Revenue (30 days)</h2>
        <div className="flex items-end gap-0.5 h-32">
          {(data?.revenueChart || []).map((c) => (
            <div
              key={c.date}
              className="flex-1 bg-violet-500/70 rounded-t min-w-0"
              style={{ height: `${Math.max(4, (c.amount / maxChart) * 100)}%` }}
              title={`${c.date}: ${c.amount}`}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <h2 className="font-semibold p-4 border-b border-border">Recent payments</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="p-3">When</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Invoice</th>
              <th className="p-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentPayments || []).length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No SaaS payments yet.
                </td>
              </tr>
            )}
            {(data?.recentPayments || []).map((p) => (
              <tr key={p.id} className="border-b border-border/50">
                <td className="p-3 text-xs text-muted-foreground">
                  {p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}
                </td>
                <td className="p-3">{p.business?.name || "—"}</td>
                <td className="p-3">{p.plan?.name || "—"}</td>
                <td className="p-3 font-mono text-xs">{p.invoiceNumber || "—"}</td>
                <td className="p-3 tabular-nums text-emerald-400">
                  {formatCurrency(p.amount, "INR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
