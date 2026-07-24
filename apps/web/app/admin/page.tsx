"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { KpiCard } from "@/components/admin/KpiCard";
import { HealthDot } from "@/components/admin/StatusBadge";
import { BarChart } from "@/components/admin/SimpleChart";
import { DeveloperRaw } from "@/components/admin/DeveloperRaw";

export default function AdminOverviewPage() {
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [usage, setUsage] = useState<{
    charts?: { dailyUsage?: Array<{ date: string; count: number }> };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!token) return;
    (async () => {
      const [a, h, u] = await Promise.all([
        api.platformAnalytics(token),
        api.platformHealth(token),
        api.platformUsageDashboard(token),
      ]);
      if (a.success && a.data) setAnalytics(a.data as Record<string, unknown>);
      else setError(a.error || "Failed to load analytics");
      if (h.success && h.data) setHealth(h.data as Record<string, unknown>);
      if (u.success && u.data) setUsage(u.data as typeof usage);
    })();
  }, []);

  const cards = [
    { label: "Customer businesses", value: analytics?.businesses, href: "/admin/businesses", tone: "info" as const },
    { label: "Active", value: analytics?.active, href: "/admin/businesses", tone: "success" as const },
    { label: "Suspended", value: analytics?.suspended, href: "/admin/businesses", tone: "warning" as const },
    { label: "Trials", value: analytics?.trials, href: "/admin/subscriptions", tone: "default" as const },
    { label: "Open tickets", value: analytics?.openTickets, href: "/admin/support", tone: "warning" as const },
    { label: "Unpaid invoices", value: analytics?.unpaidInvoices, href: "/admin/billing", tone: "danger" as const },
  ];

  const byPlan = (analytics?.byPlan || {}) as Record<string, number>;
  const planPoints = Object.entries(byPlan).map(([label, value]) => ({ label, value: Number(value) }));
  const healthCards = (health?.cards || {}) as Record<
    string,
    { label: string; status: string; value: string; detail?: string }
  >;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Platform Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Enterprise Super Admin dashboard — customer lifecycle, health, and growth at a glance.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/30 text-red-300 text-sm p-4">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="block hover:opacity-95 transition-opacity">
            <KpiCard label={c.label} value={c.value == null ? "—" : String(c.value)} tone={c.tone} />
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold">System health</h2>
          {Object.keys(healthCards).length ? (
            <div className="space-y-3">
              {["api", "database", "ram", "activeBusinesses"].map((k) => {
                const c = healthCards[k];
                if (!c) return null;
                return (
                  <div key={k} className="flex items-center justify-between gap-2 text-sm border-b border-border pb-2">
                    <div>
                      <div className="text-foreground">{c.label}</div>
                      <div className="text-xs text-muted-foreground">{c.detail}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{c.value}</div>
                      <HealthDot status={c.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-24 animate-pulse bg-muted rounded-xl" />
          )}
          <Link href="/admin/monitoring" className="text-xs text-violet-300 hover:underline">
            Open monitoring →
          </Link>
        </div>

        {planPoints.length ? (
          <BarChart title="Plan mix" points={planPoints} color="bg-violet-500" />
        ) : (
          <div className="bg-card border border-border rounded-2xl p-5 text-sm text-muted-foreground">
            No plan data yet.
          </div>
        )}
      </div>

      {usage?.charts?.dailyUsage && (
        <BarChart
          title="Login activity (14 days)"
          color="bg-sky-500"
          points={usage.charts.dailyUsage.map((d) => ({ label: d.date, value: d.count }))}
        />
      )}

      <DeveloperRaw data={{ analytics, health }} />
    </div>
  );
}
